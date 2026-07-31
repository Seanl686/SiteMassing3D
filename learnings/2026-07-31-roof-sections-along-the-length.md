# Roof sections: a different pitch and peak on one part of the home than the next

## What changed

- `src/build.js` — the split-pitch solve was extracted out of `derived()` into
  `solveRoof(v, dim)`, which takes its pitches and eave heights as arguments
  instead of reading them off `dim`. That is the whole trick: a roof section can
  now run its own values through exactly the same maths as the whole-home roof.
- `src/build.js` — `resolveRoofSections(dim)` normalises `dim.roofSections` into
  an ordered, gap-free list along the length, each solved into its own
  cross-section with `x0`/`x1`. `derived(dim)` is now that list plus aggregates:
  the legacy keys describe **section 0**, `ridgeY` is the tallest section
  anywhere, and `sections`/`sectioned` are new.
- `src/build.js` — `buildRoof()` loops sections. Each plane gets its own X
  extent, so a section standing above its neighbour carries its overhang past
  the boundary (`stepOverhang`) with a rake board on the exposed edge, while a
  butted joint gets nothing. `buildSectionTransition()` walls in the gap between
  two disagreeing roofs by sampling the upper and lower envelope at the ridges,
  the wall lines and any crossing between them.
- `src/build.js` — `buildWall()` splits every stretch of siding a second time,
  at the section boundaries, so the long walls step where two sections meet at
  different eave heights. This composes with the bump bands rather than
  replacing them: bumps cut the wall along u, sections cut it again, and each
  piece takes its own top.
- `src/build.js` — `wallTopEdge()` caps a gable end with the section that
  reaches **that** end. Dormers and corner boards read the section they stand
  over via `sectionAtX()`.
- `src/build.js` — `buildFascia()` takes an optional X range so each section
  boards only its own stretch.
- `src/defaults.js` — `roofSections`, `stepOverhang`, `stepOverhangFt`,
  `stepRakeFascia`, `endRakeFascia`, plus `newRoofSection()` and
  `normalizeRoofSections()`, which `migrate()` runs on load.
- `src/ui.js` / `index.html` / `src/main.js` / `css/app.css` — a section editor
  in the Building panel: one card per section with live resolved readouts, split
  and reset buttons, and the step-overhang controls.
- `tests/app.test.js` — tests 74–77.

## Why it mattered

The roof could vary across its width — split pitch, per-wall eaves, ridge step —
but not along its length. "A different roof pitch on one half of the house versus
the other" had no expression at all.

## Gotchas / pitfalls

- **A single section must produce the tree it always produced.** `buildRoof()`
  adds the section group's children directly to the roof group when there is
  only one, instead of nesting them under `roofSection:0`. Nesting
  unconditionally broke an existing test that looks up `fasciaFront` by name on
  the roof group, and the same lookup pattern is used elsewhere — the flattening
  is what keeps every unsectioned home byte-identical.
- The legacy keys on `derived()` describe section 0, but `ridgeY` is the tallest
  section. Splitting those two apart is deliberate: `scene.js`, `framing.js` and
  the export framing all want the tallest thing on the roof, while everything
  reading `slopeFront`/`eaveYFront` wants a single cross-section and has no
  concept of sections.
- Wall banding composes in one direction only: the bump bands are computed
  first, then each resulting stretch is subdivided at the section boundaries.
  Doing it the other way round loses the recess/bump-out depth, because a band's
  `depth` belongs to the bump, not to the section.
- `wallBands()` still takes a single `bodyTop`. It is fed the *first* section's
  eave, which is only used to clamp a bump's height — a bump under a taller
  section is clamped slightly low rather than wrongly tall, which is the safe
  direction. Worth revisiting if per-section bump heights are ever wanted.
- The front wall's u axis runs opposite world X, so a section's `x0..x1` maps to
  `span/2 - x1 .. span/2 - x0` on that wall and straight through on the back.
  Getting this backwards puts the step at the wrong end and is invisible in a
  three-quarter view — check a front elevation.
- Sections narrower than a foot are dropped rather than clamped. Clamping them
  produces zero-width roof planes, which `BoxGeometry` accepts and then renders
  as z-fighting slivers.

## Verification

- `npm test` — 77/77 pass.
- Manual, in Chrome against `python3 -m http.server`: a 56 ft home split at 28 ft
  with the right half at 9/12 on 11 ft walls renders the raised roof, the wall
  step, the transition wall and the step overhang; the front elevation shows the
  step at the correct end; the right gable end takes the raised section's
  off-centre peak and the left takes the plain one; corner boards run to 8 ft at
  one end and 11 ft at the other; step overhang `none` closes it back to a butt
  joint; reset returns to the single read-only summary card; and the sections
  round-trip through a reload unchanged.
