# A loaded backdrop survives every mode, and exports land in the project folder

## What changed

Ticking **Wireframe view mode** wiped the lot photo behind the model. So did
every other scene toggle, and the photo did not come back when *Block landscape*
was switched off. Underneath were five separate faults, all of them about who
owns the backdrop.

**`src/scene.js`**

- `refreshBackground(o)` is now the ONE place that decides what the canvas is
  cleared to. Two cases need a transparent buffer rather than the background
  colour: the lot photo (a DOM plate *behind* the canvas, so it only shows
  through a transparent one — signalled by the new `stage.plateBackdrop` flag),
  and a panorama under wireframe (see below). `applySceneOpts` calls it instead
  of assigning `scene.background` itself, which is what used to blow the photo
  away on every unrelated toggle.
- `setBackground(color)` moves the background and the renderer's clear alpha
  together. They were set in different places, so an export — which restores the
  colour and left the alpha at 1 — handed back an opaque canvas that hid the next
  photo loaded.
- The hidden-line mask now **erases** (`NoBlending`, `opacity: 0`) instead of
  painting the background colour. Painting only works when there IS a background;
  over a photo it covered it with a slab. Writing no colour at all (`colorWrite:
  false`) fixed that but let the ground grid — drawn *before* the mask — x-ray
  through the home. Erasing does both jobs.
- `syncPanoBlending()`: the panorama is inside the same buffer, so erasing takes
  it out too. Under wireframe it is drawn last instead, depth test off, with a
  destination-over blend that fills only pixels nothing has claimed — the
  silhouette the mask just cleared. That is also why a panorama under wireframe
  needs a transparent clear: an opaque one claims every pixel.
- `setTrueColor` reads `userData.solidMaterial` when wireframe has swapped the
  real material out, so a true-colour change made in wireframe is not lost on the
  way back.
- `wireframeStroke()` picks the stroke for contrast and re-tints the live edge
  material whenever the backdrop changes.

**`src/main.js`**

- `updateSitePhotoPlate()` claims the backdrop (`stage.plateBackdrop`) and defers
  the colour decision to `refreshBackground`.
- Scene checkboxes, the sun/focal sliders and the background colour input all
  re-run `updateSitePhotoPlate()`. *Block landscape* now rebuilds, because it
  takes the panorama with it.
- The wireframe checkbox and the toolbar button were two switches for one mode
  and drifted apart; both now go through `applySceneOpts` and keep the button's
  `active` class level with the checkbox.

**`src/outdir.js` (new), `src/capture.js`, `index.html`** — a project output
folder. Pick it once under *Scene, View & Screenshot Export* and every render,
brief, project JSON and package is written straight into it with no Save-As
dialog. `saveWithPicker` tries the folder first, then the file picker, then a
plain download, so every existing export path inherits it. The handle lives in
IndexedDB (localStorage cannot hold one) and is NOT part of the project: it
points at a place on this machine, and a project JSON opened elsewhere has no
business pointing anywhere.

## Why it mattered

A lot photo is the whole point of the app — the plate is only useful aligned to
it. Any mode that silently threw it away made the user reload the photo and redo
the alignment, and wireframe is exactly the mode you flip into to CHECK an
alignment. Exports had the matching problem at the other end: the files that
matter landed in the downloads pile instead of next to the project.

## Gotchas / pitfalls

- `scene.background = null` alone is not enough for a see-through canvas: the
  renderer's clear alpha has to be 0 as well, and an export path that sets one
  without the other leaves a trap for the next feature. Use `setBackground`.
- Draw order decides what a mask can undo. Anything drawn before it (grid,
  ground, plan plate) is erased; anything after (the edge lines) survives — hence
  `renderOrder = 10` on the edges. Do not leave it to the render sort.
- Destination-over compositing only works into an unclaimed buffer. Pair it with
  a transparent clear or the effect inverts: the backdrop fills the model's
  silhouette and nothing else.
- A directory handle is not JSON. IndexedDB structured-clones it; localStorage
  cannot. Permission does not survive a reload, so the first write each session
  prompts, and `requestPermission` has to be reached from a user gesture.

## Verification

- `npm test` — 59/59 pass.
- Driven live in Chrome against `python3 -m http.server`, sampling exported
  pixels rather than eyeballing: with a lot photo loaded, the plate stays up and
  the background stays transparent across wireframe on/off (checkbox AND toolbar
  button), grid, true colour, sun, block-landscape on and off, view presets,
  ortho/perspective, rebuilds and reloads. Under wireframe the pixel at the
  centre of the home reads as the photo, and as siding with wireframe off.
- Panorama case: full frame in both modes, backdrop visible through the
  silhouette under wireframe, restored to the opaque pass on the way out.
- Export round trip (`renderToCanvas`, plain and alpha) leaves background and
  clear alpha as it found them.
- Reload restores the site photo, panorama, site plan, tracing plan and the
  wireframe mode with both controls in sync.
- Output folder: with none set, `writeToOutputFolder` returns null and the old
  picker/download path runs unchanged.
