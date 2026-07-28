# Site-photo camDist corrupted by ortho view changes

## What changed

- `src/main.js` `syncCameraStateToForm()` — only reads/writes `home.sitePhoto.camDist` when `stage.camera === stage.persp`.
- `src/main.js` `rebuild()` — only calls `stage.setCameraDistance(sp.camDist)` when `stage.camera === stage.persp`.

## Why it mattered

`stage.getCameraDistance()` / `setCameraDistance()` are hardcoded to `stage.persp`. `syncCameraStateToForm` ran on both `controls` and `orthoControls` `change` events, so panning/zooming an elevation (ortho) view computed a bogus distance from the untouched perspective camera and stomped `sitePhoto.camDist`. Any later `rebuild()` (any panel edit) then snapped the perspective camera to that stale distance — the view visibly reset to a "pre-adjustment" state, including around PNG export. A separate, now-fixed bug (commit `ed93569`) had already corrected `renderToCanvas`'s own camera save/restore; this was an independent corruption source.

## Gotchas / pitfalls

- `camDist` only has meaning for the perspective camera (it aligns the site photo to a photographed vantage point); any code path touching it must gate on the active camera, not assume `persp` is active.

## Verification

Reproduced live via `window.__app` in Chrome: set a custom persp position, switched to the `front` ortho view, dispatched an `orthoControls` `change` event — before the fix `sitePhoto.camDist` was overwritten with a distance derived from the stale persp position; after the fix it is untouched. `npm test` — 18/18 pass.
