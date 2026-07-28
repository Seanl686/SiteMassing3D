# Making the PNG export match the viewport, and proving it

## What changed

Four ways the export disagreed with the screen, all in `src/capture.js` unless noted:

1. **Photo rotation pivot.** The canvas rotated about the *photo's* centre
   (`translate(w/2+pan)` then `rotate`), while CSS rotates the plate element about the *stage*
   centre, which carries the pan around with it. Any project with both a rotation and a pan
   exported the photo in the wrong place. Now `translate(w/2,h/2) -> rotate -> translate(pan)`,
   matching the CSS transform order exactly.
2. **"Block landscape" ignored.** The live plate hides when `scene.blockLandscape` is on; the
   export drew the photo anyway. `useBgPhoto` now tests the same flag.
3. **Ground grid force-hidden.** Export unconditionally hid the grid whenever a photo or alpha
   was in play, so a view with the grid on exported without it. The grid is part of the view
   now; only alpha (cutout) exports still drop it, since they exist to be composited.
4. **Backdrop colour.** With a photo showing, the WebGL canvas clears transparent, so on screen
   the letterboxed bands fell through to the page colour while the export filled them with
   `scene.bg`. `syncStageBackdrop()` in `src/main.js` paints `#stage` with `scene.bg`, and the
   export only fills when `bgVisible !== false`.

Also: `shoot()` had a magic `exportOpts.w !== 1200` guard that silently ignored a width of
exactly 1200, and export height was never used — the height always follows the live aspect,
because both cameras hold a fixed vertical extent and a free height would change what is in
frame. The height field and the "Match height to current view" button (was "Fit pixel aspect
to current view", which guessed a ratio from the subject) now report that real number.

## Why it mattered

"Is the export what I'm looking at?" has to be answerable with yes. Three of the four
mismatches only showed up in specific states — rotated photo, block-landscape on, grid on —
which is exactly the kind of thing that gets noticed after a plate has been sent to a client.

## Gotchas / pitfalls

- CSS `background-position: calc(50% + Npx)` stays unresolved in `getComputedStyle`, and a
  negative offset serialises as `calc(50% - Npx)`. A harness that only matched the `+` form
  read the Y offset as X and reported a 130px error that did not exist. Verify the harness
  before believing a failure — two rounds of this were measurement bugs, not app bugs.
- Percentage background positions resolve against `(box - image)`, so with the plate box
  centred on the stage the image centre is `stageCentre + pxTerm`, independent of box size.
- `python3` `str.replace` is a silent no-op when the pattern has drifted (a concurrent session
  had rewritten `doShot`). Assert every anchor before writing the file.
- Comparing a 2x render against a 1x reference measures resampling, not framing. Framing has
  to be compared in normalised coordinates or by edge positions.

## Verification

Reference composite built ONLY from computed DOM styles (stage background colour, the plate's
computed background-size/position/transform/opacity, then the live WebGL canvas), diffed
against `renderToCanvas` output at the same pixel size. Buffer 3270x2005, grid on, photo on:

| case | mean channel diff | pixels >8 | pixels >32 |
|---|---|---|---|
| model + grid + backdrop | 0.0004 | 0% | 0% |
| full composite with photo | 0.231 | 0.26% | 0.07% |

The residual is confined to high-frequency foliage, where the CSS background scaler and canvas
`drawImage` resample differently; flat regions are bit-identical.

Geometry, measured as photo edge positions in both composites (model hidden):

| case | on screen | exported | delta |
|---|---|---|---|
| rot 0, pan (0,0) | y 552-1452 | y 552-1452 | 0 |
| rot 12, pan (-9,6) | y 316-1894 | y 316-1894 | 0 |
| rot -25, pan (15,-11) | x0 4, y 0-1838 | x0 4, y 0-1838 | 0 |
| rot 8, pan (20,0) | x0 200, y 364-1686 | x0 200, y 364-1686 | 0 |
| block landscape on | no photo | no photo | matches |

Framing across export resolutions (photo top edge as a fraction of frame height): 0.3312 at
3270x2005, 0.3300 at 1635x1003, 0.3307 at 6540x4010, 0.3303 at 1600x981, 0.3297 at 900x552 —
constant to within integer-row rounding.

Export sizing through the real Screenshot button (file write stubbed): 1200 -> 1200x736,
2400 -> 2400x1472, 3000 -> 3000x1839, all at aspect 1.630-1.631 against a live aspect of
1.6309, with the height field updated to match.

`npm test` — 24/24 pass.
