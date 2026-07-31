// One registry of every image the project holds, and where each one came from.
//
// The panels were built one at a time and each ended up owning its own upload
// in isolation: the site plan lived in the package panel, the tracing plate in
// the plan panel, the lot photos in the photo panel, the photos of the real home
// in theirs. Nothing knew about anything else, so the same PDF page got loaded
// twice, a home photo could sit unused two panels away from the colour fields it
// answers, and the package checkboxes cheerfully offered to include assets that
// were not there.
//
// This module is the shared answer to "what has been loaded". Every panel reads
// it, so loading a photo in one place shows up everywhere it is relevant.
//
// DOM-free so it can be unit-tested.

import { HOME_PHOTO_SLOTS } from './homephotos.js';
import { SITE_VIEW_SLOTS, slotByKey } from './siteviews.js';

/**
 * Each kind names the panel that owns the upload, so any list of assets can
 * offer to jump to the control that loaded it. `finish` marks the kinds worth
 * sampling exterior colours off — a photograph of the real home is the
 * authority on finish; a floor plan is line art and tells you nothing.
 */
export const ASSET_KINDS = {
  homePhoto: {
    label: 'Photo of the real home',
    panel: 'panel_homephotos',
    panelName: 'Photos Of The Real Home',
    code: 'HOM',
    finish: true,
  },
  lotPhoto: {
    label: 'Lot photo',
    panel: 'panel_photo',
    panelName: 'Site Photo & Camera Framing',
    code: 'PHT',
    finish: true,
  },
  sitePlan: {
    label: 'Site plan / spec sheet',
    panel: 'panel_package',
    panelName: 'AI Render Package',
    code: 'PKG',
    finish: false,
  },
  planPlate: {
    label: 'Floor plan tracing plate',
    panel: 'panel_plan',
    panelName: 'Floor Plan Tracing Plate',
    code: 'PLN',
    finish: false,
  },
  panorama: {
    label: '360 panorama',
    panel: 'panel_pano',
    panelName: 'Panorama Site Wrap',
    code: '360',
    finish: true,
  },
};

const kindMeta = (kind) => ASSET_KINDS[kind] || { label: kind, panel: null, panelName: '', code: '???', finish: false };

function asset(kind, key, { label, detail, src, name }) {
  const meta = kindMeta(kind);
  return {
    id: `${kind}:${key}`,
    kind,
    key,
    label,
    detail: detail || '',
    src,
    name: name || '',
    panel: meta.panel,
    panelName: meta.panelName,
    code: meta.code,
    kindLabel: meta.label,
    canSampleFinish: meta.finish,
  };
}

/** Photos of the real home, in the order the slots are defined. */
export function homePhotoAssets(home) {
  const photos = home?.homePhotos || {};
  return HOME_PHOTO_SLOTS
    .filter((slot) => photos[slot.key]?.src)
    .map((slot) => asset('homePhoto', slot.key, {
      label: slot.name,
      detail: slot.wall ? `Pairs with the ${slot.wall} wall · ${slot.plate}` : `Pairs with ${slot.plate}`,
      src: photos[slot.key].src,
      name: photos[slot.key].name,
    }));
}

/**
 * Lot photographs, taken off the saved site views — the view is where a lot
 * photo actually lives, because the photo is meaningless without the alignment
 * and camera saved beside it.
 */
export function lotPhotoAssets(home) {
  const views = Array.isArray(home?.siteViews) ? home.siteViews : [];
  return views
    .filter((v) => v?.photo?.src)
    .map((v) => {
      const slot = slotByKey(v.slotKey);
      return asset('lotPhoto', v.id, {
        label: slot ? slot.name : v.name,
        detail: slot ? 'One of the four standard lot positions' : 'Free-form saved site view',
        src: v.photo.src,
        name: v.name,
      });
    });
}

/** Every image the project holds, grouped by nothing — order is panel order. */
export function collectAssets(home) {
  const out = [...homePhotoAssets(home), ...lotPhotoAssets(home)];

  const plan = home?.sitePlan || {};
  if (plan.src) {
    const pages = plan.pageCount > 1 ? ` · page ${plan.page} of ${plan.pageCount}` : '';
    out.push(asset('sitePlan', 'page', {
      label: plan.name || 'Site plan page',
      detail: `${plan.width}×${plan.height} px PNG${pages}${plan.pdf ? ' · original PDF kept' : ''}`,
      src: plan.src,
      name: plan.name,
    }));
  }

  const plate = home?.plan || {};
  if (plate.src) {
    out.push(asset('planPlate', 'plate', {
      label: 'Floor plan tracing plate',
      detail: `${plate.widthFt} ft wide on the ground${plate.show ? '' : ' · hidden'}`,
      src: plate.src,
      name: '',
    }));
  }

  const pano = home?.panorama || {};
  if (pano.src) {
    out.push(asset('panorama', 'pano', {
      label: '360 panorama',
      detail: pano.width ? `${pano.width}×${pano.height} equirectangular` : 'equirectangular',
      src: pano.src,
      name: pano.name,
    }));
  }

  return out;
}

