# AI render package: one zip, a converted site plan, and a measured brief

## What changed

The app now ships its actual deliverable — a single `.zip` that hands an image
model everything it needs at once — instead of leaving the user to collect eight
separate downloads and hand-write a prompt.

New modules:

- `src/zip.js` — store-only ZIP writer (~120 lines, no dependency). CRC32, local
  headers, central directory, EOCD. Payload is PNG/JPEG, which deflate cannot
  shrink, so compression buys nothing and costs a dependency.
- `src/brief.js` — DOM-free generator for `01-BRIEF.md`: the prompt from
  `../SITE-RENDER-PROMPT-TEMPLATE.md` with the blanks filled from live state
  (footprint, ratio, ridge height, colours by plain-English name, siding style,
  and the full opening schedule for all four walls).
- `src/framing.js` — projects the home's bounding box through the live camera
  and reports where it lands: `left`/`right` as fractions of frame width,
  `ridgeTop` as a fraction of frame height, the nearest corner, and which walls
  the camera can see.
- `src/siteplan.js` — site plan intake. PDF page → PNG via vendored pdf.js
  (lazy `import()`), or a plain image re-encoded.
- `src/package.js` — assembles and saves the package.

Modified:

- `src/capture.js` — `plateCanvas()` and `contactSheetCanvas()` split out of
  `shoot()` / `contactSheet()` so plates can be produced without downloading;
  `withRestoredCamera()`; `canvasToPngBytes()`; `burnCaption` and `slug` exported.
- `src/defaults.js` — `home.sitePlan` and `home.brief` (+ `defaultBrief()`),
  both migrated.
- `src/main.js` — the PKG panel wiring, the live framing readout, copy/save
  brief, and history/quota handling for the new images.
- `index.html` — the `PKG — AI Render Package` panel.
- `vendor/pdf.min.mjs`, `vendor/pdf.worker.min.mjs` — pdfjs-dist 4.10.38.

Tests 28–32 cover the zip container (verified against real `unzip`), CRC32 and
data-URL decoding, the brief's measured numbers, the derived vocabulary, and the
new state surviving a save/reopen round trip.

## Why it mattered

The three assets a polished lot render needs — massing geometry, lot photo, site
plan — were being exported one at a time and re-described by hand each session.
Two failure modes came out of that:

1. **Half the assets reached the model.** A numbered manifest inside one zip,
   with the brief naming each file, closes that.
2. **The prompt's numbers went stale.** The template's `{{X1}}–{{X2}}` scale
   blanks were guesses, and the `W' x L'` line was retyped per home. Both are now
   measured: the footprint off the model, the framing off the camera. A guessed
   percentage is the thing image models silently ignore; a measured one they act
   on.

The site plan arriving as a PDF was a documented manual step (`magick -density
200 file.pdf[0] …`). It is now a file picker.

## Gotchas / pitfalls

- **One lot photo renders one view.** The four-view contact sheet is a *geometry*
  reference, not four renders — each view would need its own lot photo shot from
  that camera position. This is stated in the panel, the package README and the
  brief itself, because asking for a viewpoint the lot photo was never shot from
  is the workflow's most common failure. Do not quietly drop that wording.
- `withRestoredCamera()` must be promise-aware. Plate rendering is async
  (`canvas.toBlob`), so a plain `try/finally` restores the camera before the
  first plate has encoded, and every subsequent plate renders from the wrong
  view. The old `contactSheet()` also restored by *re-applying the preset*,
  which silently threw away the user's own framing; it now saves and restores
  `cameraState()`.
- The site photo is hidden while the elevation plates render and put back in a
  `finally`. A backdrop behind a geometry plate reads to the model as part of
  the home.
- pdf.js renders a transparent background: fill the canvas white first or the
  plan flattens to black.
- Site-plan images are excluded from undo snapshots (attachment, not a modelling
  decision) and dropped from the localStorage lean-save fallback, the same way
  the site photo and floor-plan plate already were. The original PDF is only
  kept under 8 MB.
- `measureFraming()` returns `null` when the model is behind the camera or out
  of frame; the brief then falls back to `{{X1}}` blanks rather than printing a
  clamped number that looks measured but isn't.

## Verification

- `npm test` — 33/33 pass (5 new tests).
- Zip validated outside the browser: generated via node, `unzip -t` reports no
  errors, `unzip -l` shows correct sizes and dates, UTF-8 entry content and
  names round-trip.
- Driven in Chrome against `python3 -m http.server 5173`:
  - `__app.buildPackage()` produced all 14 entries in ~840 ms.
  - Camera position and `sitePhoto.show` verified identical before and after.
  - A real 165 KB spec-sheet PDF (`TitanElevate/139160_117254_3196.pdf`)
    converted to a 1700×2200 PNG; sampled pixels are ~88% white with ~2% ink,
    i.e. line art, not a black or blank page.
  - Brief output checked for the measured ratio (`1.74×`), the framing
    percentages, and no unfilled `{{X1}}` blanks.
- Panel layout and persistence confirmed by screenshot after a reload.
