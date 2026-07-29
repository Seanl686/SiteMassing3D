// Default home spec and shared constants. Units are FEET throughout the app;
// one three.js world unit == one foot.

import { readSiteViews, sortSiteViews } from './siteviews.js';
import { readHomePhotos } from './homephotos.js';

export const WALLS = ['front', 'back', 'left', 'right'];

export const WALL_LABEL = {
  front: 'Front (long wall)',
  back: 'Rear (long wall)',
  left: 'Left end (gable)',
  right: 'Right end (gable)',
};

let seq = 0;
export const nextId = (prefix) => `${prefix}${(++seq).toString(36)}${Date.now().toString(36).slice(-3)}`;

export const OPENING_PRESETS = {
  door:   { widthFt: 3.0,  heightFt: 6.67, sillFt: 0,   label: 'Entry door' },
  slider: { widthFt: 6.0,  heightFt: 6.67, sillFt: 0,   label: 'Sliding door' },
  window: { widthFt: 4.0,  heightFt: 3.5,  sillFt: 3.5, label: 'Window' },
};

export function defaultHome() {
  return {
    name: 'Untitled double-wide',
    // Placeholder dimensions — replace with the W' x L' line off the spec sheet.
    dimensions: {
      widthFt: 27,
      lengthFt: 56,
      wallHeightFt: 8,
      floorHeightFt: 2.5,
      roofPitch: 4,          // rise per 12 of run
      eaveOverhangFt: 1.0,   // horizontal overhang past the long walls
      rakeOverhangFt: 0.75,  // horizontal overhang past the gable ends
      roofStyle: 'gable',
      headAlign: false,        // park every opening head a fixed drop below the wall top
      windowHeadDropFt: 1.0,   // top of wall -> top of window
      doorHeadDropFt: 1.33,    // top of wall -> top of door (6'-8" head in an 8' wall)
      dormerCount: 0,         // 0 (none), 1 (single), 2 (double)
      dormerStyle: 'gable',   // 'gable', 'shed', 'hip'
      dormerWidthFt: 10.0,
      dormerHeightFt: 4.5,
      dormerFalseEave: true,
      dormerInnerFalseEave: true,  // nested inner return band (double-wide)
      dormerConnected: false,      // merge double dormers into one continuous cap
      dormerNested: false,         // dormer 2 sits inside dormer 1 (gable-in-gable)
      dormerNestOffsetFt: 0,       // inner gable X offset from the outer gable center
      dormerWindow: true,
      dormerDripEdge: true,        // horizontal drip edge / eave trim under dormer
      dormerContinuousWall: false, // continue wall siding straight up into dormer face
      dormerPositions: [],          // custom X offsets in ft; empty = auto-place
      dormerLinkSizes: false,       // true = every dormer shares the global size
      dormerSizes: [],              // per-dormer { widthFt, heightFt } overrides
      sidingTexture: 'horizontal_lap', // 'horizontal_lap', 'board_batten', 'cedar_shingle', 'smooth'
      dormerSidingTexture: 'horizontal_lap',
      gableSidingTexture: 'horizontal_lap',
      cornerTrim: true,
      cornerTrimWidthFt: 0.5,       // 6-inch vertical corner trim boards
    },
    colors: {
      siding: '#8d9299',
      belowDormerSiding: '#8d9299',
      dormerSiding: '#8d9299',
      gableSiding: '#8d9299',
      trim: '#f2f2f0',
      roof: '#3a3d42',
      skirting: '#e6e6e1',
      door: '#f2f2f0',
      glass: '#4d6070',
    },
    openings: [
      { id: nextId('d'), type: 'door',   wall: 'front', offsetFt: 14, widthFt: 3, heightFt: 6.67, sillFt: 0, label: 'Main entry' },
      { id: nextId('d'), type: 'door',   wall: 'back',  offsetFt: 38, widthFt: 3, heightFt: 6.67, sillFt: 0, label: 'Rear / utility door' },
      { id: nextId('w'), type: 'window', wall: 'front', offsetFt: 5,  widthFt: 4, heightFt: 3.5, sillFt: 3.5, label: 'Living room' },
      { id: nextId('w'), type: 'window', wall: 'front', offsetFt: 24, widthFt: 4, heightFt: 3.5, sillFt: 3.5, label: 'Kitchen' },
      { id: nextId('w'), type: 'window', wall: 'front', offsetFt: 44, widthFt: 4, heightFt: 3.5, sillFt: 3.5, label: 'Bedroom 2' },
      { id: nextId('w'), type: 'window', wall: 'left',  offsetFt: 9,  widthFt: 4, heightFt: 3.5, sillFt: 3.5, label: 'Primary bedroom' },
      { id: nextId('w'), type: 'window', wall: 'right', offsetFt: 9,  widthFt: 3, heightFt: 3.5, sillFt: 3.5, label: 'Bedroom 3' },
    ],
    plan: { src: null, widthFt: 56, offsetX: 0, offsetZ: 0, rotation: 0, opacity: 0.65, show: true },
    sitePhoto: { src: null, show: true, fitMode: 'camera', opacity: 0.85, scale: 1.0, panX: 0, panY: 0, rotation: 0, baselineY: 0, camDist: 60, posX: 0, posZ: 0, rotY: 0 },
    // The site plan / spec sheet that ships with the render package. `src` is
    // always a PNG — a PDF page is converted on load, because image models
    // ignore PDF attachments. `pdf` keeps the original for the human.
    sitePlan: { src: null, pdf: null, name: '', page: 1, pageCount: 0, width: 0, height: 0 },
    // Equirectangular 360 photo wrapped on a sphere centred on the site, so the
    // camera can orbit the home and stay inside the real surroundings. Supersedes
    // the flat site photo while it is showing.
    panorama: {
      src: null, show: true,
      yawDeg: 0,        // spin the lot around the home until north lines up
      tiltDeg: 0,       // level a hand-held shot
      radiusFt: 300,    // how far away the horizon reads
      heightFt: 5.5,    // tripod height the pano was shot at
      brightness: 1,
      opacity: 1,
    },
    // Photographs of the REAL home, keyed by the wall each one shows. These are
    // the authority on how the home looks; the plates are the authority on where
    // everything is. See homephotos.js.
    homePhotos: {},
    // Named lot-photo + camera set-ups. One lot photo renders one view, so a
    // site shot from four positions is four of these — see siteviews.js.
    siteViews: [],
    activeSiteViewId: null,
    // The handful of things the model cannot know because they are on the lot,
    // not in the spec. Everything else in the render brief is measured.
    brief: defaultBrief(),
  };
}

