# Making the eyedropper zoom feel like an instrument

## What changed

The eyedropper's zoom was rebuilt. `src/eyedrop.js` gained two pure functions,
`zoomAnchoredPan` and `wheelZoomFactor`; `src/colorpick.js` now uses them and
handles the full pointer stream.

- **Cursor-anchored zoom.** `zoomAnchoredPan` returns the pan that keeps the
  image point under the anchor exactly where it is. Wheel and pinch anchor on
  the pointer; the slider, the ± buttons and the keyboard anchor on the frame
  centre.
- **Device-normalised wheel.** `wheelZoomFactor` scales by the delta rather
  than counting events, converts `deltaMode` 1 (lines) and 2 (pages) to pixels,
  gives `ctrlKey` wheels (trackpad pinch) their own rate, and clamps one event
  to [0.5, 2].
- **Two-finger pinch.** A `pointers` Map tracks every live pointer. Two of them
  is a pinch: the midpoint's travel pans and the spread zooms, in one call and
  one redraw. Lifting to one finger continues as a pan and can never land as a
  colour pick.
- **Logarithmic slider** (0..1 position → zoom), with ± buttons, a live `3.2×`
  readout, and `+` / `-` / `0` keys.
- **Derived zoom ceiling.** `maxZoom()` is whatever gives about 24 screen pixels
  per image pixel, clamped to 2..60 — so an 800 px photo and a 4000 px one each
  stop somewhere useful instead of sharing a hardcoded 8.
- Tap slop is 4 px for a mouse and 12 px for touch/pen, measured as straight-line
  distance from where the press started. The loupe sits 52 px from a fingertip
  and 18 px from a mouse pointer.
- Gesture state lives at module scope and is cleared on both open and close.

`css/app.css` gained the zoom group styles; bust `?v=15` → `?v=16`.
Tests 54 and 55 added.

## Why it mattered

The first version zoomed about the centre of the image in fixed 1.15× steps off
a linear 1–8 slider, with no touch support at all. Every one of those is a
distinct failure:

- Centre-anchored zoom slides the pixel being aimed at out from under the
  cursor exactly when it is being aimed at, so each zoom needs a corrective
  drag. This is the single thing that makes a picker feel like it is fighting
  you.
- A per-event step is calibrated for exactly one input device. A trackpad sends
  dozens of small deltas per flick and became hypersensitive; a notched wheel
  sends one and was too coarse.
- `touch-action: none` is required to get the pointer stream, and it also
  disables the browser's own pinch — so a touch screen had no way to zoom at all.

## Gotchas / pitfalls

- **`touch-action: none` takes away pinch as well as giving you pointers.** If
  you set it you now own zooming, on every input device.
- **A trackpad pinch is a `wheel` event with `ctrlKey`**, not a gesture event,
  and its deltas are an order of magnitude smaller than a scroll's. Without a
  separate rate, pinching appears to do nothing.
- **`deltaMode` is not always 0.** Firefox reports lines; a line is worth about
  16 px. Ignoring it makes Firefox zoom 16× slower than Chrome.
- **Pan-then-zoom in one event needs one function, not two.** Nudging the pan
  and then anchoring against `view.ox` from the previous frame anchors against
  stale numbers. `setZoom` takes the pan delta and applies it before solving.
- **Accumulating `|dx| + |dy|` per move over-counts a wobble** and trips the
  drag threshold on what was meant to be a click. Measure straight-line distance
  from the press origin.
- **A second finger must retroactively cancel the first finger's tap**, and
  lifting back to one finger must not re-arm it — otherwise every pinch ends by
  assigning a colour.
- **Gesture state must be module-scoped and reset on open**, or closing the
  dialog mid-pinch leaves a phantom pointer for next time.
- Smoothing should be keyed off the final scale, not the zoom factor: at fit,
  a large photo is already downscaled and wants smoothing; past ~2 screen pixels
  per image pixel it is inventing colours between the ones being sampled.

## Verification

- `npm test` — 56 tests, all pass. 54 asserts the anchored point does not drift
  across four successive zoom steps and back out again; 55 asserts a line-mode
  delta and the equivalent pixel-mode delta produce the same factor, that a
  trackpad tick is tiny, that pinch outpaces scroll, and that the clamp holds.
- `node --check` on both touched files.
- Still not exercised in a live browser — the Chrome extension was not connected
  in either session. The pointer/pinch paths are verified by reading and by the
  pure-function tests, not by touching a screen.
