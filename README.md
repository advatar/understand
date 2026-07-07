# understanding

A portable Claude Code plugin that operationalizes Geoffrey Litt's *"Understanding is the New
Bottleneck"*: when an agent can write code faster than a human can understand it, the scarce resource
is **understanding**. This plugin makes understanding a first-class, gate-able artifact.

It depends on **nothing project-specific** and writes only under `.understanding/`. Drop it into any
git repo — any language, any stack, monorepo or not.

## Status

- **Increment 1 — `/explain-diff` + explainer self-check — ✅ built.**
- **Increment 2 — `/understanding-gate` (agent-graded gate, pass tokens, pre-push hook) — ✅ built.**
- **Increment 3 — `/micro-world` (human-driven single-file interactive model, SHA-stamped + STALE detection) — ✅ built.**
- **Increment 4 — team scale (`publish.cmd`, forge-neutral CI gate, author ≠ certifier) — ✅ built (v0.4.0).**

See `docs/` in the Mandamus repo for the full design (`UNDERSTANDING-FRAMEWORK.md`).

## What `/explain-diff` does

`/explain-diff [range] [-- <pathspec>]` reads a diff (a git range, or a PR via `gh`), understands it,
and generates a **self-contained** `.understanding/explainers/<slug>/index.html`:

1. **Background** — teaches the surrounding system first.
2. **Intuition** — the mental model + toy examples + ≥1 interactive vanilla-JS figure (runs offline).
3. **Code** — a literate, prose-ordered walkthrough of the actual diff.
4. **Check yourself** — a quiz (≥5 MCQ + ≥1 free-text). One MCQ is answerable only from the code, so a
   skim of the explainer fails.

### The trust controls

- **Explainer self-check (before emission).** An independent grader subagent re-derives the quiz
  answers from the diff. If they don't match the author's, or a question is underdetermined, the
  explainer is not emitted. This guards the "confidently wrong explainer + passing quiz = false
  confidence" failure mode.
- **The page holds no answers and no grading logic.** It only packages the human's selections +
  free-text into a base64 *response blob*. Correct answers live nowhere on disk; per-run nonces are
  written to a **gitignored** `.understanding/.nonces/`. You cannot mint a pass by reading the HTML or
  its source — grading re-derives correctness from the diff and consumes the nonces.

## What `/micro-world` does

`/micro-world --paths <path>…` (a subsystem) or `--range <range>` (a change) builds a single-file,
**human-driven** interactive model — `.understanding/worlds/<slug>/index.html`:

- A scrubber / step-inject-rewind / before-after **playground** you poke at to build intuition — a
  re-implementation *for understanding*, running vanilla JS offline, seeded with **real fixture
  data** pulled from the code (not invented input).
- An honest **faithful-vs-reimplemented** table up top: every notable aspect marked `faithful`,
  `simplified`, or `omitted`. A green you can't back up is the exact failure mode this guards against.
- **SHA-stamped + STALE detection.** The world records the sha of its subsystem/range;
  `world.mjs check --slug <slug>` (or `--all`) recomputes it and flags the world **STALE** when the
  code moves. A stale world is untrusted until regenerated — the hook-able signal for teams.

Its honest limit: "fresh" means the sha matches, not that the model was ever faithful — that's what
the fidelity table and the real seed are for.

## What `/understanding-gate` does

`/understanding-gate --grade <blob>` turns the explainer into a real gate:

1. Decodes the response blob and loads the diff the explainer was built from.
2. An **independent grader subagent** re-derives the correct answers from the diff (same rubric as
   the self-check) and marks the human's answers. The **first-attempt (pre-feedback) score is logged**,
   so retries don't inflate the record.
3. On a genuine pass (all MCQ correct + defensible free-text) it mints a **pass token** and writes
   `.understanding/passes/<slug>.json` (committed: token + *who* passed + first-attempt score).

- `--verify <slug>` re-derives the answers and confirms a committed token is authentic — a
  **hand-forged token is detected**.
- `--check <range|slug>` is a fast existence + freshness check (what the pre-push hook runs).

**The token is unforgeable from committed files:** `token = sha256(rangeSha · gitignored-nonces ·
correct-answers)`. You can't compute it by reading the repo — the nonces are gitignored and the
answers are nowhere on disk; you must actually know them (i.e. understand the diff). Its honest limit:
a person who genuinely derives the right answers *can* mint their own pass — which is the point.
Cross-person trust (author ≠ certifier) is increment 4.

### Opt-in pre-push gate (default OFF)

Add `.understanding/config.json` and install the hook to block pushes of consequential changes that
lack a pass:

```json
{ "gate": { "enabled": true, "base": "origin/main", "paths": ["src/", "lib/"] } }
```

