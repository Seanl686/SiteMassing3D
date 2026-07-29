# Four labelled lot-photo slots, so the user knows which shot goes where

## What changed

The Site Photo panel now opens with **The Four Lot Photos** — one card per
standard camera position, each stating where the photographer has to stand:

| # | Slot | preset |
|---|---|---|
| 1 | ¾ front-left | `hero-left` |
| 2 | ¾ front-right | `hero-right` |
| 3 | ¾ rear-left | `rear-left` |
| 4 | Straight on, eye level | `eye` |

- `src/siteviews.js` — `SITE_VIEW_SLOTS` (key, name, preset, `shoot` text),
  `slotByKey`, `findSlotView`, `sortSiteViews`, and a `slotKey` field on the view.
- `src/main.js` — `renderSlotList()`, `pickSlotPhoto()`, `loadSlotPhoto()`, plus
  `syncActiveSiteView()` / `withoutViewSync()`.
- `index.html` / `css/app.css` — the slot cards, and the existing free-form
  loader demoted under a **Free-form Photo** heading.
- `src/package.js` / `src/brief.js` — the index table gained a *Shot from*
  column, each per-pass brief gained a "Where the photograph was taken from"
  line (`passShoot`), and the README's four-photo table is now generated from
  `SITE_VIEW_SLOTS` rather than repeating the list by hand.

Tests 37–39. 40 pass.

## Why it mattered

Site views already stored a lot photo plus its camera, but nothing told the user
*which* photographs to take or which slot a given shot belonged in — a "+ Save
current" button assumes you already know the workflow. The four positions are
not decoration: a render can only be made from a position the lot was actually
photographed from, so the slot label and the camera preset behind it are the
same fact stated twice, once for the person with the camera and once for the
renderer.

Loading into a slot jumps the camera to that preset, which makes the pairing
physical rather than advisory — you cannot fill the ¾ rear-left slot and end up
with a front-left plate.

## Gotchas / pitfalls

- **Alignment has to stick to the slot.** Without `syncActiveSiteView()` you
  align a photo, cycle to the next, come back, and the work is gone. It runs
  from `save()` and from the OrbitControls change handler — orbiting *is* the
  alignment work, so the camera is captured even when nothing else changed.
- **That sync must be suspended in three places**, or a half-applied state gets
  written back over a good view: while applying a view (`applySiteViewById`),
  while loading a slot photo, and for the whole of a package export — the
  packager steps through every view, and each `rebuild()` inside it would
  otherwise stamp the current photo onto whichever view was active when the
  export began. `withoutViewSync` is promise-aware for that last case, same
  reason `withRestoredCamera` is.
- **Existing slots keep their framing on replace.** `loadSlotPhoto` re-applies
  the stored camera when the slot already has one and only falls back to the
  preset for a fresh slot — re-shooting a photo should not throw away an
  alignment that was already dialled in.
- **Order is canonical, not insertion.** `sortSiteViews` puts slots in shooting
  order and free-form views after, and it runs in `migrate()` too, so a reopened
  project numbers its package folders the same way. Fill slot 3 before slot 1 and
  `views/01-front-left/` is still first.
- **An unknown `slotKey` from disk is dropped**, not trusted — otherwise a
  hand-edited project could claim a slot that does not exist and the card would
  never show it as filled.
- All four slots are perspective presets. The orthographic elevations measure
  true but no photograph is orthographic, so they stay geometry reference and can
  never back a lot photo. Test 37 pins that.

## Verification

- `npm test` — 40/40 (3 new).
- Driven in Chrome through the real file-input path:
  - Four cards render with numbers, names and shooting notes; empty cards offer
    *Load photo*, filled ones *Replace photo* / *Show* / *Clear*, and the showing
    one reads *● Showing*.
  - Loading into slot 1 set the camera to `hero-left`; loading into slot 3 set it
    to `rear-left`.
  - Filled slot 3 **before** slot 1 — `siteViews` still came out
    `[hero-left, rear-left]` and the package wrote `views/01-front-left/` and
    `views/02-rear-left/`.
  - Set `panX` to 42 while slot 1 was showing, cycled away and back: 42 both in
    the stored view and in the live photo.
  - `01-INDEX.md` gained the *Shot from* column; the per-pass brief carried
    "Where the photograph was taken from: Stand off the front-LEFT corner…".
- Test slots and the alignment change were cleared afterwards, and the project's
  saved values (`scale 0.6`, `panX 10.9`, `panY 10.1`, `baselineY -2.5`,
  `camDist 73.3`) restored — the lot photo and site plan restored earlier in the
  session are untouched.
