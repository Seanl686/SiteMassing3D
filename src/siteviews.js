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

/**
 * The four standard lot photographs, and the camera position each one has to be
 * shot from. A render can only be made from a position the lot was photographed
 * at, so these are not arbitrary labels: the preset named here is the framing
 * the plate is rendered at, and `shoot` is where the person with the camera has
 * to stand for the two to agree.
 *
 * All four are perspective presets. The orthographic elevations measure true but
 * no photograph is orthographic, so they are geometry reference only and never
 * a slot.
 */
export const SITE_VIEW_SLOTS = [
  {
    key: 'hero-left',
    name: '¾ front-left',
    preset: 'hero-left',
    shoot: 'Stand off the front-LEFT corner of the pad. The long front wall runs away from you; the left gable end faces you.',
  },
  {
    key: 'hero-right',
    name: '¾ front-right',
    preset: 'hero-right',
    shoot: 'Mirror image: off the front-RIGHT corner. Front wall receding the other way, right gable end facing you.',
  },
  {
    key: 'rear-left',
    name: '¾ rear-left',
    preset: 'rear-left',
    shoot: 'Behind the pad, off the rear-left corner. This is the side no dealer photo ever covers.',
  },
  {
    key: 'eye',
    name: 'Straight on, eye level',
    preset: 'eye',
    shoot: 'Square to the long side of the pad, camera at eye height, roughly 1.5× the home length back.',
  },
];

export const slotByKey = (key) => SITE_VIEW_SLOTS.find((s) => s.key === key) || null;

/** The saved view filling a given slot, if the user has loaded a photo for it. */
export const findSlotView = (views, key) =>
  (Array.isArray(views) ? views : []).find((v) => v && v.slotKey === key) || null;

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
export function captureSiteView({ name, sitePhoto, camera, viewLabel, id, slotKey, savedAt } = {}) {
  return {
    id: id || nextId(),
    name: (name || '').trim() || 'Untitled view',
    photo: pickPhoto(sitePhoto),
    camera: camera || null,
    viewLabel: viewLabel || null,
    // Which of the four standard lot photographs this is, if any. Free-form
    // views saved with "+ Save current" have none.
    slotKey: slotKey || null,
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
    slotKey: slotByKey(raw.slotKey) ? raw.slotKey : null,
    savedAt: raw.savedAt || null,
  };
}

export const readSiteViews = (raw) =>
  (Array.isArray(raw) ? raw : []).map(readSiteView).filter(Boolean);

/**
 * Slot views in the canonical shooting order, then free-form ones in the order
 * they were saved. Cycling and the package's folder numbering both read this
 * order, so a slot filled last should still sit where its label says it does.
 */
export function sortSiteViews(views) {
  const rank = (v) => {
    const at = SITE_VIEW_SLOTS.findIndex((s) => s.key === v.slotKey);
    return at < 0 ? SITE_VIEW_SLOTS.length : at;
  };
  return (Array.isArray(views) ? views : [])
    .map((v, i) => [v, i])
    .sort((a, b) => (rank(a[0]) - rank(b[0])) || (a[1] - b[1]))
    .map(([v]) => v);
}

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
