# Site photo and model drifting apart on window resize

## What changed

The model and the photo plate were scaling by two different rules. Now both are locked to
the viewport HEIGHT, and a width change only reveals more scene at the sides.

- `src/scene.js` — `reframeOrtho()` took a `{ refit }` option. `refit: true` (only when a view
  preset is applied) sizes the frustum from the stored fit box; every later call keeps the
  established half-height in `_orthoHalfH` and changes left/right alone. Previously every
  resize recomputed `hh = max(fit.h/2, (fit.w/2)/aspect) * pad`, so narrowing the window
  zoomed the orthographic camera out while the perspective camera and the photo did not.
- `src/main.js` — the plate is sized `auto 100%` (height-locked) and panned in pixels derived
  from the stage height, on both axes. `updateSitePhotoPlate()` now runs on every resize and
  on the sidebar toggle. The photo drag converts cursor pixels using the height too, so it
  tracks the mouse 1:1. Added `convertPhotoPanBasis()`, a one-time boot conversion of pan X
  from the old width-relative percentage.
- `src/capture.js` — export compositing uses the same rule (`drawH = h`, `drawW = h *
  imgAspect`, pan as a fraction of `h`), so a PNG at any aspect matches the viewport.
- `src/defaults.js`, `index.html` — plate modes renamed: `contain` -> `camera` ("Lock to
  camera"), `100% 100%` -> `stretch`. `camera` is the default and the only mode that tracks
  the cameras; `cover` and `stretch` are kept but labelled with what they cost.

## Why it mattered

A perspective camera holds its vertical fov, so the world's vertical extent at a given
distance is constant and world-per-pixel depends on height alone. `background-size: contain`
scales off whichever axis binds first, and pan X was a percentage of width. Resize the window
and the two moved against each other — the model appeared to shift perspective relative to
the site photo.

## Gotchas / pitfalls

- The invariant to test is `(screenX - w/2) / h` and `(screenY - h/2) / h` for a fixed world
  point. If those hold across resizes, anything else scaled off height stays registered.
- CSS `transform: translate(...) scale(...)` applies the translate *unscaled*; the canvas
  path (`ctx.translate` then `ctx.scale`) matches. Do not multiply pan by zoom in either.
- Pan X saved before this change was width-relative. The conversion runs once at boot using
  the current stage size and stamps `sitePhoto.panBasis = 'height'`, so it preserves the
  alignment at the window size the project was last used at — not at every size.
- `reframeOrtho()` now defaults to `refit: false`. A new caller that genuinely wants to
  re-fit the subject (a "zoom to fit" button) must pass `{ refit: true }`.

## Verification

- `npm test` — 24/24 pass.
- Browser probe of a fixed world point (wall-top corner) at stage sizes 600x700, 900x700,
  600x500 and 1000x900: normalised offsets held at `nx -0.1301 / ny -0.0792` for the
  perspective camera and `nx -0.3399 / ny -0.0513` for the front elevation's orthographic
  camera — invariant in every case.
- Plate probe at the same sizes: `background-size: auto 100%` and `translate/h` constant at
  `0.12 / -0.08`, matching the camera invariant exactly.
