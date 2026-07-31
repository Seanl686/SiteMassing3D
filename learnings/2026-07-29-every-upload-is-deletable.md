# Every upload can be deleted again, through one route

## What changed

Uploads were one-way for three of the five asset kinds. Home photos and slotted
lot photos had a `Clear`; the site plan page, the floor plan tracing plate and
the 360 panorama had nothing — the only way to correct a wrong file was to load
another over it, and the free-form site photo could not even be replaced without
loading a different photo.

- `src/assets.js` gains `removeAsset(home, id)`: the one place the deletion of a
  loaded image mutates state, keyed by the same registry id `collectAssets()`
  hands out. DOM-free and three.js-free, so it is unit-tested. Returns
  `{ removed, kind, label, alsoPlate }`.
- `src/main.js` gains `deleteAssetById(id, opts)` — confirm, call `removeAsset`,
  then do only the visible clean-up per kind (redraw the plate, rebuild the
  scene, re-render the lists, `assetsChanged()`, `save()`).
- Asset rail: every card gets a `✕` delete (`.asset-del`, dim until row hover).
  It calls `stopPropagation` because the card itself jumps to the owning panel.
- New panel buttons, shown only when something is loaded: `btnDeleteSitePlan`,
  `btnDeletePlate`, `btnDeletePano`, plus `Delete photo` on the free-form photo
  row. Visibility is driven from `syncDeleteButtons()` inside `assetsChanged()`.
- Home photo cards and slot cards now say `Delete` (danger styling) and route
  through the shared deleter, so the confirm and the clean-up are the same
  wherever the user clicks.
- `deleteFreePhoto()` handles `sitePhoto`, which lives outside the registry.

Deleting the site plan also drops the tracing plate **when they are the same
drawing** (`planPlateLinked`), and leaves a separately-chosen plate alone.

## Why it mattered

A stale asset is worse than a missing one: the package ships it and the render
follows it. Without a delete, one wrong file made the whole project the unit of
repair — and the site plan in particular kept a base64 PDF in localStorage that
nothing could evict.

## Gotchas / pitfalls

- Deleting a lot photo deletes its **saved site view**. The alignment and camera
  stored beside the photo are meaningless without it, and a photo-less view would
  still be offered as a render pass.
- `collectAssets()` lists a linked tracing plate as its own card even though it is
  the same image as the site plan page, so the rail shows two rows for one
  drawing. Deleting either one is handled; do not "fix" the count without
  deciding what the plan panel should show.
- `sitePlanFile` (the picked File, used to re-render another PDF page) must be
  nulled on delete, or the panel offers to re-render a page of a plan that is no
  longer loaded.
- The panorama's `show` flag has to go false with its `src`; a switched-on
  panorama with no source leaves the site backdrop in a half-state.
- The free-form photo is not in the registry — a "delete every asset" sweep over
  `collectAssets()` will silently miss it.

## Verification

`npm test` — 62 tests, 62 pass, including two new ones: test 60 deletes one of
every kind and asserts the linked plate, the PDF, the active-view id and the
panorama `show` flag all go with them (and that a second delete is a no-op, not a
throw); test 61 asserts an unlinked plate survives deleting the site plan.
`node --check` on the touched modules. The DOM wiring itself was not exercised in
a browser — the Chrome extension was not connected in this session.
