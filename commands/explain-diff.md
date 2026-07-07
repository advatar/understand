---
description: Generate a self-contained interactive HTML explainer for a diff or PR (Background → Intuition → Code → self-checking Quiz).
argument-hint: "[range] [-- <pathspec>]   e.g. main..HEAD  |  #123  |  HEAD~3..HEAD -- src/"
---

Use the **explain-diff** skill to build an understanding explainer for: `$ARGUMENTS`

If no range was given, default to `HEAD~1..HEAD`. Follow the skill's steps exactly — especially the
**mandatory self-check** (an independent grader subagent must re-derive the quiz answers from the diff
before the explainer is emitted). Report the resulting `.understanding/explainers/<slug>/index.html`
path and the self-check verdict when done.
