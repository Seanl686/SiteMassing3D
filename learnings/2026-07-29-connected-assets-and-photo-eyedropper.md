# Connected assets, and picking the finishes off the photograph

## What changed

Two related things: the panels now know about each other's uploads, and the
exterior colours can be sampled straight off a photo of the real home.

**New modules**

- `src/assets.js` — DOM-free registry of every image the project holds
  (`collectAssets`, `assetInventory`, `finishSampleAssets`, `planPlateLinked`,
  `missingHomePhotoNames`). Each asset carries the panel that loaded it, so any
  list of assets can offer to jump back to the control that owns it.
- `src/eyedrop.js` — DOM-free colour maths: `sampleAverage` (box average that
  skips transparency), `samplePixels` (fixed stride), `quantize` (median cut),
  `suggestFinishRoles`, plus hex/rgb/luma/saturation helpers.
- `src/colorpick.js` — the eyedropper dialog. Builds its own markup, so the
  whole feature is one file. Zoom/pan, a pixel loupe, four sample-box sizes,
  a per-photo dominant-colour palette, auto-assign, per-surface revert.

**Wiring in `src/main.js`**

- `assetsChanged()` is the single broadcast. `renderSlotList()` calls it (every
  lot-photo path funnels through there), and the site plan / tracing plate /
  panorama / free-form photo / home photo paths call it explicitly.
- `revealPanel(id)` opens a collapsed accordion, scrolls to it, and flashes it.
- Loading a site plan in **PKG** now also drops it on the ground as the **PLN**
  tracing plate, when the plate is empty or already showing that same page. A
  plate the user loaded separately is left alone.
- **PKG** grew an "Everything loaded so far" rail, and every include-checkbox
  now states what it will actually put in the zip (`3 of 5 loaded`,
  `nothing loaded`).
- **HOM** photos grew a `🎯 Colours` button and a line saying what they feed.
- **MAT** grew a source strip of every sampleable photo, a `🎯` button on every
  one of the nine colour inputs, and a "Pick colours off the photo" button.
- **PHT** free-form photos offer to be banked into one of the four lot slots,
  since a free-form photo belongs to no view and is lost on the next apply.

`index.html`: five new hosts (`assetRail`, `planLinkRow`, `matPhotoSources`,
`homePhotoLinks`, `freePhotoLinks`) plus the MAT "Match The Real Home" block.
`css/app.css`: asset cards, package count tags, link notes, source chips, panel
flash, and the whole eyedropper dialog. Stylesheet bust `?v=14` → `?v=15`.

Tests 48–53 added in `tests/app.test.js`.

## Why it mattered

The panels were built one at a time and each ended up owning its uploads in
isolation. The visible cost: the same PDF page got loaded twice — once as the
site plan for the package, once as the tracing plate — and a photograph of the
real home could sit unused two panels above the nine colour fields it answers.
The package panel would also happily offer to include home photos that were not
there, which is the kind of thing you only discover by opening the zip.

The colours were worse. They were typed as hex, which means they were guessed,
and the guess is always a little too clean: vinyl siding photographs greyer and
cooler than its swatch name, and a roof read by eye off a catalogue shot lands
a couple of shades light. Every one of those errors then propagates into the
brief, the plates and the final render. The photograph already holds the exact
answer — it just had no way of reaching the fields.

## Gotchas / pitfalls

- **`style.display = ''` does not show an element whose CSS says `display:none`.**
  It reverts to the stylesheet, which is the `none`. The loupe, the readout and
  the empty-state all have to be set to an explicit `'block'`/`'flex'`.
- **A static canvas sized from its own parent's rect is a growth loop.** The
  picking canvas is `position:absolute; inset:0` so it measures the stage rather
  than defining it.
- **Sample one pixel and two picks on the same wall disagree.** JPEG blocking,
  sensor noise and the speckle in a shingle move a single pixel several shades.
  The default is a 5×5 average; that is what makes the tool feel accurate.
- **Palette extraction must be deterministic.** Median cut over k-means, and a
  fixed stride over random sampling — otherwise the suggested colours shuffle
  between one visit to the same photo and the next, which reads as a bug.
- **An eyedropper button inside a `<label>` activates the label.** Without
  `preventDefault()` the native colour swatch pops open behind the dialog.
- **A `<dialog>` dismissed with Escape must not keep its preview.** Every pick
  previews live onto the model, so the `cancel` event has to be intercepted and
  routed through the same restore path as the Cancel button.
- `adoptPlate` in `applySitePlanFile` is computed **before** `state.home.sitePlan`
  is reassigned — it asks what the plate was linked to a moment ago.
- Freeing `fullCanvas`/`fullData` on close is not optional; those are
  multi-megabyte buffers held per open photo.

## Verification

- `npm test` — 54 tests, all pass (48–53 are new).
- `node --check` on all four touched/new source files.
- Every element id the new code reaches for was checked against `index.html`.
- Not yet exercised in a live browser: the Chrome extension was not connected in
  this session, so the dialog's pointer/zoom/loupe behaviour is verified by
  reading rather than by clicking. Worth a manual pass before packaging.
