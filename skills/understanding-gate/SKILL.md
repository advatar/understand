---
name: understanding-gate
description: >-
  Grade a human's understanding-quiz response against the actual diff and, on a genuine pass, mint an
  unforgeable pass token — the "speed regulator" for AI-written code. Use when the user pastes a
  response blob, says "grade my quiz / understanding", asks to check or verify an understanding pass,
  or invokes /understanding-gate. Pairs with the explain-diff skill; touches only .understanding/.
---

# understanding-gate

Marks a quiz response **against the diff** (not against anything in the page — the page has no
answers), records the pre-feedback first-attempt score, and mints a pass token only on a real pass.
The token binds the range + gitignored nonces + the correct answers, so it cannot be produced by
reading committed files, and a hand-forged token is detectable by re-grading.

All paths use `${CLAUDE_PLUGIN_ROOT:-.claude}`. The deterministic bookkeeping is `gate.mjs`; the *grading
judgment* is yours, via an independent grader subagent (same rubric as the explainer self-check).

## `--grade <response-blob>`  (the main flow)

1. **Decode** the base64 blob → `{ slug, rangeSha, answers }`. If it isn't valid, ask the user to
   click "Copy response blob" on the explainer and paste again.
2. **Load** `.understanding/explainers/<slug>/manifest.json`. If `blob.rangeSha !== manifest.rangeSha`,
   the blob is for a different version — tell the user to re-open the current explainer. Stop.
3. **Get the diff to grade against.** Re-run the resolver on the manifest's range:
   `bash "${CLAUDE_PLUGIN_ROOT:-.claude}/skills/explain-diff/scripts/resolve_range.sh" <manifest.range>`
   (add `-- <manifest.pathspec>` if present). If the resulting `slug` ≠ the explainer's slug, the code
   has changed since the explainer was built → tell the user to regenerate the explainer (`/explain-diff`).
   Otherwise read the fresh diff from its `diffFile`.
4. **Grade independently.** Spawn a grader subagent (Task tool, `subagent_type: general-purpose`) —
   a Task subagent starts with a clean context and does **not** see this conversation, which is what
   keeps the grade independent of your framing. Give it the rubric
   `${CLAUDE_PLUGIN_ROOT:-.claude}/skills/explain-diff/prompts/grader.md` plus
   the diff and the quiz questions (from the manifest) — NOT the human's answers. Get its correct MCQ
   answers and, for each free-text question, a model answer.
5. **Mark.** Compare the human's `answers` to the grader's correct MCQ answers → `mcqCorrect / total`.
   Judge each free-text answer defensible-or-not against the grader's model answer (be fair, not
   pedantic: does it show real understanding of the change?). Record the attempt (this fixes the
   first-attempt score BEFORE you reveal anything):
   `node "${CLAUDE_PLUGIN_ROOT:-.claude}/skills/understanding-gate/scripts/gate.mjs" attempt --root "$(git rev-parse --show-toplevel)" --slug <slug> --mcq-correct <n> --total <n>`
6. **Pass or coach.**
   - **Pass** = all MCQ correct AND every free-text answer defensible. Mint:
     `node .../gate.mjs mint --root <root> --slug <slug> --who "$(git config user.name) <$(git config user.email)>" --mcq-answers '<json of the CORRECT answers {qid:LETTER}>' --free-answers '<json {qid:text} of the human's free-text answers from the blob>' --mcq-correct <n> --total <n> --free-ok true`
     The `--mcq-answers` are the grader's correct answers (== the human's, since they got them all
     right) and `--free-answers` are the human's submitted free-text — both bind the token, so the
     pass is tamper-evident. Report PASS, the first-attempt score, and that
     `.understanding/passes/<slug>.json` was written (commit it).
   - **Not a pass** → do NOT mint. **Never reveal the correct letters or the grader's model
     answers**, in this turn or any later one — reveal only the *question numbers* to revisit and the
     Code/Intuition section to re-read, then invite a retry (the first-attempt score is already
     logged, so retries don't inflate the record). Keep any grader output in-context only; never
     write it to a committed file.

## `--verify <slug>`  (is a committed pass authentic?)
Re-derive the correct MCQ answers from the diff with a fresh grader subagent (steps 3–4), then:
`node .../gate.mjs verify --root <root> --slug <slug> --mcq-answers '<json re-derived answers>'`.
`authentic:true` means the token matches the correct answers (a real pass); `authentic:false` means
the pass record was forged or the answers changed. (Requires the local gitignored nonces.)

## `--check <range|slug>`  (fast, no grading — what the pre-push hook calls)
`node .../gate.mjs check --root <root> --range <range> [-- <pathspec>]` (or `--slug <slug>`) →
exit 0 if a fresh pass exists, non-zero otherwise. This only checks existence + range freshness; use
`--verify` for authenticity.

## Enabling the pre-push gate (opt-in)
The gate is OFF by default. To enforce it, add `.understanding/config.json`:
`{ "gate": { "enabled": true, "base": "origin/main", "paths": ["src/"] } }` and install the hook
(`ln -s` or copy `${CLAUDE_PLUGIN_ROOT:-.claude}/hooks/pre-push` into `.git/hooks/pre-push`, chmod +x). Then a
push that touches `paths` without a valid pass is blocked. Keep `paths` scoped to genuinely
consequential code to avoid ceremony fatigue.

## Notes
- Never write correct answers to disk (not in the pass record, not in `.work`). The token is the only
  derived artifact, and it's a one-way hash.
- `passes/<slug>.json` is COMMITTED (token + who + first-attempt score). `.nonces/` and `.work/` stay
  gitignored.
- Honest limit: the token proves correct MCQ + a defensible free-text answer, not deep mastery, and a
  determined author who genuinely derives the right answers can mint their own pass. Cross-person
  trust (author ≠ certifier) is increment 4.
