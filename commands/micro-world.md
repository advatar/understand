---
description: Generate a single-file, human-driven interactive micro-world (scrubber / step-inject-rewind / before-after) for a subsystem or diff, SHA-stamped with a faithful-vs-reimplemented map.
argument-hint: "--paths <path>...   |   --range <range> [-- <pathspec>]"
---

Use the **micro-world** skill to build an interactive model for: `$ARGUMENTS`

Resolve identity with `world.mjs resolve` (subsystem via `--paths`, or a change via `--range`), pull
a REAL `worldSeed` from the code/tests (never invented input), author a self-contained vanilla-JS
model the human drives, and fill in the **faithful-vs-reimplemented** map honestly — only mark an
aspect `faithful` after verifying it against the real code on the seed. Then `world.mjs build`.

Report the `.understanding/worlds/<slug>/index.html` path, note it's a re-implementation (point at the
fidelity table), and mention it can go stale (`world.mjs check --slug <slug>`).
