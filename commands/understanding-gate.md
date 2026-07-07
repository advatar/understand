---
description: Grade an understanding-quiz response blob against the diff and mint a pass token; or --verify / --check an existing pass.
argument-hint: "--grade <response-blob>  |  --verify <slug>  |  --check <range|slug>"
---

Use the **understanding-gate** skill for: `$ARGUMENTS`

- `--grade <blob>` — decode the response blob, grade it against the real diff with an independent
  grader subagent, log the pre-feedback first-attempt score, and mint a pass (write
  `.understanding/passes/<slug>.json`) only if all MCQ are correct and the free-text is defensible.
  Never reveal the correct answers on a fail — coach the reader to the right section and invite a retry.
- `--verify <slug>` — re-derive the answers and confirm the committed pass token is authentic (not forged).
- `--check <range|slug>` — fast existence + freshness check (no grading); this is what the pre-push hook runs.

Follow the skill steps exactly. Report the score and outcome; on a pass, remind the user to commit the pass record.
