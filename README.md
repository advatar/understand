# understanding

A portable Claude Code plugin that operationalizes Geoffrey Litt's *"Understanding is the New
Bottleneck"*: when an agent can write code faster than a human can understand it, the scarce resource
is **understanding**. This plugin makes understanding a first-class, gate-able artifact.

It depends on **nothing project-specific** and writes only under `.understanding/`. Drop it into any
git repo — any language, any stack, monorepo or not.

## Status

- **Increment 1 — `/explain-diff` + explainer self-check — ✅ built (v0.1.0).**
- Increment 2 — `/understanding-gate --grade` (agent-graded gate, pass tokens, pre-push hook) — planned.
- Increment 3 — `/micro-world` (human-driven single-file interactive model of a subsystem) — planned.
- Increment 4 — team scale (`publish.cmd`, forge-neutral CI gate, author ≠ certifier) — planned.

See `docs/` in the Mandamus repo for the full design (`UNDERSTANDING-FRAMEWORK.md`).

> **Scope of increment 1.** This ships the *explainer* and its build-time **self-check** (an
> independent grader must re-derive the quiz answers from the diff, or the explainer isn't emitted).
> It is a strong tool for **studying** a change. It is **not yet a deployable pass/fail gate** — the
> quiz page holds no answers and does no grading, so it can't *verify* a human's understanding on its
> own. That is increment 2 (`/understanding-gate --grade`, which marks the response blob against the
> diff and mints a pass token). Until then, treat a completed quiz as self-study, not certification.

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
  its source — grading (increment 2) re-derives correctness from the diff and consumes the nonces.

## Install

**As a plugin** (recommended). From a Claude Code session:

```
/plugin marketplace add advatar/understand      # or a local path to this repo
/plugin install understanding
```

Then in any repo: `/explain-diff main..HEAD`

**Manual / plugin-averse.** Copy `skills/explain-diff/` into the target repo's `.claude/skills/` and
`commands/explain-diff.md` into `.claude/commands/`. (An `npx understanding init` vendoring path is
planned.)

## The `.understanding/` convention

```
.understanding/
  explainers/<slug>/index.html      self-contained explainer   (commit or gitignore — your call)
  explainers/<slug>/manifest.json   metadata + question prompts (no answers)   [commit]
  INDEX.md                          auto-maintained catalog = the shared-space entry point   [commit]
  .nonces/<slug>.json               per-run secrets            [gitignored]
  .work/                            scratch (diffs, content spec)   [gitignored]
```

`slug` is deterministic from the git range + pathspec, so re-running is idempotent and monorepo-safe.
The `.understanding/` directory *is* the git-native shared space: review explainers through your
existing forge (GitHub/GitLab/Gitea) code-review surface.

## Requirements

- `git` (required), `node` (required, for assembly), `gh` (optional — only for PR-number mode).
- No network access needed by the generated HTML (strictly self-contained; CSP-friendly).
