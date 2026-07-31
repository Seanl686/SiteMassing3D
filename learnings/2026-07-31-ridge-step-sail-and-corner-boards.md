# Ridge offset, ridge step, sailing peaks, and corner boards that lie on their walls

## What changed

- `src/build.js` — `derived()` keeps the split-pitch solve as its starting point
  and then takes it three steps further. `ridgeOffsetFt` nudges the solved ridge
  and the slopes are re-read off the moved ridge, so both planes still land on
  their own eave. `ridgeStepFt` lifts one peak clear of the other — the one case
  the solve cannot express, because it assumes a single ridge line — and the
  plane below steepens to reach its raised peak. `ridgeOverhang` then lets the
  taller plane carry on past the ridge at its own pitch instead of dying into the
  clerestory. New keys: `frontPeakY`, `backPeakY`, `ridgePeakY`, `ridgeStepFt`,
  `ridgeSail`, `ridgeCutZ`.
- `src/build.js` — `ridgeY` now means **the highest point of the roof**, which is
  the sailing edge once a plane reaches past the ridge. `ridgePeakY` is the peak
  itself. Framing and the camera read `ridgeY`; the gable profile reads the
  peaks.
- `src/build.js` — `wallTopEdge()` returns `peakV0`/`peakV1`, the peak height
  belonging to each of the gable end's two corners, and `buildWall` emits two
  vertices at the same `u` when they differ, so the clerestory shows in the end
  elevation.
- `src/build.js` — `buildCornerTrim()` rewritten. Boards now run **inward** from
  the corner along the wall they sit on, take their height from that wall's own
  eave, lap the long wall over the gable end, and use a new `corner` material.
- `src/build.js` — fascia, rake, ridge and porch-roof boards moved off
  `materials.trim` onto `materials.fascia`, with `fasciaWidthFt` driving the face
  width.
- `src/defaults.js` — `ridgeOffsetFt`, `ridgeStepFt`, `ridgeOverhang`,
  `ridgeOverhangFt`, `fasciaWidthFt`; `colors.fascia` and `colors.corner`, which
  `migrate()` back-fills from `colors.trim` rather than the app default.
- `index.html` / `src/main.js` — four roof fields beside the rear-pitch input, a
  fascia-width input beside the corner-trim one (both typed in inches), fascia
  and corner swatches, and a `#ridgeHint` that prints the step and the sail.
- `tests/app.test.js` — tests 69–73.

## Why it mattered

The corner boards were being placed by measuring **outward** from the corner:
`c.x + c.signX * (w / 2)` puts a 6" board centred 3" *past* the end of the wall,
so both boards at every corner floated off the building as a diagonal L instead
of wrapping it. From a three-quarter view they read as edge-on slabs, which is
what "the corner boards are rotated wrong" was describing — the orientation was
right, the position was outside the footprint.

The roof work came in from a branch that had been built on `main`, where the roof
was a single symmetric gable. `development` had already solved the split-pitch
ridge, so the port had to sit on top of that solve rather than replace it.

## Gotchas / pitfalls

- **`ridgeY` changed meaning.** It used to be the peak; it is now the top of the
  roof including the sail. Anything comparing it against the peak wants
  `ridgePeakY`. `scene.js`, `framing.js` and the export framing all want
  `ridgeY`, which is why the sail had to be folded into it rather than reported
  separately — otherwise a sailing roof frames with its top edge cropped.
- A ridge offset must be applied **before** the slopes are re-read, not after.
  Re-reading is what keeps both planes landing on their eaves; skip it and the
  planes float off the wall tops exactly the way the original clamp did before
  the split-pitch solve added that step.
- The sail is clamped to the *far* plane's run (`W / 2 - ridgeZ` when the front
  sails), not to its own. It hangs over the other plane, so that is the distance
  it can cover.
- The sail only fires once the peaks differ by more than `ROOF_THICK`. Below
  that the overhang is thinner than the deck it reaches over and disappears
  inside it.
- Corner boards must take their height from the wall they are **on**, not from
  `dim.wallHeightFt`. With a split pitch or a per-wall height the front and back
  eaves sit at different heights, and a single shared height leaves one pair
  floating short and the other poking through the roof.
- `cornerTrimWidthFt` and `fasciaWidthFt` are stored in **feet** but typed in
  **inches** in the UI — the existing corner-trim control already worked that
  way, and mixing the two units in one panel is worse than the conversion.
- `colors.fascia`/`colors.corner` must back-fill from the *loaded* `trim`, not
  from the base default. Falling through to the default repaints a saved home
  the moment it is opened.

## Verification

- `npm test` — 73/73 pass.
- Test 72 was checked against the original `buildCornerTrim()` body and fails on
  it (`A long-wall board stays within the length of the wall it is on`), so it
  catches the regression rather than merely passing.
- Manual, in Chrome against `python3 -m http.server`: corner boards render flat
  on both walls at every corner with contrasting colours; a 9/12 front with a
  3/12 rear and a 2'-6" ridge step renders the clerestory and the sailing rear
  plane in the left-end elevation; the ridge hint prints the split, the step and
  the sail; switching the sail off closes it back to the peak.
