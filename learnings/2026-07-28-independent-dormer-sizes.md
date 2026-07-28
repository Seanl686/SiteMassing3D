# Independent per-dormer sizes, nested dormers, hidden-line wireframe

## What changed

- `src/defaults.js` — new dimension fields: `dormerSizes` (array of `{ widthFt, heightFt }`, sparse; `null`/missing field = inherit the global size), `dormerLinkSizes` (**default `false`** — sizes are independent out of the box), `dormerNested`, `dormerNestOffsetFt`. `migrate()` normalizes `dormerSizes`, coerces `dormerPositions` to finite numbers, and only honours `dormerLinkSizes === true`.
- `src/build.js` — new exported `dormerSize(dim, i)` resolves the effective width/height per dormer. The per-dormer assembly was extracted out of `buildDormers()` into `gableDormer(dim, materials, opts)` so it can be called with an explicit `frontZ`/`depth`. Three arrangements now exist: separate (default), connected cap (each end contributes its own width, taller of the pair sets cap height), and **nested** — dormer 0 is the wide outer gable, dormer 1 is a smaller gable projecting 0.7 ft forward of the outer face, clamped to `outerW - 1.5` / `outerH - 0.5` and to an offset that keeps it inside the outer face.
- `index.html` / `src/main.js` — "Link dormer sizes", "Nested dormer", nested-offset field, and a `#dormerSizeRows` container rendering one width/height pair per dormer (labelled Outer/Inner in nested mode). The global width/height inputs hide while unlinked, since they no longer drive anything. Nested and connected are mutually exclusive; enabling nested seeds a visibly smaller inner gable. Dragging the inner gable in the 3D view edits `dormerNestOffsetFt` rather than its own ridge position.
- `src/scene.js` — `setWireframe()` rewritten as a **hidden-line** renderer: the solid geometry stays as an opaque depth mask painted in the background colour, and `EdgesGeometry` line overlays are stroked on top, so edges on the far side of the home are occluded instead of showing through.
- `tests/app.test.js` — tests 16–18 cover independent sizes, global fallback, linked-mode parity, connected-cap span math, migration normalization, and nested clamping.

## Why it mattered

The reference photo is a gable-inside-gable roofline: a wide low outer gable with a smaller gable nested inside it. Width and height were single global values, so editing one dormer resized both and that elevation could not be modelled at all. The first pass added per-dormer sizes but kept them linked by default, so the controls still looked and behaved like the old shared-size ones.

## Gotchas / pitfalls

- Defaulting `dormerLinkSizes` to `false` is safe for old saves *only* because an empty `dormerSizes` array inherits the global size — the geometry is byte-identical until someone edits a per-dormer field.
- While unlinked, the global width/height inputs are meaningless for any dormer that has an override. They are hidden rather than left visible, because leaving them on screen is exactly what made the sizes look "linked".
- `material.wireframe = true` is an x-ray, not a wireframe — it has no depth pass, so every back-face edge draws. Hidden-line needs the mask mesh with `polygonOffset` (factor/units 1) or the edges z-fight with the surface they sit on.
- `setWireframe()` must tear its own overlay down first and restore `userData.solidMaterial`: `rebuild()` regenerates the tree and calls it again through `applySceneOpts()`. It also skips anything under `stage.overlay` so the resize gizmo is not converted to lines.
- Dormer size inputs step by `0.0833` ft (1 inch) with floors of 0.5 ft wide / 0.25 ft tall — the old `step="0.5" min="2"` made it impossible to tune an inner gable small enough to match a photo. The rendered value is rounded to the nearest inch (`round12`) so the field never shows float noise.
- Nested mode ignores `dormerPositions[1]`; the inner gable is positioned from dormer 0 plus `dormerNestOffsetFt`. Anything that drags or clamps dormer 1 has to special-case that.
- The connected cap previously assumed both dormers shared a width. With unequal widths the extents must come from the left dormer's left edge and the right dormer's right edge — sort by X first, otherwise a swapped `dormerPositions` array yields a negative cap width.

## Verification

- `npm test` — 18/18 pass.
- Manual, in Chrome against `python3 -m http.server`: dormer count 2 + nested renders the outer 18 ft / inner 8 ft gable pair (checked in ¾ and front-elevation views); editing the inner width leaves the outer untouched; the wireframe toggle produces a clean line drawing with no back-wall lines and restores the solid materials when toggled off.
