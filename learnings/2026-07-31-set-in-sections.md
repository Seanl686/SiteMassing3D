# Set-in sections: one part of the home narrower, deeper, or porched

## What changed

- `src/build.js` — `solveRoof()` no longer assumes the walls are at `±W/2`. It
  takes `zFront`/`zBack`, the section's actual wall lines, and the meeting-point
  algebra is written against them:

  ```
  front: y = eaveYFront + slopeF * (z - zFront)
  back:  y = eaveYBack  + slopeB * (zBack - z)
  z = (eaveYBack - eaveYFront + slopeB*zBack + slopeF*zFront) / (slopeF + slopeB)
  ```

  With the walls at `±W/2` that reduces to the old centreline form, so a home
  without insets solves exactly as before.
- `src/build.js` — sections gain `frontInsetFt`/`backInsetFt`, and carry
  `zFront`, `zBack`, `widthFt` and `inset`. Positive pulls that wall line inward
  (that part is narrower); negative pushes it out (that part is deeper).
- `src/build.js` — the roof planes, the eave fascia, the flat deck and the
  section transition band all measure off `sec.zFront`/`sec.zBack` instead of the
  base rectangle.
- `src/build.js` — `buildWall()`'s section cuts now carry a **depth** as well as
  a top, so a set-in stretch of long wall is moved inward through the same
  `addBand(..., depth)` path a bump-out already used. A `sectionReturn` closes
  the step where two neighbouring sections sit at different depths.
- `src/build.js` — gable ends are built over `gu0..gu1`, the u-range of the
  section at that end, so an end wall narrows with its section.
- `src/build.js` — new `wallInsetAt(name, u, dim)`. `buildBump()` offsets its
  whole frame by it, so a porch on a set-in stretch stands against the moved
  wall; `bandOf()` adds it so an opening in that stretch travels with it.
- `src/build.js` — `buildSkirting()` returns a group with one block per section,
  each as wide as that section's own footprint.
- `src/defaults.js` / `src/ui.js` / `index.html` — two more per-section fields
  and a plan line in the section readout.
- `tests/app.test.js` — tests 78–79.

## Why it mattered

`bumps.js` moves a stretch of **one wall**; the main roof, the gable ends and the
skirting all ignored it and stayed on the base rectangle. There was no way to say
"this half of the house is set in" and have the roof come with it.

## Gotchas / pitfalls

- The inset had to go through the **existing band depth machinery**, not a new
  mechanism. `addBand(x0, x1, y0, y1, mat, depth)` already moves a run of wall
  along its inward axis for bump-outs and recesses; reusing it means a bump on a
  set-in stretch composes (`insetAt(u) + bandDepth(band)`) instead of the two
  fighting over the same wall.
- A bump's depth is measured **from the wall it sits on**, which may itself have
  moved. `buildBump()` offsets its `at()` helper rather than each piece, so decks,
  posts, railings and roof caps all shift together — offsetting the pieces
  individually is how you get a porch whose railing is 5 ft from its own deck.
- A narrower section peaks **lower** at the same pitch, and its ridge is at the
  middle of *its* span, not the home's. That is correct and is exactly why the
  solve had to move off `±W/2`: keeping the old form and just clipping the roof
  would have left the planes floating above their own eaves.
- `zBack` is clamped to at least `zFront + 1`. Insets that cross leave a
  zero-or-negative width, which produces `slopeF + slopeB` divisions by zero and
  NaN positions that quietly poison the whole scene graph.
- `buildSkirting()` used to return a mesh and now returns a group. Anything that
  did `root.children.find(c => c.name === 'skirting')` still works, but code
  expecting `.geometry` on it would not — there was none, but it is the kind of
  thing worth grepping for before changing a builder's return shape.
- The front wall's u axis runs opposite world X, so `wallInsetAt()` converts with
  `x = L/2 - u` on the front and `x = u - L/2` on the back. Getting it backwards
  sets in the wrong half and looks plausible in a three-quarter view.

## Verification

- `npm test` — 79/79 pass.
- Manual, in Chrome against `python3 -m http.server`: a 56 ft home split at 30 ft
  with the wing set in 5 ft on the front renders the L-shaped footprint in plan,
  the narrower lower roof over the wing, the return wall at the step, and a
  covered porch sitting against the set-in wall; setting both insets to 4 ft
  narrows it all round with the ridge back on the centreline; a −6 ft inset runs
  that half 6 ft deeper than the rest with its roof and porch following.

---

## Follow-up: rake board buried in the deck, dormer eave trim on the wrong colour

Reported from a render: the white fascia colour was not reaching the rake trim,
and something was misaligned at the gable.

- **Rake board inside the deck.** The board was positioned at `xa + RAKE_W / 2`,
  measuring *inward* from the roof edge — but the roof plane spans `xa..xb`, so
  the board sat entirely inside the slab. Only the 0.05 ft that pokes above the
  plane was visible, z-fighting with the slab's own end face, which reads as a
  dark bar cutting across the white board. Fixed by measuring outward
  (`xa - RAKE_W / 2`, `xb + RAKE_W / 2`) so the board trims the edge instead of
  hiding in it. Same class of error as the corner boards, in the opposite
  direction — there the boards were measured outward when they should have been
  inward.
- **Dormer eave trim was casing.** The false eave return bands, the inner return,
  the cap fascia and the drip edge were all on `materials.trim`. They are eave
  boards, so they now take `materials.fascia`. The dormer *window* frame stays on
  the casing trim, which is what it is.
- **Dormer bands did not follow `fasciaWidthFt`.** Their heights were hardcoded,
  so a deeper fascia left the dormer band stranded above the main eave line. They
  now scale by `fasciaWidth(dim) / FASCIA_H`, which is exactly 1 at the default
  0.55 ft — so the geometry is unchanged until the width is actually edited.

Test 80 covers all three and was checked against the old code, where it fails on
the buried board.
