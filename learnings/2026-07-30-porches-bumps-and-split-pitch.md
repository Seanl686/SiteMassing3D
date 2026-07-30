# A porch, a bumped wall and an off-centre ridge

## What changed

The model could only be a rectangle under a symmetrical gable. A real spec sheet
is neither: the Redman 25610 is 58'-8" across the back and 56'-0" across the
front because the last bay is a recessed 6' porch, two walls carry `+16"`
box-outs, and the roof is a "4/12 Split Pitch" — which is why every gable-end
photograph of the model shows the peak sitting off centre.

**`src/bumps.js`** (new)

Pure data and pure math for every departure from the rectangle. A bump hangs on
one wall with `offsetFt` / `lengthFt` (measured left→right from outside, the
same convention an opening uses) and a **signed** `depthFt`: positive projects
out past the wall, negative cuts a recess in. `kind` is `porch` (open, posts and
railing) or `wall` (enclosed). `footprintExtents()` is the real ground box,
bumps included; `wallBands()` is where the siding gets cut.

**`src/build.js`**

- `derived()` now **solves** the ridge instead of assuming it. Two roof planes
  rise off the two long walls; the ridge is where they meet. Equal pitches and
  equal wall heights put it back at `z = 0`, so every earlier save is unchanged,
  but a split pitch — or a taller front wall — slides it off centre and the
  effective slopes are re-read off the solved ridge so both planes still land on
  their own eave. The legacy `slope` / `eaveY` / `ridgeY` keys still answer.
- Walls are built in **bands** rather than as one slab with holes. A bump does
  not punch a hole in the wall, it moves that stretch of wall: the band at the
  bump's position is rebuilt at `-depthFt` along the wall's inward axis, and the
  header of siding above it stays put. Openings inside a moved band, and their
  casings, travel with it.
- Gable ends take their two top corners from the walls they meet, so a split
  pitch or an uneven pair of long walls tilts the top edge and moves the peak
  along the wall. A per-wall height override still wins.
- `buildBump()` builds what closes the box — returns, reveals, ceiling, deck,
  skirting, posts, railing, and an optional flat / shed / gable cap.

**Everywhere the rectangle was assumed**: `framing.js` and `scene.js` measure
the picture off `footprintExtents()` (`stage.bumps` is set by `rebuild()`), the
brief prints a "where the footprint stops being a rectangle" table and a split
pitch line, and `homespec.js` asks a vision model for `bumps` and
`roofPitchBack` — a sheet that prints two disagreeing dimension lines is telling
you about a recess.

**UI**: a `BMP` panel with one row per bump, and a rear-pitch field beside the
roof pitch that reports the measured ridge offset.

## Why it mattered

The whole point of the app is that the plates are measurable — the front wall
really is `L/W` times the gable end, the ridge really is at the pitch you typed.
A porch faked as a shadow, or a symmetrical gable standing in for a split pitch,
breaks that quietly: the render comes back plausible and wrong, and nothing in
the package says which. Now the geometry carries it and the brief states it.

## Gotchas / pitfalls

- **A hole that touches the outline of a `THREE.Shape` triangulates badly.** A
  full-height recess is exactly that shape, which is why walls are cut into
  bands instead. Bands also give the moved face somewhere real to live.
- **An opening is only cut into a band that fully contains it.** One straddling
  a bump edge still draws its casing but gets no void. Clamp openings clear of a
  bump rather than expecting the wall to cope.
- **Sign conventions bite twice.** Local `+z` on a wall runs *inward*, so the
  moved face sits at `-depthFt` for both directions. And a recessed porch's
  posts belong at the wall line (`w ≈ 0`), not at `w = depth`, which is the back
  of the notch — the first cut put the railing against the house.
- **The ridge moves toward the taller wall**, not away from it. Two planes at
  the same pitch off eaves of different height meet nearer the high one.
- `roofPitchBack` blank ≠ 0. Blank means "match the front"; zero would mean a
  flat rear slope, which is not what an empty field is saying.

## Verification

- `npm test` — 68 pass. Six new cases: the solved ridge (both planes land on
  their eave, taller wall, flat roof), bump reading and clamping, the porch that
  leaves its wall alone, a full build with a recess + bump-out + split pitch
  (band counts, moved-face depth, finite bounding boxes), the brief's wording,
  and a spec-sheet read that carries a porch and a split pitch through
  validation, `applySpecToHome` and `migrate`.
- Headless elevation check: the built geometry was projected to SVG for the
  front, left-gable and three-quarter views. The gable end shows the peak off
  centre with the long shallow front slope and short steep rear one; the
  recessed porch shows posts on the wall line with the house wall and its window
  behind them; the projecting deck shows its own gable cap.
