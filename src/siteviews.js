// Saved site views: a lot photo, its alignment, and the camera framed onto it.
//
// One lot photo renders one view — the render matches the position the photo was
// shot from, and nothing else. A site with four photographs is therefore four
// separate set-ups, and before this they had to be rebuilt by hand every time:
// re-upload the photo, re-pan it, re-align the ground baseline, re-orbit the
// camera. A site view is that whole set-up under a name, so cycling between
// them is one click and the package can render every one of them in a pass.
//
// DOM-free and three.js-free: the camera arrives as the opaque blob
// Stage.cameraState() produces, and goes back the same way.

// Ids are minted here rather than imported from defaults.js: defaults.js reads
// site views back in migrate(), and a two-way import between them is a cycle
// waiting to bite the next person who moves a call to module scope.
let seq = 0;
const nextId = () => `sv${(++seq).toString(36)}${Date.now().toString(36).slice(-4)}`;

/** The site-photo fields a view owns. Anything else on sitePhoto is transient. */
export const PHOTO_KEYS = [
  'src', 'show', 'fitMode', 'opacity', 'scale', 'panX', 'panY', 'panBasis',
  'rotation', 'baselineY', 'camDist', 'posX', 'posZ', 'rotY',
];

function pickPhoto(sitePhoto) {
  const out = {};
  for (const k of PHOTO_KEYS) if (sitePhoto?.[k] !== undefined) out[k] = sitePhoto[k];
  return out;
}

/**
 * Freeze the live set-up into a saved view. `camera` is Stage.cameraState();
 * `viewLabel` is the preset name shown in the UI, carried so a restored view
 * captions its plate the way it was captioned when saved.
 */
export function captureSiteView({ name, sitePhoto, camera, viewLabel, id, savedAt } = {}) {
  return {
    id: id || nextId(),
    name: (name || '').trim() || 'Untitled view',
    photo: pickPhoto(sitePhoto),
    camera: camera || null,
    viewLabel: viewLabel || null,
    savedAt: savedAt || null,
  };
}

/** Normalise anything read off disk into a usable view, or null if it is junk. */
export function readSiteView(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    id: raw.id || nextId(),
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : 'Untitled view',
    photo: pickPhoto(raw.photo || {}),
    camera: raw.camera && typeof raw.camera === 'object' ? raw.camera : null,
    viewLabel: raw.viewLabel || null,
    savedAt: raw.savedAt || null,
  };
}

export const readSiteViews = (raw) =>
  (Array.isArray(raw) ? raw : []).map(readSiteView).filter(Boolean);

/** Index of `id` in `views`, or -1. */
export const indexOfView = (views, id) =>
  (Array.isArray(views) ? views : []).findIndex((v) => v && v.id === id);

/**
 * The view `step` places away from `id`, wrapping. Returns null when there is
 * nothing to cycle. Cycling from an unsaved state starts at the first view
 * going forward and the last going back, so both buttons do something useful.
 */
export function cycleSiteView(views, id, step) {
  const list = Array.isArray(views) ? views : [];
  if (!list.length) return null;
  const at = indexOfView(list, id);
  if (at < 0) return step >= 0 ? list[0] : list[list.length - 1];
  const n = list.length;
  return list[(((at + step) % n) + n) % n];
}

/** A saved view's fields merged onto the live sitePhoto, ready to assign. */
export function applySiteView(view, sitePhoto) {
  return { ...(sitePhoto || {}), ...pickPhoto(view?.photo || {}) };
}

/**
 * Give a view a name unique within the list — two "Front of pad" rows are
 * indistinguishable in the package, where the name becomes a folder.
 */
export function uniqueViewName(views, name, ignoreId) {
  const taken = new Set(
    (Array.isArray(views) ? views : [])
      .filter((v) => v && v.id !== ignoreId)
      .map((v) => v.name.toLowerCase()),
  );
  const base = (name || '').trim() || 'Untitled view';
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; n < 999; n++) {
    const candidate = `${base} ${n}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `${base} ${Date.now()}`;
}

/** Default name for the next capture: the preset the camera is on. */
export const suggestViewName = (views, viewLabel) =>
  uniqueViewName(views, viewLabel ? `${viewLabel} setup` : `Site view ${(views?.length || 0) + 1}`);