/** Free-text blanks the render brief needs from the person looking at the lot. */
export function defaultBrief() {
  return {
    nearCorner: '',   // blank = use the corner measured from the live camera
    pad: '',
    landmark: '',
    keep: '',
    heightRef: '',
    light: '',        // blank = derived from the sun / overcast controls
    notes: '',
  };
}

export function defaultScene() {
  return {
    sunAz: 135,
    sunEl: 42,
    flat: 0.6,        // 0 = hard directional sun, 1 = flat overcast
    focal: 35,        // mm, 35mm-equivalent
    eye: 5.5,         // eye height in ft for the "Eye level" preset
    bg: '#20242a',
    grid: true,
    shadow: true,
    steps: true,
    stepLanding: true,
    landingDepthFt: 3.5,
    stepRailings: 'both', // 'none', 'left', 'right', 'both'
    railMat: 'pressure_treated', // 'pressure_treated', 'white_trim', 'black_metal', 'matching_trim'
    balusterStyle: 'balusters', // 'balusters', 'horizontal_cables', 'open'
    wireframe: false,
    blockLandscape: false,
    labels: false,
    dims: false,
  };
}

export function defaultExport() {
  return { w: 2400, h: 1600, alpha: false, burn: true };
}

/** Dormer sizes live on a quarter-foot grid so the spinner steps land on whole
 *  feet; saves written before that grid existed get snapped on load. */
const quarterFt = (v) => Math.max(0.25, Math.round(v * 4) / 4);

/** Coerce the per-dormer size overrides into a clean array of partial specs.
 *  A null entry (or a missing field) means "inherit the global dormer size". */
function normalizeDormerSizes(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((s) => {
    if (!s || typeof s !== 'object') return null;
    const out = {};
    if (Number.isFinite(+s.widthFt) && +s.widthFt > 0) out.widthFt = quarterFt(+s.widthFt);
    if (Number.isFinite(+s.heightFt) && +s.heightFt > 0) out.heightFt = quarterFt(+s.heightFt);
    return Object.keys(out).length ? out : null;
  });
}

export function migrate(home) {
  const base = defaultHome();
  const dimensions = { ...base.dimensions, ...(home.dimensions || {}) };
  dimensions.dormerSizes = normalizeDormerSizes(dimensions.dormerSizes);
  dimensions.dormerPositions = Array.isArray(dimensions.dormerPositions)
    ? dimensions.dormerPositions.map((v) => +v).filter((v) => Number.isFinite(v))
    : [];
  // Sizes are independent unless a save explicitly asked for linked sizes.
  dimensions.dormerLinkSizes = dimensions.dormerLinkSizes === true;
  const colors = { ...base.colors, ...(home.colors || {}) };
  if (!home.colors?.belowDormerSiding) colors.belowDormerSiding = colors.siding;
  if (!home.colors?.dormerSiding) colors.dormerSiding = colors.siding;
  if (!home.colors?.gableSiding) colors.gableSiding = colors.siding;
  // Plate modes were renamed when the plate was locked to the camera:
  // 'contain' scaled off whichever axis bound first, which is what made the
  // photo drift against the model on a resize.
  const sitePhoto = { ...base.sitePhoto, ...(home.sitePhoto || {}) };
  if (sitePhoto.fitMode === 'contain') sitePhoto.fitMode = 'camera';
  if (sitePhoto.fitMode === '100% 100%') sitePhoto.fitMode = 'stretch';

  const out = {
    name: home.name || base.name,
    dimensions,
    colors,
    openings: (home.openings || []).map((o) => ({
      id: o.id || nextId('o'),
      type: o.type || 'window',
      wall: o.wall || 'front',
      offsetFt: +o.offsetFt || 0,
      widthFt: +o.widthFt || 3,
      heightFt: +o.heightFt || 3,
      sillFt: +o.sillFt || 0,
      label: o.label || '',
      headFree: !!o.headFree,   // opt this opening out of the global head alignment
      stepMat: o.stepMat,
      stepEgress: o.stepEgress,
      stepRailings: o.stepRailings,
      railMat: o.railMat,
      balusterStyle: o.balusterStyle,
    })),
    plan: { ...base.plan, ...(home.plan || {}) },
    sitePhoto,
    sitePlan: { ...base.sitePlan, ...(home.sitePlan || {}) },
    panorama: { ...base.panorama, ...(home.panorama || {}) },
    homePhotos: readHomePhotos(home.homePhotos),
    siteViews: sortSiteViews(readSiteViews(home.siteViews)),
    activeSiteViewId: home.activeSiteViewId || null,
    brief: { ...base.brief, ...(home.brief || {}) },
  };
  // A dangling active id would light up a row that is no longer there.
  if (!out.siteViews.some((v) => v.id === out.activeSiteViewId)) out.activeSiteViewId = null;
  return out;
}
