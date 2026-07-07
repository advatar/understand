---
name: micro-world
description: >-
  Generate a single-file, human-DRIVEN interactive model of a subsystem or a diff — a scrubber /
  step-inject-rewind / before-after playground that lets a person build intuition by poking at the
  behavior, not just reading it. A re-implementation for understanding (not a wrapper on the live
  app), SHA-stamped with an honest faithful-vs-reimplemented map and staleness detection. Use when
  the user says "make a micro-world / playground / interactive model / simulator for <subsystem>",
  "let me play with how X works", or invokes /micro-world. Portable; touches only .understanding/.
---

# micro-world

Build `.understanding/worlds/<slug>/index.html` — a self-contained page where the human drives a
small, faithful *model* of a subsystem and watches it respond. The value is in the driving; your job
is to make the model correct on real inputs and honest about where it simplifies.

All paths use `${CLAUDE_PLUGIN_ROOT:-.claude}`. `world.mjs` does identity/build/staleness; you do the
understanding and the model.

## Steps

### 1. Resolve identity
```
node "${CLAUDE_PLUGIN_ROOT:-.claude}/skills/micro-world/scripts/world.mjs" resolve --paths <path>...    # a subsystem at HEAD
node "${CLAUDE_PLUGIN_ROOT:-.claude}/skills/micro-world/scripts/world.mjs" resolve --range <range> [-- <pathspec>]   # a specific change
```
Prints `{ mode, slug, sha, ref, range, paths }`. Copy these into your content spec verbatim.

### 2. Understand it, and pull a REAL seed
Read the code the world models. Then extract a **real `worldSeed`** — concrete input/fixture values
taken from the actual tests, constants, or a representative real case in the code. Do NOT invent
inputs; invented inputs are how a micro-world drifts from the truth. If you must simplify, simplify
the *model*, not the seed's realism.

### 3. Author the content spec
Write `.understanding/.work/<slug>.world.json` (each `_html` is inlined verbatim, so real HTML/SVG/JS
is fine — vanilla only, NO external libraries, NO project imports, must run offline):

- `title`, `subtitle`, and `slug`, `mode`, `sha`, `ref`, `range`, `paths` — copied from step 1.
- `worldSeed` — the real fixture object (step 2). It is embedded as the global `WORLD_SEED`.
- `worldSeedSource` (recommended) — where the seed came from, e.g. `"tests/tip.test.js"` or `"the
  RATE/CAP constants in tip.js"`. It's rendered as provenance on the page, which is what makes the
  "real seed, not invented" claim checkable by a reader.
- `model_html` — the interactive model + its driver controls, using `WORLD_SEED`. Pick the driving
  metaphor that fits the subsystem:
  - **time-scrubber** — a process/sequence over time or steps; a slider scrubs state.
  - **step / inject / rewind** — a state machine or algorithm; buttons step forward, inject an event,
    and rewind. Keep an explicit state history so rewind is real.
  - **before / after comparator** — a transform or pure function; the human edits inputs and sees old
    vs new behavior side by side (great for a diff-mode world).
  Make the *human* drive — no autoplay-only demos. Reset must return to the seed.
- `fidelity` — the **faithful-vs-reimplemented map** (non-empty). One entry per notable aspect:
  `{ "aspect": "...", "status": "faithful" | "simplified" | "omitted", "note": "..." }`. Be honest —
  a green "faithful" you can't back up is the failure mode this whole feature guards against.
- `notes_html` (optional) — "things to try", what it teaches.

### 4. Fidelity self-check (do the honest work here)
Trace the REAL code's behavior on the `worldSeed` inputs and confirm your model reproduces it. For
each aspect where the model and the code agree, mark `faithful`; where you approximated, mark
`simplified` with a note; where you left something out, mark `omitted`. **Never label an aspect
faithful unless you verified it against the code on the seed.** If the core behavior can't be
reproduced faithfully in vanilla JS, say so prominently rather than shipping a pretty lie.

### 5. Build
```
node "${CLAUDE_PLUGIN_ROOT:-.claude}/skills/micro-world/scripts/world.mjs" build --content .understanding/.work/<slug>.world.json --root "$(git rev-parse --show-toplevel)"
```
Writes the world + `manifest.json` (SHA-stamped, with the fidelity map), and updates
`.understanding/worlds/INDEX.md`. Fails loudly if `fidelity` is empty or a required field is missing.

### 6. Report
Give the path and remind the user: open it in a browser; it's a *re-implementation* (point at the
faithful-vs-reimplemented table); and it can go **stale** — check with
`world.mjs check --slug <slug>` (or `--all` to refresh the Stale column in the worlds index).

## Staleness
A micro-world is stamped with the sha of its range/subsystem. When the code changes, the sha drifts:
`world.mjs check --slug <slug>` exits non-zero and the worlds index flags it **STALE**. Treat a stale
world as untrusted until regenerated. (This is the hook-able signal for teams — a stale world for a
consequential path should prompt a rebuild.) Range-mode worlds model an *immutable* diff between two
fixed commits, so they stay fresh unless a commit is rewritten away; subsystem-mode worlds track the
paths at HEAD *and your working tree*, so any change (committed, staged, or untracked) makes them stale.

**Fresh ≠ faithful.** A passing freshness check only means the code hasn't moved — it says nothing
about whether the model was ever correct. Fidelity is carried entirely by step 4 (verifying against
the code on the real seed) and the honest fidelity map. Don't let a green check stand in for that.

## Notes
- Single file, vanilla JS, no network, no project imports — it must open with a double-click.
- Keep everything under `.understanding/`. The world is committed; `.work/` stays gitignored.
- A micro-world is exploratory (no quiz/gate) — its integrity controls are the real seed, the honest
  fidelity map, and the SHA/STALE mechanism.