/**
 * Remove one loaded image from the project by its registry id.
 *
 * The mutation lives here rather than in the panel that uploaded the file, so
 * every route to a delete — the asset rail, a panel button — takes exactly the
 * same one, and so it can be tested without a DOM. The caller owns the visible
 * consequences (redraw the scene, re-render the lists); this owns the state.
 *
 * Returns what happened: `{ removed, kind, label, alsoPlate }`. `alsoPlate` says
 * the floor plan tracing plate went with the site plan because it was the same
 * drawing — a plate whose source page is gone cannot be re-rendered, and leaving
 * it behind means the package ships a page nothing in the app can account for.
 */
export function removeAsset(home, id) {
  const target = collectAssets(home).find((a) => a.id === id);
  const miss = { removed: false, kind: null, label: '', alsoPlate: false };
  if (!home || !target) return miss;
  const { kind, key, label } = target;
  const done = (alsoPlate = false) => ({ removed: true, kind, label, alsoPlate });

  switch (kind) {
    case 'homePhoto': {
      const photos = { ...(home.homePhotos || {}) };
      delete photos[key];
      home.homePhotos = photos;
      return done();
    }
    case 'lotPhoto': {
      // The photo lives inside its saved view, together with the alignment and
      // the camera that make it usable, so the view is the unit that goes.
      const views = Array.isArray(home.siteViews) ? home.siteViews : [];
      const at = views.findIndex((v) => v.id === key);
      if (at < 0) return miss;
      views.splice(at, 1);
      if (home.activeSiteViewId === key) home.activeSiteViewId = null;
      return done();
    }
    case 'sitePlan': {
      const alsoPlate = planPlateLinked(home);
      home.sitePlan = {
        ...home.sitePlan,
        src: null, pdf: null, name: '', page: 1, pageCount: 1, width: 0, height: 0,
      };
      if (alsoPlate) home.plan = { ...home.plan, src: null };
      return done(alsoPlate);
    }
    case 'planPlate': {
      home.plan = { ...home.plan, src: null };
      return done();
    }
    case 'panorama': {
      home.panorama = {
        ...home.panorama,
        src: null, srcKey: null, name: '', width: 0, height: 0, show: false,
      };
      return done();
    }
    default:
      return miss;
  }
}

/** Counts the package panel quotes so a checkbox can say what it will include. */
export function assetInventory(home) {
  const homePhotos = homePhotoAssets(home);
  const lotPhotos = lotPhotoAssets(home);
  const slotted = lotPhotos.filter((a) => {
    const v = (home?.siteViews || []).find((x) => x.id === a.key);
    return !!slotByKey(v?.slotKey);
  }).length;
  return {
    homePhotos: homePhotos.length,
    homePhotoSlots: HOME_PHOTO_SLOTS.length,
    lotPhotos: lotPhotos.length,
    lotPhotoSlots: SITE_VIEW_SLOTS.length,
    slottedLotPhotos: slotted,
    sitePlan: !!home?.sitePlan?.src,
    sitePlanPdf: !!home?.sitePlan?.pdf,
    planPlate: !!home?.plan?.src,
    panorama: !!home?.panorama?.src,
    total: collectAssets(home).length,
  };
}

/**
 * The assets worth eyedropping exterior colours from, best first.
 *
 * The three-quarter catalogue shot leads because it shows siding, trim and roof
 * in one frame under one light; the square-on elevations come next; the lot
 * photo is last among the photographs because the home in it is usually the one
 * being replaced. Line art is excluded outright — sampling a floor plan gives
 * you the colour of paper.
 */
export function finishSampleAssets(home) {
  const home3q = [];
  const homeRest = [];
  for (const a of homePhotoAssets(home)) {
    (a.key === 'hero' ? home3q : homeRest).push(a);
  }
  return [...home3q, ...homeRest, ...lotPhotoAssets(home), ...(home?.panorama?.src ? collectAssets(home).filter((a) => a.kind === 'panorama') : [])];
}

/**
 * Whether the floor plan tracing plate is currently the same image as the site
 * plan page. Both panels show this, so neither can quietly disagree with the
 * other about which drawing is on the ground.
 */
export const planPlateLinked = (home) =>
  !!home?.plan?.src && !!home?.sitePlan?.src && home.plan.src === home.sitePlan.src;

/** Which walls have no photograph, phrased for a status line. */
export function missingHomePhotoNames(home) {
  const photos = home?.homePhotos || {};
  return HOME_PHOTO_SLOTS.filter((s) => !photos[s.key]?.src).map((s) => s.name);
}