```
cp path/to/understanding/hooks/pre-push .git/hooks/pre-push && chmod +x .git/hooks/pre-push
```

With no config (or `enabled:false`) the hook is a **no-op** — installing it never surprises anyone.
Scope `paths` to genuinely consequential code to avoid ceremony fatigue.

### Team scale — CI gate + author ≠ certifier

The understanding a pass proves only *counts* if someone other than the author did the understanding.
On a team, add `"prCheck": true` and run the gate as a PR check:

```json
{ "gate": { "enabled": true, "base": "origin/main", "paths": ["src/"], "prCheck": true } }
```

Copy `templates/understanding-quiz.yml` into `.github/workflows/` — or, on any other forge, run
`skills/understanding-gate/scripts/ci-gate.mjs` in your pipeline and honor the exit code (**0 =
allowed, non-zero = block** — the bring-your-own-CI contract). With `prCheck`, a pass whose certifier
matches the change's author is **rejected**: a *different* teammate must build the explainer and pass
its quiz. Default is OFF, so adding the workflow never surprises a repo.

**What it does and doesn't prove.** The CI gate confirms a *fresh pass record exists naming a
certifier ≠ the author*. It does **not** cryptographically re-verify the pass — the verifying nonce is
local/gitignored and re-grading needs the agent, so CI can't recompute the token. Pass records are
committed, so the tamper-evidence is the review itself: a forged/edited `.understanding/passes/**`
shows up in the PR diff — review it like any other change. Author≠certifier is a best-effort identity
match, not an identity provider. Cryptographically **signing** pass records (so an author can't forge
a teammate's certification) is the honest next hardening.

### Publishing to a gated home

`publish.cmd` is an optional, forge-neutral hook. After `/explain-diff` or `/micro-world` builds an
artifact, the framework runs `<cmd> <file> <slug> <title>` so a project can push it wherever it likes
(an internal app, a docs site) — the framework never learns the destination, and a publish failure is
non-fatal (the artifact is already written locally):

```json
{ "publish": { "cmd": "node tools/publish-explainer.mjs" } }
```

## Install

Pick whichever is easiest — all three give you `/explain-diff` and `/understanding-gate`.

**A · Type two commands (recommended).** In any Claude Code session:

```
/plugin marketplace add advatar/understand
/plugin install understanding@understand
```

Then, in any repo: `/explain-diff main..HEAD`

**B · Just point your Claude agent at this repo.** Tell it:

> Install the understanding plugin from github.com/advatar/understand

The agent runs the two commands above (or vendors it with `install.sh`) — no manual steps.

**C · Vendor it (no plugin system).** From inside the repo you want it in:

```
curl -fsSL https://raw.githubusercontent.com/advatar/understand/main/install.sh | bash
```

or clone this repo and run `./install.sh --target /path/to/your/repo`. It copies the skills +
commands into that repo's `.claude/`.

**Optional — turn on the pre-push gate.** The gate is OFF until you opt in. To enforce it, install the
git hook and add a config:

```
bash "$CLAUDE_PLUGIN_ROOT/scripts/setup-hooks.sh"     # or ./scripts/setup-hooks.sh from a clone
echo '{ "gate": { "enabled": true, "base": "origin/main", "paths": ["src/"] } }' > .understanding/config.json
```

Requires `git` and `node`; `gh` only for PR-number mode. Nothing here needs network access at runtime.

## The `.understanding/` convention

```
.understanding/
  explainers/<slug>/index.html      self-contained explainer   (commit or gitignore — your call)
  explainers/<slug>/manifest.json   metadata + question prompts + self-check verdict (no answers)  [commit]
  worlds/<slug>/index.html          human-driven micro-world (SHA-stamped)   [commit]
  worlds/<slug>/manifest.json       mode + sha + fidelity map (for STALE detection)   [commit]
  worlds/INDEX.md                   micro-world catalog with a Stale column   [commit]
  passes/<slug>.json                pass token + who + first-attempt score (no answers)   [commit]
  INDEX.md                          auto-maintained catalog = the shared-space entry point   [commit]
  config.json                       optional; gate opt-in (absent = all defaults, gate OFF)   [commit]
  .nonces/<slug>.json               per-run secrets            [gitignored]
  .work/                            scratch (diffs, content spec, attempt log)   [gitignored]
```

`slug` is deterministic from the git range + pathspec, so re-running is idempotent and monorepo-safe.
The `.understanding/` directory *is* the git-native shared space: review explainers through your
existing forge (GitHub/GitLab/Gitea) code-review surface.

## Requirements

- `git` (required), `node` (required, for assembly), `gh` (optional — only for PR-number mode).
- No network access needed by the generated HTML (strictly self-contained; CSP-friendly).
