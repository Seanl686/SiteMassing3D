# Saved site views, and a 360 panorama wrapped on the site

## What changed

Two answers to the same constraint — *one lot photo renders one view* — shipped
together.

**Saved site views** (`src/siteviews.js`). A named bundle of the lot photo, its
alignment, and the camera framed onto it. Stored on `home.siteViews` with
`home.activeSiteViewId`. UI lives at the bottom of the Site Photo panel: a row
per view with thumbnail, editable name, overwrite-from-current and delete;
`‹ Prev` / `Next ›`; a badge with prev/next in the 3D view bar; and `[` / `]`
keys (suppressed while a field has focus — they are printable characters).

**360 panorama** (`Stage.setPanorama`, `home.panorama`, the new `360` panel). An
equirectangular photo on an inverted sphere **centred on the site**, with yaw,
tilt, horizon radius, shot height, brightness and opacity.

**Render package** (`src/package.js`) now emits one folder per saved site view —
`views/NN-name/{lot-photo, hero, hero-cutout, BRIEF.md}` — with the shared
geometry plates and the site plan at the root, referenced as `../../…`, plus a
root `01-INDEX.md` instead of a single `01-BRIEF.md`. `buildBrief` gained
`passName` and `site.backdrop`.

Tests 33–36 cover capture/cycle/apply, name uniqueness, the project round trip,
and the two brief variants. 37 pass.

## Why it mattered

The previous entry established that a four-view contact sheet is not four
renders. That left the real workflow — several lot photos, several passes —
entirely manual: re-upload the photo, re-pan it, re-set the ground baseline,
re-orbit the camera, export, repeat. Site views make that set-up a stored,
cyclable thing and let one export produce every pass.

The panorama attacks the constraint itself. One 360 from the middle of the pad
means every camera angle is already a valid render position, and the hero plate
comes out with the real lot behind the home at the correct perspective — the job
handed to the image model changes from "composite two plates" to "photographise
this scene", which is a much smaller ask and drifts far less.

## Gotchas / pitfalls

- **The panorama is geometry, not `scene.background`.** A background sits at
  infinity and never moves against the model, so the home slides across it as the
  camera orbits. A sphere of a stated radius centred on the site is what makes
  orbiting read as walking around the lot. This is the whole reason for the
  approach; do not "simplify" it to a background texture.
- **`geometry.scale(-1, 1, 1)`, not `side: BackSide` alone.** BackSide renders
  the interior but shows the photo mirrored. Verified with a synthetic pano
  labelled N/E/S/W — the letters read correctly, and a 90° camera rotation steps
  through four distinct quadrant colours.
- **Applying a site view must go through `rebuild()`.** The home group's
  position, heading and ground baseline all come off `sitePhoto`, so a plate
  rendered without a rebuild is framed on the *previous* view's lot. And the
  camera must be restored **after** the rebuild: `rebuild()` re-applies
  `sitePhoto.camDist` to the perspective camera and would otherwise pull the
  restored framing off the photo it was aligned to.
- **One panorama, one file.** It covers every pass, so it is added once at the
  root and each per-view brief points at `../../10-lot-panorama.jpg`. Emitting it
  per folder duplicated ~1.5 MB per view.
- **`captureSiteView` stores only `PHOTO_KEYS`.** Whitelisting rather than
  spreading `sitePhoto` keeps transient junk out of saved projects.
- **View names become package folder names**, so `uniqueViewName` de-duplicates
  case-insensitively while keeping the casing the user typed.
- Every saved view carries its own lot photo, so they are pooled out of undo
  snapshots and dropped from the localStorage lean-save fallback, exactly like
  the live site photo, the plan plate and the site plan. The panorama too — it is
  capped at 4096 px on the long edge, not the flat photo's 1600, because 1600
  stretched across a full 360 reads as mush.
- Cutout (alpha) exports hide the panorama; a cutout is the model alone. The
  panorama also supersedes the flat plate in both the live view and
  `renderToCanvas` — they are two answers to the same question and would paint
  over each other.
- `siteviews.js` mints its own ids instead of importing `nextId` from
  `defaults.js`: `defaults.js` already imports `readSiteViews`, and a two-way
  import is a cycle waiting to bite whoever moves a call to module scope.

## Verification

- `npm test` — 37/37 (4 new).
- Driven in Chrome against `python3 -m http.server 5173`:
  - Panorama wrap: a synthetic 2048×1024 equirect with N/E/S/W quadrant bands;
    rotating the camera 90° four times sampled four distinct colours, text
    unmirrored, sky up. Yaw 90° changed the sampled colour red → green; tilt,
    radius, shot height and show/hide all reached the mesh.
  - Site views: two views saved with different photos, pans and cameras; `[`/`]`
    and the buttons restored each set-up exactly (`panX`, `scale`, `rotY`,
    camera), badge and active-row highlight tracked. A `]` dispatched into a text
    field correctly did nothing.
  - Package, flat photos: 19 entries, `views/01-…` and `views/02-…` each with
    their own lot photo and hero plate, per-pass framing measured separately
    (6–97% vs 9–78% of frame width), camera and site photo restored afterwards.
  - Package, panorama: one shared `10-lot-panorama.jpg` listed first in every
    per-view brief, `backdrop: 'panorama'` on both passes, README and contact
    sheet role text switching wording with the backdrop.
- **Note:** this testing overwrote the browser's autosaved working state (the
  live localStorage project). The synthetic photo, panorama, site views and the
  mismatched site plan were stripped afterwards, but the lot photo and site plan
  that were loaded there beforehand have to be re-loaded from disk. Test against
  a saved project JSON in future rather than whatever the browser last held.
