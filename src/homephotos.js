// Photographs of the real home, one per wall.
//
// These are a different class of asset from the lot photos, and confusing the
// two wrecks a render. A lot photo says where the home goes. A home photo says
// what the home LOOKS like — the actual siding profile and colour, the actual
// window proportions, the trim, the roof material as photographed on a real
// unit rather than described in words.
//
// The massing plates and the home photos are meant to be read together, not
// chosen between: the plate is the measured geometry and the markup underneath,
// the photograph is the finish laid over it. Where a photograph exists for a
// wall it is the authority on how that wall looks; where none does — and on a
// dealer lot that is usually the rear and one gable end — the plate plus the
// written specification is all there is, which is exactly why the plates carry
// every opening on all four walls.
//
// DOM-free so it can be unit-tested.

const KEYS = ['front', 'rear', 'left', 'right', 'hero'];

/**
 * `wall` ties a photo to the wall it shows, so the brief can say "the front wall
 * looks like THIS photograph" rather than leaving the model to guess which
 * image goes with which elevation. `plate` names the massing plate it pairs
 * with inside the render package.
 */
export const HOME_PHOTO_SLOTS = [
  {
    key: 'front',
    wall: 'front',
    name: 'Front elevation',
    plate: '31-front-elevation.png',
    shoot: 'The long wall with the main entry, photographed square on.',
  },
  {
    key: 'rear',
    wall: 'back',
    name: 'Rear elevation',
    plate: '32-rear-elevation.png',
    shoot: 'The opposite long wall. Rarely photographed on a dealer lot — if you have it, it is worth a lot.',
  },
  {
    key: 'left',
    wall: 'left',
    name: 'Left end (gable)',
    plate: '33-left-end-elevation.png',
    shoot: 'The short gable end, square on.',
  },
  {
    key: 'right',
    wall: 'right',
    name: 'Right end (gable)',
    plate: '34-right-end-elevation.png',
    shoot: 'The other short gable end, square on.',
  },
  {
    key: 'hero',
    wall: null,
    name: 'Three-quarter / catalogue shot',
    plate: '30-elevation-set.png',
    shoot: 'The angled marketing photo. Best single reference for overall character, colour and proportion.',
  },
];

export const homeSlotByKey = (key) => HOME_PHOTO_SLOTS.find((s) => s.key === key) || null;

/** Normalise the stored map, dropping anything that is not a known slot. */
export function readHomePhotos(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const key of KEYS) {
    const p = raw[key];
    if (p && typeof p === 'object' && typeof p.src === 'string' && p.src) {
      out[key] = { src: p.src, name: typeof p.name === 'string' ? p.name : '' };
    }
  }
  return out;
}

/** The slots that actually have a photograph, in canonical order. */
export const filledHomePhotos = (photos) =>
  HOME_PHOTO_SLOTS.filter((s) => photos?.[s.key]?.src);

/** Walls with no photograph — the ones the plates alone have to answer for. */
export const unphotographedWalls = (photos) =>
  HOME_PHOTO_SLOTS.filter((s) => s.wall && !photos?.[s.key]?.src).map((s) => s.wall);
