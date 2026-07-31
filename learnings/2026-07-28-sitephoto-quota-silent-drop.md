# Site photo silently dropped on localStorage quota overflow

## What changed

- `src/main.js` — new `downscaleImage(file, maxDim, quality)` re-encodes an uploaded image through an offscreen canvas to a capped-dimension JPEG before it ever reaches `state`. The `fileSitePhoto` upload handler now runs through it instead of a raw `FileReader.readAsDataURL`.
- `save()`'s quota-exceeded fallback (which drops `plan.src`/`sitePhoto.src` and retries) now `alert()`s once instead of failing silently.

## Why it mattered

`save()` stores the whole app state, images included, as a single `localStorage` JSON blob. A phone-camera photo can be 5-10MB once base64-encoded, which alone can exceed the origin's quota; `save()`'s catch block then persisted everything *except* the image and gave up quietly. The photo kept rendering fine for the rest of that session (it was still in memory) but vanished the next time the page loaded — read as "the site photo isn't loading," with no error anywhere pointing at storage.

## Gotchas / pitfalls

- Downscaling only helps for realistic single-photo uploads; it doesn't remove the underlying single-blob-quota design. If plan plate + site photo + everything else together still exceed quota, the same silent-drop fallback still triggers — now at least it alerts instead of failing invisibly.
- Multiple tabs of this app on `localhost` share one `localStorage` key with last-write-wins semantics — a stale/background tab's `save()` can clobber a fresher tab's photo. Observed this while testing (an old leftover tab overwrote a freshly-saved photo); not fixed here, just noted since it can look identical to the quota bug.

## Verification

Reproduced live via `window.__app` / a dispatched `fileSitePhoto` change event with a synthetic 4000x3000 PNG: before the fix, a large-enough source landed as `sitePhoto.src: null` in the persisted copy after `save()`; after the fix the same upload persists as a ~16KB JPEG and reads back correctly on repeated checks. `npm test` — 20/20 pass.
