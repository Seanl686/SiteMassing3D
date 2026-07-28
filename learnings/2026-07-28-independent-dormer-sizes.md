# Independent per-dormer sizes

## What changed

- `src/defaults.js` — new dimension fields `dormerLinkSizes` (default `true`) and `dormerSizes` (array of `{ widthFt, heightFt }`, empty = inherit the global size). `migrate()` now normalizes `dormerSizes` (bad entries become `null` = inherit), coerces `dormerPositions` to finite numbers, and defaults `dormerLinkSizes` to `true` for legacy saves.
- `src/build.js` — new exported `dormerSize(dim, i)` resolves the effective width/height for dormer `i`. `buildDormers()` no longer hoists a single `dW`/`dH`; the individual-dormer loop resolves per index, and the connected-cap branch orders the pair left-to-right so each end contributes its own width, taking the taller of the two heights as the cap height. Accent window sizing is now per dormer too.
- `index.html` / `src/main.js` — "Link dormer sizes (all match)" checkbox plus a `#dormerSizeRows` container that renders one width/height pair per dormer when unlinked. Unlinking (or changing the dormer count while unlinked) seeds `dormerSizes` from the current global size so the on-screen shape does not jump. Drag clamping uses the dragged dormer's own width.
- `tests/app.test.js` — tests 16 and 17 cover independent sizes, fallback to global, linked-mode parity, connected-cap span math, and migration normalization.

## Why it mattered

The reference photo is a roofline with two visibly different gable dormers (one wide/low over the porch, one narrow/tall). Width and height were single global values, so editing one dormer resized both and that elevation could not be modelled.

## Gotchas / pitfalls

- `dormerLinkSizes` defaults to `true` deliberately: existing saved homes must keep the old shared-size behaviour, so `dormerSize()` ignores `dormerSizes` entirely while linked.
- The connected cap previously assumed both dormers shared a width. With unequal widths the cap extents must be computed from the left dormer's left edge and the right dormer's right edge — sorting by X first, otherwise a swapped `dormerPositions` array yields a negative cap width.
- `dormerSizes` entries are intentionally sparse/partial; a `null` entry or a missing field means "inherit global", so never assume `dormerSizes[i].widthFt` exists.

## Verification

`npm test` — 17/17 pass, including the new per-dormer size and migration tests.
