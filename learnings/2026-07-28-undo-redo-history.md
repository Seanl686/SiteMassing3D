# Undo / redo for the project state

## What changed

- **`src/history.js` (new, DOM-free)** — `History` keeps a capped stack of plain-object
  snapshots with `record / undo / redo / peekUndo / peekRedo`. An identical snapshot is
  ignored, recording after an undo drops the redo tail, and consecutive edits carrying the
  *same label* inside `coalesceMs` merge into one entry. `describeChange(prev, next)` names the
  first field that differs ("roof pitch", "roof colour", "pan x site photo"), which drives both
  the button tooltips and, through the label, what counts as one step.
- **`src/main.js`** — `snapshotState()` / `applySnapshot()`, wired into `save()` behind a 350ms
  debounce, so every existing mutation path gets history for free without touching dozens of
  call sites. Undo/redo buttons in the top bar plus Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y. Selection
  survives a step when the ids still exist.
- **`index.html`, `css/app.css`** — the two buttons, grouped apart from the file actions, with
  a disabled style.

Two things are deliberately excluded from a snapshot:

- **Image data URLs.** A site photo is megabytes; 80 snapshots of it would be hundreds. An
  `imagePool` holds one copy of each distinct image and the snapshot stores its key. The pool
  is pruned to what the stack can still reach.
- **Camera readings** (`sitePhoto.camDist`, `scene.eye`). Where the camera is pointing is
  navigation, not an edit, and `applySnapshot()` carries the live values across untouched.

## Fixed along the way

`syncCameraStateToForm()` wrote `camDist` / `scene.eye` and called `save()` on *every*
OrbitControls `change` event. With damping enabled those keep firing while the camera eases, so
the app was writing to localStorage several times a second at rest. It only surfaced because
the undo stack started filling with camera drift ("Undo site photo" every ~3s on an idle page).
It now compares before writing and only saves when a value actually changed.

## Gotchas / pitfalls

- Boot writes state that is not a user edit (initial rebuild, the site-photo pan-basis
  conversion, the opening view preset). The stack is seeded in a `requestAnimationFrame` after
  boot, clearing any pending debounce first, or the app opens with a phantom undo step.
- Label granularity *is* the step granularity, because coalescing keys on the label. Section
  labels ("dimensions") merged two different fields edited within the window into one step;
  field labels ("roof pitch" vs "width") do not, while a slider drag still collapses to one.
- `applySnapshot()` must set `applyingHistory` before touching state, since `rebuild()` calls
  `save()`, which would otherwise record the undo as a new edit.
- History is in memory only. A reload starts a fresh stack — persisting 80 snapshots would
  reintroduce the localStorage quota problem the image pool exists to avoid.

## Verification

- `npm test` — 26/26 pass, including two new tests: the stack (no-op records ignored, redo tail
  dropped on a new edit, same-label coalescing, cap drops oldest not newest, snapshots are deep
  copies) and the labels.
- In the browser, driving the real controls: `roof pitch -> 5`, `width -> 29`, `roof colour`
  each produced their own labelled step; a sun-azimuth slider dragged through nine values
  produced exactly one ("sun az scene"); four undos walked back through all of them in order
  and ended with the Undo button disabled at the opening state. Ctrl+Z / Ctrl+Shift+Z drive the
  same path, and Ctrl+Z inside the model-name text field is left to the browser
  (`defaultPrevented: false`, app state unchanged).
- Idle page after boot: Undo and Redo both disabled and staying disabled, confirming the camera
  churn is gone.
