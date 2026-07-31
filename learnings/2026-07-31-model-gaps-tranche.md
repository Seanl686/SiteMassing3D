# Missing-feature tranche: gutters, shutters, skirting materials, sqft, ft-in input, and two dead roof/dormer branches

## What changed

- `src/units.js` (new) — `parseFeet()` reads plain decimals *or* feet-inches
  (`27'-4"`, `27' 4"`, `27ft 4in`, `4"`) off a spec sheet. Wired into the
  building-dimension inputs (`f_width`, `f_length`, front/back setback and
  length, wall height, floor height, eave/rake overhang, skirting height) —
  those fields switched from `type="number"` to `type="text"` and reformat to
  canonical `X'-Y"` on blur via the existing `fmtFt()`.
- `src/build.js` — `footprintAreas(dim, bumps)`: living sqft summed section by
  section (not `widthFt × lengthFt`, which is wrong once a section is stepped
  or set in), plus covered-porch sqft kept separate. Surfaced in the sidebar
  HUD, the render brief's geometry table, and the burnt-in plate caption.
- `src/build.js` — **found and fixed a dead-code bug**: `resolveRoofSections()`
  built the `solveRoof()` input object without a `roofStyle` key, so the
  `shed`/`none` branches inside `solveRoof()` (lines ~88–113) were
  unreachable. Selecting "Shed (single slope)" or "None (Open / no roof)" for
  the whole home silently built a mirrored symmetric gable instead — the roof
  dropdown had two dead options. Fix is one line: pass
  `spec.roofStyle || dim.roofStyle` through. `buildRoofSection()` already had
  correct `sec.shed`/`sec.none` handling waiting for this to reach it.
- `src/build.js` — `dormerStyle: 'shed'` is now real (`shedDormer()`): a
  flat-topped front wall and one roof slope, instead of always building a
  gable peak regardless of the (previously single-option, so unreachable
  anyway) dropdown value. `dormerStyle: 'hip'` was in the data model comment
  but never had geometry or a UI option; removed from the comment rather than
  shipped half-built — same reasoning as the shed/none fix above, just not
  carried through this pass.
- `src/build.js` / `src/textures.js` — gutters + downspouts (`buildGutters`,
  toggle `dim.gutters`, color `colors.gutter`): a trough along every *real*
  eave (skips flat/none roofs, skips the high side of a shed) plus a
  downspout at each outer end of a run. Skirting gained a material
  (`dim.skirtingMaterial`: vinyl panel / concrete block / brick / stacked
  stone / lattice, via new procedural canvas textures) and a height override
  (`dim.skirtingHeightFt`, clamped so the top still meets the floor deck
  rather than floating).
- `src/build.js` — per-opening shutters (`o.shutters`, `o.shutterStyle`
  louvered/paneled, `o.shutterColor`), built inside `buildOpening()`. Doors
  and windows can carry them; sliders can't (too wide, gated out explicitly).
- `src/brief.js` — shutters and gutters moved **off** the photo-only
  `ACCESSORIES` list (the plates now model them, so they're measured geometry
  like any opening, not something only a home photograph can answer) and the
  opening schedule gained a Shutters column. Skirting's brief line now
  reports the actual material and color instead of a hardcoded "white ribbed
  vinyl".
- `index.html` / `src/main.js` / `src/ui.js` — controls for all of the above:
  gutters checkbox + color, skirting material/height, a Shed Dormer option,
  and per-opening shutter pills (on/off, style, a 4-color cycle) on the
  selected-unit and group-edit cards.
- `tests/app.test.js` — tests 83–89 cover `parseFeet`, `footprintAreas`,
  gutters (including the shed/flat/none exclusions), shutters (including the
  slider exclusion), skirting height clamping, and — most importantly — that
  shed/none whole-home roof styles now actually diverge from a mirrored
  gable.

## Why it mattered

This came out of an audit of what a house-model app still doesn't do:
missing geometry (gutters, shutters, skirting variety), missing numbers
(square footage, feet-inches entry), and one dropdown (`dormerStyle`) whose
value main.js wrote but build.js never read. Digging into the roof-style
dropdown to fix the same class of bug for dormers surfaced a second, worse
instance of it one level up: **the whole-home roof style dropdown had the
identical defect** — `shed` and `none` were selectable, had fully-written
geometry sitting in `solveRoof()` and `buildRoofSection()`, and were
unreachable for the same reason (a value never threaded through). That one
was a one-line fix once found, but it would not have been found without
first noticing the pattern in the dormer case.

## Gotchas / pitfalls

- `rectShape(w, h, x, y)` takes the **bottom-left corner**, not a center —
  the first draft of the shutter panels passed a center coordinate straight
  through and got the panels positioned a half-width off. Any new geometry
  built with `rectShape`/`extrude` needs the corner, not the centroid.
- Local wall-frame `z` is **not** "outward positive" — `frameMatrix()` sets
  `z = normal.negate()`, so more-negative local-z is *outward* (proud of the
  siding face) and more-positive is *inward*. Casing uses `position.z =
  -TRIM_PROUD` for exactly this reason; the shutter panels follow the same
  sign convention.
- `resolveRoofSections()` is the only caller of `solveRoof()`. Any future
  per-section field that `solveRoof()` branches on has to be threaded through
  that one call site explicitly — the object literal there is not a passthrough
  of `dim`, so a new dim field silently does nothing until it's added to that
  literal. This is exactly the shape of bug fixed here; worth grepping
  `solveRoof(` before assuming a `dim.*` flag is live.
- Whole-home `hip` and `gambrel` roof styles, a garage/carport bump type,
  chimney/vent/meter-box props, window grilles/muntins, door style variety,
  a wheelchair ramp, driveway/landscape geometry, and a metric-units toggle
  are still out of scope after this pass — they need real new geometry (not
  a dead-wire fix) and weren't attempted here to keep this tranche reviewable
  and tested. Flagged to the user as deferred, not silently dropped.

## Verification

`npm test` — 89/89 passing (82 pre-existing + 7 new: units, footprint areas,
gutters, shutters, skirting height, and the whole-home shed/none fix).
`node --check` clean on every touched file. No browser available in this
environment to screenshot the actual render (Chrome extension not
connected), so the geometry additions are verified by mesh-count/position
assertions in the test suite and manual review of the coordinate-frame math,
not by eye — worth a visual pass before relying on this for a real render
package.
