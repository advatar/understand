---
name: explain-diff
description: >-
  Generate a self-contained, interactive HTML explainer for a code change (a git range or a PR) so a
  human can genuinely UNDERSTAND it before it merges — Background → Intuition (with an interactive
  figure) → literate Code walkthrough → a self-checking Quiz. Use when the user asks to "explain this
  diff/PR/change", "help me understand this code", "make an explainer", "onboard me to this change",
  or invokes /explain-diff. Portable: assumes nothing project-specific and writes only under
  .understanding/.
---

# explain-diff

Produce `.understanding/explainers/<slug>/index.html` — a self-contained explainer that teaches a
specific diff, ending in a quiz whose answers are NOT in the page (they're graded later against the
diff by `/understanding-gate`). Your job is the understanding, not decoration.

**This skill is portable. Never assume a framework, language, or repo layout. Read what the diff
actually touches.** All paths below are relative to `${CLAUDE_PLUGIN_ROOT:-.claude}/skills/explain-diff`.

## Steps

### 1. Resolve the range
Run the resolver (it handles PR mode via `gh`, degrades to plain git ranges, and is monorepo-safe):

```
bash "${CLAUDE_PLUGIN_ROOT:-.claude}/skills/explain-diff/scripts/resolve_range.sh" <RANGE> [-- <pathspec>...]
```

- `<RANGE>` defaults to `HEAD~1..HEAD`. Accept `main..HEAD`, a single ref, or a PR (`#123`/`123`).
- It prints JSON: `{mode, baseSha, headSha, rangeSha, slug, pathspec, diffFile, changedFiles}`.
  If it prints `{"error":...}`, relay the message and stop (e.g. PR mode with no `gh`).
- Read the diff from `diffFile`.

### 2. Understand the change (do the real work here)
Read the diff, then read enough of the **surrounding, unchanged code** to explain WHY, not just what.
Follow definitions/callers the diff depends on. If the change is large, focus on the load-bearing
parts and say what you're setting aside. You must understand it well enough to be quizzed on it.

### 3. Author the content spec
Write a `content.json` (to `.understanding/.work/<slug>.content.json`) with these fields — each `_html`
value is a fragment inlined verbatim into the page, so you may use real HTML/SVG/`<script>`:

- `title`, `slug`, `range`, `baseSha`, `headSha`, `rangeSha`, `pathspec` — copy from step 1's JSON.
- `background_html` — **teach the surrounding system first.** What is this subsystem, what problem does
  it solve, what did it look like before this change? Assume a competent engineer new to *this* code.
- `intuition_html` — the mental model, with toy examples and **at least one interactive figure**
  (inline vanilla JS + SVG/canvas — NO external libraries, NO project imports; it must run offline).
  A slider, a step-through, or a before/after toggle that makes the change's *effect* tangible.
- `code_html` — a **literate, prose-ordered** walkthrough of the diff: reorder hunks into the order
  that explains best, quote the key lines (wrap files as `<div class="u-code"><div class="u-file">path</div><pre><code>…</code></pre></div>`),
  and explain each. Not a raw diff dump.
- `quiz` — an array with **≥5 MCQ + ≥1 free-text**. Each: `{id, type:"mcq", prompt, options:[…]}` or
  `{id, type:"free", prompt}`. Make questions test understanding, not recall of trivia. **Exactly one
  MCQ must be answerable only from the code, not from your prose above** — set `"requiresCodeFact": true`
  on it (a skim of the explainer must not be enough to pass). Do NOT put answers in `content.json` or
  anywhere on disk — hold your intended answers in your head for the self-check.

### 4. Self-check (MANDATORY — enforced; the emit step refuses to run without it)
A subtly-wrong explainer that its own quiz "confirms" is worse than nothing. So, before emitting:

1. Note your **intended answers** for each MCQ (keep them out of every file).
2. **Spawn a grader subagent** — Task tool, `subagent_type: general-purpose` — which runs in a FRESH
   context (it does NOT inherit this conversation). Its entire prompt is the rubric plus the inputs:
   paste the contents of `${CLAUDE_PLUGIN_ROOT:-.claude}/skills/explain-diff/prompts/grader.md`, then the **raw
   diff** (from `diffFile`) and your **drafted quiz questions (prompts + options, NO answers)**. Do
   NOT include your Background/Intuition/Code prose — the grader must derive answers from the diff
   alone (this is what makes the check independent). Ask it to return the rubric's structured verdict
   (`graderAnswers`, `flagged`, `requiresCodeFactOk`, `verdict`).
3. **Reconcile.** Compare `graderAnswers` to your intended answers. If **any MCQ mismatches**, or the
   grader `flagged` anything, or `requiresCodeFactOk` is false → **your explainer or a question is
   wrong. Fix it and re-run the grader.** Loop until the grader returns `verdict: pass` with a full
   match and nothing flagged.
4. Once clean, write the report to `.understanding/.work/<slug>.selfcheck.json` (gitignored):
   `{"slug":"<slug>","rangeSha":"<rangeSha>","verdict":"pass","checkedAt":"<ISO8601>","graderAnswers":{…},"authorAnswers":{…},"flagged":[]}`.
   The emit step **reads this file and refuses to publish** unless `verdict` is `pass` and `rangeSha`
   matches — so the self-check is a real precondition, not just discipline.

This guards the "confidently wrong" failure mode: the answers must be genuinely derivable from the
diff by an independent reader.

### 5. Emit
```
node "${CLAUDE_PLUGIN_ROOT:-.claude}/skills/explain-diff/scripts/assemble.mjs" --content .understanding/.work/<slug>.content.json --root "$(git rev-parse --show-toplevel)"
```
It writes the explainer + `manifest.json` (committed; records the self-check verdict but NO answers),
the gitignored `.nonces/<slug>.json`, ensures `.understanding/.gitignore`, and updates
`.understanding/INDEX.md`. It **fails loudly** if the self-check report is missing/failed/for a
different range, or if the quiz violates the ≥5-MCQ / ≥1-free / ≥2-options rules — fix and re-run.

### 6. Report
Give the user the explainer path and tell them to open it in a browser (or, if the project set a
`publish.cmd`, that it can be published). Note the self-check verdict. Do NOT claim the quiz proves
mastery — it proves the answers are diff-derivable and that they engaged.

## Notes
- **Never write correct answers to disk.** The anti-gaming property is that answers live nowhere the
  human can read them; grading re-derives them from the diff at gate time.
- If `gh` is absent, PR mode is unavailable — say so and offer the equivalent git range.
- Keep everything under `.understanding/`. Touch no other project files.
