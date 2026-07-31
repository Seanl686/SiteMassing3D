# Zooming the site photo out revealed blank space, not more photo

## What changed

- `css/app.css` — `.site-photo-bg` is now twice the stage in both directions and centred on
  it (`top/left: -50%`, `width/height: 200%`), so a rotated or zoomed-out photo still has
  paint under the stage edges. `#stage` clips the overflow.
- `src/main.js` — the zoom moved off the element and onto the image. `plateSize()` returns the
  background size in CSS pixels for the mode ('camera' = `scale x stage height`, plus cover and
  stretch), `plateAspect()` caches the image's natural proportions and re-runs the plate update
  once the image decodes, pan is applied through `background-position: calc(50% + Npx)`, and
  the element's transform is now `rotate()` only.

## Why it mattered

The plate element was exactly stage-sized with `transform: scale()`. Scaling the element
shrank the window you were looking through at the same rate as the photo inside it, so zooming
out could never uncover the parts of the photo cropped at the stage edges — it just added
letterboxing. On a wide panorama (the case that surfaced it: 1600x404 in a 1009x1202 stage,
cropped to a 4760px-wide draw at scale 1) most of the image was unreachable at any zoom.

## Gotchas / pitfalls

- Scaling the *container* is not zoom. Zoom has to change the image's drawn size while the
  viewport stays put — `background-size` in px, not `transform: scale`.
- `background-position: 50%` inside the double-size box still resolves to the stage centre,
  because the box is centred on the stage. Percentage positions align the image's own N% point
  with the container's N% point, so `calc(50% + Npx)` is centre-plus-offset.
- The CSS fallback size is `auto 50%` — 50% of the double-height box is one stage height. Using
  `auto 100%` there silently doubles the photo until the image decodes.
- `src/capture.js` already scaled the image rather than the frame (`ctx.scale` then draw at
  `h` tall), so the export path needed no change — it was the live view that disagreed with it.
- An image whose aspect is far from the stage's will still show empty bands when zoomed to fit;
  that is the source photo's shape, not a bug. 'Fill stage (cover)' trades it for cropping.

## Verification

- `npm test` — 24/24 pass.
- Probe on a 1600x404 photo in a 1009x1202 stage: background-size tracks zoom linearly
  (4760x1202 at 1.0, 2856x721 at 0.6, 1666x421 at 0.35, 9521x2404 at 2.0) while
  background-position stays fixed — so zooming out now brings the whole panorama into frame.
  Screenshot at 0.4 shows the full photo width with the model still registered on it.
