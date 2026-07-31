# Group selection and bulk editing for openings

## What changed

- `src/main.js` — selection is now a set (`selectedIds`) plus an anchor (`selectedId`, the last unit
  clicked). `select(id, mode)` takes `'replace'` (plain click), `'toggle'` (Ctrl/Cmd-click in the
  viewport, or the new row checkbox), or `'anchor'` (focusing a field inside a row, which re-anchors
  without collapsing a group the row already belongs to). Added `groupAction()` for align heads /
  sills / offsets / centers, even spacing, match width / height, duplicate all, delete all. Drag and
  resize now record a start state per selected unit and apply the same `(du, dv)` travel to all of
  them. `Ctrl/Cmd+A` selects every opening; `Del` removes the whole selection.
- `src/ui.js` — new group-edit card at the top of the sidebar when 2+ units are selected: absolute
  value fields (blank + `mixed` placeholder when the units disagree), ± shift buttons for offset and
  sill, wall / type / free-head controls, the align-distribute action grid, and the stair & railing
  selects when the set contains a door or slider. Every row gained an include-in-group checkbox.
  Per-item editing is untouched — the single-select card still appears when exactly one is selected.
- `src/gizmo.js` — outlines are now per-wall sub-groups, so a multi-selection spanning several walls
  draws correctly: the anchor keeps the blue outline plus drag handles, the rest get a dimmer amber
  outline with no handles.
- `css/app.css`, `index.html` — group-card styling, `.opening.ingroup` highlight, cache-buster bumped
  to `?v=3`, sidebar hint documenting the group workflow.

## Why it mattered

Every opening control was per-item only, so retyping six windows or lining up a wall of sills meant
editing each unit by hand. The anchor concept keeps per-item precision while making align/match
predictable — the operations always measure against the unit you clicked last.

## Gotchas / pitfalls

- **Head alignment silently wins over group sill edits.** With `dimensions.headAlign` on,
  `applyHeadAlign()` recomputes every non-`headFree` sill (and every door height) on each rebuild, so
  "Align sills" or a sill shift looks like a no-op. Tick **Free head** on the group card first. This
  cost real debugging time — the group code was fine.
- **CSS is cache-busted by query string** (`css/app.css?v=N`). New rules do not appear until the
  number is bumped; the browser will happily serve the old sheet and the layout silently falls back
  to flex-wrap defaults.
- Toggling a row checkbox calls `refreshList()`, which rebuilds the list DOM — a stale `NodeList`
  from before the click points at detached nodes. Re-query between clicks (matters for scripted
  tests, not for users).
- `parallel` sets: `selectedIds` must always contain `selectedId`. Deleting the anchor promotes the
  first remaining member rather than clearing the whole selection.
- Distribution is done per wall — offsets only mean the same thing within one wall's frame.

## Verification

- `npm test` — 23/23 pass (no regressions; group logic lives in DOM-coupled `main.js` and is not
  covered by the node test suite).
- Browser smoke test against `python3 -m http.server 5173`: checkbox and Ctrl+A selection, group
  width set (3 units -> 5 ft), offset shift +1, align sills, even spacing (front wall gaps equalised),
  match height, duplicate all (7 -> 9 openings, copies selected), delete all (9 -> 7), Clear. Anchor
  gizmo plus amber ghost outlines confirmed on-screen. No console errors.
