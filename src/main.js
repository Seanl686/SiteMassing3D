// App wiring: state -> geometry -> viewport, plus all the panel controls.

import * as THREE from 'three';
import { Stage } from './scene.js';
import { buildHome, disposeTree, wallFrames, clampOpening, fmtFt, derived, dormerSize } from './build.js';
import { renderOpeningList, syncOpeningValues, initAccordions } from './ui.js';
import { updatePlanPlate, nearestWallHit } from './plan.js';
import { Gizmo, wallPlaneHit, applyDrag } from './gizmo.js';
import { shoot, contactSheet, renderToCanvas, saveWithPicker } from './capture.js';
import { defaultHome, defaultScene, defaultExport, nextId, OPENING_PRESETS, migrate } from './defaults.js';
import { History, describeChange } from './history.js';
import { buildProject, readProject } from './project.js';
import { exportRenderPackage, buildRenderPackage } from './package.js';
import { buildBrief } from './brief.js';
import { measureFraming } from './framing.js';
import { loadSitePlan, isPdf } from './siteplan.js';
import { HOME_PHOTO_SLOTS, homeSlotByKey } from './homephotos.js';
import {
  HOME_SPEC_SCHEMA, buildSpecPrompt, validateHomeSpec, extractJson, applySpecToHome,
} from './homespec.js';
import { readPlanWithAI, readPlanWithAutoCycle, readPlanWithClaude, loadApiKey, saveApiKey, loadApiKeys, saveApiKeys, isPersisted } from './readplan.js';
import {
  captureSiteView, applySiteView, cycleSiteView, indexOfView, uniqueViewName, suggestViewName,
  SITE_VIEW_SLOTS, findSlotView, slotByKey, sortSiteViews,
} from './siteviews.js';

const STORE_KEY = 'sitemassing3d.v1';

const state = load() || {
  home: defaultHome(),
  scene: defaultScene(),
  export: defaultExport(),
};
// `selectedId` is the anchor (last clicked) — alignment and match operations
// measure against it. `selectedIds` is the full multi-selection and always
// contains the anchor.
let selectedId = null;
let selectedIds = new Set();
let pendingAdd = null;

const canvas = document.getElementById('view');
const stage = new Stage(canvas);
const gizmo = new Gizmo(stage.homeGroup);
stage.overlay = gizmo.group; // hidden during export — it is UI, not part of the render
const $ = (id) => document.getElementById(id);

/**
 * Re-encode an uploaded image as a downscaled JPEG data URL. A phone photo
 * straight off a camera can be 5-10MB base64-encoded, which alone blows the
 * localStorage quota and gets silently stripped on the next save() — this
 * keeps uploads well under that ceiling.
 */
function downscaleImage(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let w = img.naturalWidth, h = img.naturalHeight;
      if (Math.max(w, h) > maxDim) {
        const s = maxDim / Math.max(w, h);
        w = Math.round(w * s); h = Math.round(h * s);
      }
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image decode failed')); };
    img.src = url;
  });
}

// ---------------------------------------------------------------------------
// Build / refresh
// ---------------------------------------------------------------------------

function rebuild() {
  for (const o of state.home.openings) clampOpening(o, state.home.dimensions);

  while (stage.homeGroup.children.length) {
    const c = stage.homeGroup.children.pop();
    disposeTree(c);
  }
  stage.homeGroup.add(buildHome(state.home, state.scene));
  stage.homeGroup.add(gizmo.group);

  const sp = state.home.sitePhoto || {};
  const baseY = sp.baselineY || 0;
  stage.setGroundBaseline(baseY);
  stage.homeGroup.position.set(sp.posX || 0, baseY, sp.posZ || 0);
  stage.homeGroup.rotation.y = THREE.MathUtils.degToRad(sp.rotY || 0);

  if (stage.camera === stage.persp && sp.camDist && isFinite(sp.camDist) && sp.camDist > 0) {
    stage.setCameraDistance(sp.camDist);
  }

  // The panorama is geometry centred on the site, so it has to follow the same
  // ground baseline the home does. "Block landscape" takes it off with the rest.
  panoShowing = stage.setPanorama(
    state.scene.blockLandscape ? null : state.home.panorama,
    baseY,
    () => { updatePanoStatus(); },
  );

  stage.applySceneOpts(state.scene, state.home.dimensions);
  showGizmo();
  updateHud();
  updateFramingReadout();
  updateSitePhotoPlate();
  save();
}

/**
 * Natural aspect of the plate image, cached by data URL. Sizing the plate in
 * pixels needs the image's own proportions, which are only known once it has
 * decoded — the first call returns null and re-runs the plate update on load.
 */
const plateAspects = new Map();
function plateAspect(src, onReady) {
  if (plateAspects.has(src)) return plateAspects.get(src);
  const img = new Image();
  img.onload = () => {
    plateAspects.set(src, (img.naturalWidth || 1) / (img.naturalHeight || 1));
    onReady();
  };
  img.onerror = () => plateAspects.set(src, null);
  img.src = src;
  return null;
}

/**
 * Plate size in CSS pixels for a stage of w x h.
 *
 * 'camera' is height-locked: the photo is exactly `scale` times the stage
 * height, which is the rule both cameras follow, so the plate and the model
 * stay registered through any resize. Scale is applied HERE, to the image, not
 * to the plate element — scaling the element shrank the window you look through
 * instead of revealing the parts of the photo cropped at the stage edges.
 */
function plateSize(mode, w, h, aspect, scale) {
  if (!aspect) return null;
  if (mode === 'stretch' || mode === '100% 100%') return [w * scale, h * scale];
  if (mode === 'cover') {
    const coverH = Math.max(h, w / aspect);
    return [coverH * aspect * scale, coverH * scale];
  }
  return [h * aspect * scale, h * scale];
}

/**
 * Paint the stage behind the plate with the scene's own background colour.
 * The WebGL canvas is cleared to transparent whenever the photo is showing, so
 * without this the letterboxed bands fall through to the page colour while the
 * export fills them with scene.bg — the same frame, two different backdrops.
 */
function syncStageBackdrop() {
  const stageEl = canvas.parentElement;
  if (!stageEl) return;
  stageEl.style.background = state.scene.bgVisible === false ? '' : state.scene.bg;
}

/** True while the 360 wrap is up; the flat plate stands down for it. */
let panoShowing = false;

function updateSitePhotoPlate() {
  syncStageBackdrop();
  const bg = $('sitePhotoBg');
  if (!bg) return;
  const sp = state.home.sitePhoto;
  if (!sp || !sp.src || !sp.show || panoShowing || state.scene.blockLandscape) {
    bg.style.display = 'none';
    if (state.scene) stage.scene.background = state.scene.bgVisible === false ? null : new THREE.Color(state.scene.bg);
    return;
  }
  bg.style.display = 'block';
  bg.style.backgroundImage = `url("${sp.src}")`;
  bg.style.opacity = sp.opacity ?? 0.85;

  const scale = sp.scale ?? 1.0;
  const rot = sp.rotation ?? 0;
  const w = canvas.clientWidth || 1;
  const h = canvas.clientHeight || 1;
  // Pan is a fraction of HEIGHT on both axes, matching the cameras, which hold a
  // fixed vertical extent and only reveal more scene sideways as the stage widens.
  const tx = ((sp.panX ?? 0) / 100) * h;
  const ty = ((sp.panY ?? 0) / 100) * h;

  const aspect = plateAspect(sp.src, updateSitePhotoPlate);
  const size = plateSize(sp.fitMode, w, h, aspect, scale);
  // Until the image reports its proportions, fall back to the height lock —
  // 50% of the double-height plate box is one stage height.
  bg.style.backgroundSize = size ? `${size[0]}px ${size[1]}px` : 'auto 50%';
  bg.style.backgroundPosition = `calc(50% + ${tx}px) calc(50% + ${ty}px)`;
  // The element only rotates. It is deliberately larger than the stage (see the
  // stylesheet) so a rotated or zoomed-out photo has paint beyond the edges
  // instead of blank corners.
  bg.style.transform = `rotate(${rot}deg)`;
  stage.scene.background = null;
}

/** Openings in the multi-selection, in list order. */
function selectedOpenings() {
  return state.home.openings.filter((o) => selectedIds.has(o.id));
}

function showGizmo() {
  const anchor = state.home.openings.find((o) => o.id === selectedId);
  gizmo.show(anchor, state.home.dimensions, selectedIds.size > 1 ? selectedOpenings() : []);
}

function clearSelection() {
  selectedId = null;
  selectedIds.clear();
  gizmo.clear();
  refreshList();
}

/**
 * `mode` is 'replace' (plain click), 'toggle' (ctrl/cmd/shift click, or the row
 * checkbox), or 'anchor' (focusing a field inside a row — re-anchors without
 * throwing away a group the row already belongs to).
 */
function select(id, mode = 'replace') {
  if (id && id === selectedId && selectedIds.size === 1 && (mode === 'anchor' || mode === 'replace')) {
    return;
  }

  if (mode === 'toggle') {
    if (selectedIds.has(id) && selectedIds.size > 1) {
      selectedIds.delete(id);
      if (selectedId === id) selectedId = selectedIds.values().next().value ?? null;
    } else {
      selectedIds.add(id);
      selectedId = id;
    }
  } else if (mode === 'anchor' && selectedIds.has(id)) {
    selectedId = id;
  } else {
    selectedId = id;
    selectedIds = new Set(id ? [id] : []);
  }
  showGizmo();
  refreshList();
}

/** Full rebuild of the list DOM — only for changes that move rows between groups. */
function refreshList() {
  renderOpeningList($('openingList'), state.home, {
    selectedId,
    selectedIds,
    onSelect: select,
    onEdit: (o, geometry) => {
      if (geometry) clampOpening(o, state.home.dimensions);
      rebuild();
      save();
      syncList();
    },
    onRestructure: (id) => { rebuild(); save(); refreshList(); select(id); },
    onDelete: (id) => {
      state.home.openings = state.home.openings.filter((o) => o.id !== id);
      selectedIds.delete(id);
      if (selectedId === id) { selectedId = selectedIds.values().next().value ?? null; }
      rebuild(); save(); showGizmo(); refreshList();
    },
    onDuplicate: (id) => {
      const src = state.home.openings.find((o) => o.id === id);
      if (!src) return;
      const copy = { ...src, id: nextId(src.type[0]), offsetFt: src.offsetFt + src.widthFt + 2 };
      state.home.openings.push(copy);
      rebuild(); save(); refreshList(); select(copy.id);
    },
    onClearSelection: clearSelection,
    onGroupEdit: (fn, geometry) => {
      const list = selectedOpenings();
      for (const o of list) fn(o);
      if (geometry) for (const o of list) clampOpening(o, state.home.dimensions);
      rebuild(); save(); syncList();
    },
    onGroupRestructure: (fn) => {
      for (const o of selectedOpenings()) fn(o);
      rebuild(); save(); refreshList();
    },
    onGroupAction: groupAction,
  });
  updateCounts();
}

/** Cheap update: values and selection only, existing rows untouched. */
function syncList() {
  syncOpeningValues($('openingList'), state.home, selectedId, {
    selectedId,
    selectedIds,
    onSelect: select,
    onEdit: (o, geometry) => {
      if (geometry) clampOpening(o, state.home.dimensions);
      rebuild();
      save();
      syncList();
    },
  });
  updateCounts();
}

/** Bulk alignment / distribution / duplicate / delete for the selection. */
function groupAction(name) {
  const list = selectedOpenings();
  if (!list.length) return;
  const anchor = state.home.openings.find((o) => o.id === selectedId) || list[0];

  if (name === 'delete') {
    state.home.openings = state.home.openings.filter((o) => !selectedIds.has(o.id));
    clearSelection();
    rebuild(); save();
    return;
  }

  if (name === 'duplicate') {
    const copies = list.map((src) => ({
      ...src,
      id: nextId(src.type[0]),
      offsetFt: src.offsetFt + src.widthFt + 2,
    }));
    state.home.openings.push(...copies);
    selectedIds = new Set(copies.map((c) => c.id));
    selectedId = copies[copies.length - 1].id;
    rebuild(); save(); showGizmo(); refreshList();
    return;
  }

  switch (name) {
    case 'alignTop': {
      const head = anchor.sillFt + anchor.heightFt;
      for (const o of list) o.sillFt = Math.max(0, head - o.heightFt);
      break;
    }
    case 'alignSill':
      for (const o of list) o.sillFt = anchor.sillFt;
      break;
    case 'alignLeft':
      for (const o of list) o.offsetFt = anchor.offsetFt;
      break;
    case 'alignCenter': {
      const c = anchor.offsetFt + anchor.widthFt / 2;
      for (const o of list) o.offsetFt = c - o.widthFt / 2;
      break;
    }
    case 'matchWidth':
      for (const o of list) o.widthFt = anchor.widthFt;
      break;
    case 'matchHeight':
      for (const o of list) o.heightFt = anchor.heightFt;
      break;
    case 'distribute': {
      // Offsets only mean the same thing within one wall, so spread per wall.
      const byWall = new Map();
      for (const o of list) {
        if (!byWall.has(o.wall)) byWall.set(o.wall, []);
        byWall.get(o.wall).push(o);
      }
      for (const units of byWall.values()) {
        if (units.length < 3) continue; // two units already define the span
        units.sort((a, b) => a.offsetFt - b.offsetFt);
        const first = units[0], last = units[units.length - 1];
        const span = (last.offsetFt + last.widthFt) - first.offsetFt;
        const solid = units.reduce((s, o) => s + o.widthFt, 0);
        const gap = (span - solid) / (units.length - 1);
        let x = first.offsetFt;
        for (const o of units) { o.offsetFt = x; x += o.widthFt + gap; }
      }
      break;
    }
    default:
      return;
  }

  for (const o of list) clampOpening(o, state.home.dimensions);
  rebuild(); save(); syncList(); showGizmo();
}

function updateCounts() {
  const doors = state.home.openings.filter((o) => o.type !== 'window').length;
  const wins = state.home.openings.length - doors;
  $('openCount').textContent = `${doors} door${doors === 1 ? '' : 's'} / ${wins} window${wins === 1 ? '' : 's'}`;
}

function updateHud() {
  const d = state.home.dimensions;
  const dv = derived(d);
  const ratio = (d.lengthFt / d.widthFt).toFixed(2);
  $('hud').textContent =
    `${state.home.name}\n` +
    `${fmtFt(d.widthFt)} W × ${fmtFt(d.lengthFt)} L   (front wall reads ${ratio}× the gable end)\n` +
    `eave ${fmtFt(dv.eaveY)}   ridge ${fmtFt(dv.ridgeY)}   pitch ${d.roofPitch}/12   floor ${fmtFt(d.floorHeightFt)}`;
  $('ratioHint').textContent =
    `Front wall must read ${ratio}× as long as the gable end is wide. Roof ridge ${fmtFt(dv.ridgeY)} above grade.`;
}

// ---------------------------------------------------------------------------
// Reading the home out of its plan
//
// The plan already carries the dimensions, the roof pitch and the whole opening
// schedule. This hands that page to a vision model and applies the answer —
// through a validator, because a silently applied misread looks authoritative
// and propagates into every plate after it.
// ---------------------------------------------------------------------------

function updatePlanReadState() {
  const el = $('rdpPlanState');
  if (!el) return;
  const plan = state.home.sitePlan || {};
  const ready = !!plan.src;
  el.textContent = ready
    ? `Reading ${plan.name || 'the loaded plan'} — ${plan.width}×${plan.height} px${plan.pageCount > 1 ? `, page ${plan.page} of ${plan.pageCount}` : ''}.`
    : 'Load a site plan in the AI Render Package panel first — that page is what this reads.';
  for (const id of ['btnCopyPlanPrompt', 'btnSavePlanPage', 'btnReadPlan']) {
    if ($(id)) $(id).disabled = !ready;
  }
}

function setPlanReadReport(html) {
  if ($('rdpReport')) $('rdpReport').innerHTML = html;
}

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

/**
 * Show what was read and every correction the validator made. This is the
 * screen the user is meant to hold against the actual sheet — the numbers are
 * only as good as that check, so errors are listed before anything else.
 */
function renderSpecReport(result, source) {
  const errors = result.issues.filter((i) => i.level === 'error');
  const warns = result.issues.filter((i) => i.level === 'warn');
  const parts = [];
  parts.push(`<div class="rdp-summary">${esc(result.summary)}</div>`);
  parts.push(
    `<p class="rdp-readings">Read from ${esc(source)} · confidence <b>${esc(result.spec.confidence)}</b>`
    + (result.spec.readings.dimensionLine
      ? `<br>Dimension line on the sheet: <b>${esc(result.spec.readings.dimensionLine)}</b>` : '')
    + (result.spec.readings.notes ? `<br>${esc(result.spec.readings.notes)}` : '')
    + `</p>`,
  );
  if (!errors.length && !warns.length) {
    parts.push(`<div class="rdp-issue ok">Nothing needed correcting. Still check the numbers against the sheet before you build on them.</div>`);
  }
  for (const i of [...errors, ...warns]) {
    parts.push(`<div class="rdp-issue ${i.level}">${esc(i.text)}</div>`);
  }
  parts.push(
    `<div class="rdp-issue ${errors.length ? 'error' : 'warn'}">`
    + `${errors.length ? `${errors.length} value${errors.length === 1 ? '' : 's'} had to be corrected. ` : ''}`
    + `Check the footprint and every opening against the sheet before exporting a package.</div>`,
  );
  setPlanReadReport(parts.join(''));
}

/** Apply a validated spec, keeping colours, photos, views and the plan itself. */
function applyReadSpec(result, source) {
  state.home = applySpecToHome(state.home, result.spec, (prefix) => nextId(prefix));
  selectedId = null;
  selectedIds.clear();
  gizmo.clear();
  syncForm();
  rebuild();
  refreshList();
  stage.setView('hero-left', state.home.dimensions, state.scene);
  currentViewName = '¾ front-L';
  updateFramingReadout();
  save();
  renderSpecReport(result, source);
}

function applyPastedSpec() {
  const text = $('rdp_json')?.value || '';
  let parsed;
  try {
    parsed = extractJson(text);
  } catch (err) {
    setPlanReadReport(`<div class="rdp-issue error">Could not read that as JSON: ${esc(err.message)}</div>`);
    return;
  }
  const result = validateHomeSpec(parsed);
  if (!result.ok) {
    setPlanReadReport(result.issues.map((i) => `<div class="rdp-issue error">${esc(i.text)}</div>`).join(''));
    return;
  }
  applyReadSpec(result, 'the pasted answer');
}

function planPrompt() {
  return buildSpecPrompt({
    knownWidthFt: state.home.dimensions.widthFt,
    knownLengthFt: state.home.dimensions.lengthFt,
  })
    + '\n\n## Schema\n\nAnswer with a JSON object matching this schema exactly:\n\n```json\n'
    + JSON.stringify(HOME_SPEC_SCHEMA, null, 2)
    + '\n```\n';
}

let planReadAbort = null;

function syncApiKeysUI() {
  const keys = loadApiKeys();
  const provider = keys.activeProvider || 'anthropic';
  const persist = isPersisted();

  if ($('selAiProvider')) $('selAiProvider').value = provider;
  if ($('key_anthropic')) $('key_anthropic').value = keys.anthropic || '';
  if ($('key_openai')) $('key_openai').value = keys.openai || '';
  if ($('key_grok')) $('key_grok').value = keys.grok || '';
  if ($('key_gemini')) $('key_gemini').value = keys.gemini || '';
  if ($('chkPersistKeys')) $('chkPersistKeys').checked = persist;

  if ($('rdp_provider')) $('rdp_provider').value = provider;
  if ($('rdp_key_anthropic')) $('rdp_key_anthropic').value = keys.anthropic || '';
  if ($('rdp_key_openai')) $('rdp_key_openai').value = keys.openai || '';
  if ($('rdp_key_grok')) $('rdp_key_grok').value = keys.grok || '';
  if ($('rdp_key_gemini')) $('rdp_key_gemini').value = keys.gemini || '';
  if ($('rdp_persist')) $('rdp_persist').checked = persist;
}

function storeApiKeysFromUI() {
  const provider = $('rdp_provider')?.value || $('selAiProvider')?.value || 'anthropic';
  const persist = $('rdp_persist')?.checked ?? $('chkPersistKeys')?.checked ?? false;
  const keys = {
    activeProvider: provider === 'autocycle' ? (loadApiKeys().activeProvider || 'anthropic') : provider,
    anthropic: ($('rdp_key_anthropic')?.value || $('key_anthropic')?.value || '').trim(),
    openai: ($('rdp_key_openai')?.value || $('key_openai')?.value || '').trim(),
    grok: ($('rdp_key_grok')?.value || $('key_grok')?.value || '').trim(),
    gemini: ($('rdp_key_gemini')?.value || $('key_gemini')?.value || '').trim(),
  };
  saveApiKeys(keys, persist);
  syncApiKeysUI();
}

function cycleActiveProvider() {
  const providers = ['anthropic', 'openai', 'grok', 'gemini', 'autocycle'];
  const keys = loadApiKeys();
  const curr = $('rdp_provider')?.value || keys.activeProvider || 'anthropic';
  const nextIdx = (providers.indexOf(curr) + 1) % providers.length;
  const nextProvider = providers[nextIdx];

  if ($('rdp_provider')) $('rdp_provider').value = nextProvider;
  if ($('selAiProvider') && nextProvider !== 'autocycle') $('selAiProvider').value = nextProvider;

  if (nextProvider !== 'autocycle') {
    keys.activeProvider = nextProvider;
    saveApiKeys(keys, isPersisted());
  }
  syncApiKeysUI();
}

let planReadAbort = null;

function bindPlanReader() {
  syncApiKeysUI();

  const onChange = () => storeApiKeysFromUI();
  for (const id of ['rdp_provider', 'rdp_key_anthropic', 'rdp_key_openai', 'rdp_key_grok', 'rdp_key_gemini', 'rdp_persist']) {
    if ($(id)) $(id).addEventListener('change', onChange);
  }

  if ($('btnCycleProvider')) {
    $('btnCycleProvider').addEventListener('click', () => {
      cycleActiveProvider();
      const prov = $('rdp_provider')?.value || 'anthropic';
      setPlanReadReport(`<div class="rdp-issue ok">Active Vision Provider set to: <b>${prov.toUpperCase()}</b></div>`);
    });
  }

  if ($('btnCopyPlanPrompt')) {
    $('btnCopyPlanPrompt').addEventListener('click', async () => {
      const text = planPrompt();
      try {
        await navigator.clipboard.writeText(text);
        setPlanReadReport('<div class="rdp-issue ok">Prompt copied. Attach the plan page alongside it, then paste the JSON answer into the box above.</div>');
      } catch {
        window.prompt('Copy the plan-reading prompt:', text.slice(0, 2000));
      }
    });
  }

  if ($('btnSavePlanPage')) {
    $('btnSavePlanPage').addEventListener('click', async () => {
      const plan = state.home.sitePlan || {};
      if (!plan.src) return;
      const blob = await (await fetch(plan.src)).blob();
      const name = `${(state.home.name || 'home').replace(/[^\w-]+/g, '_')}-plan-page.png`;
      const saved = await saveWithPicker(blob, name, 'PNG Image', 'image/png', '.png');
      if (!saved) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      }
    });
  }

  if ($('btnReadPlan')) {
    $('btnReadPlan').addEventListener('click', async () => {
      const btn = $('btnReadPlan');
      storeApiKeysFromUI();
      const keys = loadApiKeys();
      const provider = $('rdp_provider')?.value || keys.activeProvider || 'anthropic';

      const hasAnyKey = keys.anthropic || keys.openai || keys.grok || keys.gemini;
      if (!hasAnyKey) {
        setPlanReadReport('<div class="rdp-issue error">Paste an API key (Anthropic, OpenAI, Grok, or Gemini) first, or use the copy-the-prompt path above.</div>');
        return;
      }

      btn.disabled = true;
      setPlanReadReport(`<div class="rdp-issue warn">Reading the plan with ${provider.toUpperCase()} Vision… a dense sheet can take a minute.</div>`);
      planReadAbort?.abort();
      planReadAbort = new AbortController();
      try {
        const res = await readPlanWithAutoCycle({
          keys,
          provider,
          planDataUrl: state.home.sitePlan.src,
          prompt: planPrompt(),
          schema: HOME_SPEC_SCHEMA,
          signal: planReadAbort.signal,
          onProgress: (prov) => {
            setPlanReadReport(`<div class="rdp-issue warn">Analyzing plan with ${prov.toUpperCase()} Vision model…</div>`);
          },
        });

        if ($('rdp_json')) $('rdp_json').value = res.raw;
        const result = validateHomeSpec(extractJson(res.raw));
        if (!result.ok) {
          setPlanReadReport(result.issues.map((i) => `<div class="rdp-issue error">${esc(i.text)}</div>`).join(''));
          return;
        }
        applyReadSpec(result, `${res.providerUsed.toUpperCase()} Vision (${res.model})`);
      } catch (err) {
        if (err.name === 'AbortError') return;
        setPlanReadReport(`<div class="rdp-issue error">${esc(err.message)}</div>`);
      } finally {
        btn.disabled = false;
        updatePlanReadState();
      }
    });
  }

  if ($('btnApplySpec')) $('btnApplySpec').addEventListener('click', applyPastedSpec);
}

// ---------------------------------------------------------------------------
// Photos of the real home — one per wall, the authority on finish
// ---------------------------------------------------------------------------

/** Reuses the lot-slot card markup; the two lists read the same on purpose. */
function renderHomePhotoList() {
  const host = $('homePhotoList');
  if (!host) return;
  host.textContent = '';
  const photos = state.home.homePhotos || {};

  HOME_PHOTO_SLOTS.forEach((slot, i) => {
    const photo = photos[slot.key];
    const filled = !!photo?.src;

    const card = document.createElement('div');
    card.className = `slot ${filled ? 'filled' : 'empty'}`;

    const thumb = document.createElement(filled ? 'img' : 'div');
    thumb.className = `slot-thumb${filled ? ' has-photo' : ''}`;
    if (filled) { thumb.src = photo.src; thumb.alt = slot.name; }
    else thumb.textContent = '+';
    thumb.title = filled ? photo.name || slot.name : `Load the ${slot.name} photo`;
    thumb.addEventListener('click', () => pickHomePhoto(slot.key));
    card.appendChild(thumb);

    const body = document.createElement('div');
    body.className = 'slot-body';

    const name = document.createElement('div');
    name.className = 'slot-name';
    const num = document.createElement('span');
    num.className = 'slot-num';
    num.textContent = `${i + 1}`;
    name.appendChild(num);
    name.appendChild(document.createTextNode(slot.name));
    body.appendChild(name);

    const shoot = document.createElement('div');
    shoot.className = 'slot-shoot';
    shoot.textContent = filled
      ? `${photo.name || 'Loaded'} — pairs with ${slot.plate}`
      : slot.shoot;
    body.appendChild(shoot);

    const actions = document.createElement('div');
    actions.className = 'slot-actions';
    const load = document.createElement('button');
    load.textContent = filled ? 'Replace photo' : 'Load photo';
    load.addEventListener('click', () => pickHomePhoto(slot.key));
    actions.appendChild(load);
    if (filled) {
      const clear = document.createElement('button');
      clear.textContent = 'Clear';
      clear.addEventListener('click', () => {
        delete state.home.homePhotos[slot.key];
        renderHomePhotoList();
        save();
      });
      actions.appendChild(clear);
    }
    body.appendChild(actions);
    card.appendChild(body);
    host.appendChild(card);
  });
}

let pendingHomePhotoKey = null;

function pickHomePhoto(key) {
  pendingHomePhotoKey = key;
  $('fileHomePhoto')?.click();
}

function bindHomePhotos() {
  if (!$('fileHomePhoto')) return;
  $('fileHomePhoto').addEventListener('change', (e) => {
    const f = e.target.files[0];
    const key = pendingHomePhotoKey;
    pendingHomePhotoKey = null;
    e.target.value = '';
    if (!f || !homeSlotByKey(key)) return;
    // 1800 on the long edge: the model reads siding profile and window
    // proportion off these, which survives downscaling; the file size does not.
    downscaleImage(f, 1800, 0.86).then((src) => {
      state.home.homePhotos = { ...state.home.homePhotos, [key]: { src, name: f.name } };
      renderHomePhotoList();
      save();
      setPackageStatus(`Loaded the ${homeSlotByKey(key).name} photo of the home.`);
    }).catch(() => alert('Could not read that image.'));
  });
}

// ---------------------------------------------------------------------------
// 360 panorama
// ---------------------------------------------------------------------------

const panoFields = [
  ['pn_yaw', 'yawDeg'], ['pn_tilt', 'tiltDeg'], ['pn_radius', 'radiusFt'],
  ['pn_height', 'heightFt'], ['pn_brightness', 'brightness'], ['pn_opacity', 'opacity'],
];

function updatePanoStatus() {
  const el = $('panoStatus');
  if (!el) return;
  const p = state.home.panorama || {};
  if (!p.src) {
    el.textContent = 'No panorama loaded. Any equirectangular 360 shot works — a phone pano app, an Insta360, or a Street View export.';
    return;
  }
  const dims = p.width ? `${p.width}×${p.height}` : 'loaded';
  // A true equirect is 2:1. Anything else will not wrap evenly, and the usual
  // cause is a cropped or partial pano, which is worth saying out loud.
  const aspect = p.width && p.height ? p.width / p.height : 2;
  const warn = Math.abs(aspect - 2) > 0.08
    ? ` — this is ${aspect.toFixed(2)}:1, not the 2:1 an equirectangular pano needs, so it will wrap unevenly.`
    : '';
  el.textContent = `${p.name || 'Panorama'} — ${dims}${warn}`;
}

function bindPanorama() {
  if ($('filePanorama')) {
    $('filePanorama').addEventListener('change', (e) => {
      const f = e.target.files[0];
      if (!f) return;
      // 4096 on the long edge: a raw 11k pano is 30 MB of base64 and would blow
      // localStorage, but 1600 (the flat-photo cap) reads as mush once it is
      // stretched across a full 360 degrees.
      downscaleImage(f, 4096, 0.86).then((dataUrl) => {
        const img = new Image();
        img.onload = () => {
          state.home.panorama = {
            ...state.home.panorama,
            src: dataUrl, show: true, name: f.name,
            width: img.naturalWidth, height: img.naturalHeight,
          };
          if ($('pn_show')) $('pn_show').checked = true;
          rebuild();
          updatePanoStatus();
        };
        img.src = dataUrl;
      }).catch(() => alert('Could not read that panorama.'));
      e.target.value = '';
    });
  }

  for (const [id, key] of panoFields) {
    if (!$(id)) continue;
    $(id).addEventListener('input', (e) => {
      const v = parseFloat(e.target.value);
      if (!Number.isFinite(v)) return;
      state.home.panorama[key] = v;
      rebuild();
    });
  }

  if ($('pn_show')) {
    $('pn_show').addEventListener('change', (e) => {
      state.home.panorama.show = e.target.checked;
      rebuild();
      updateSitePhotoPlate();
    });
  }

  if ($('btnPanoSpin')) {
    $('btnPanoSpin').addEventListener('click', () => {
      stage.rotateView(45);
      updateFramingReadout();
    });
  }
}

// ---------------------------------------------------------------------------
// Saved site views
//
// One lot photo renders one view, so a site shot from several positions is
// several complete set-ups — photo, alignment and camera together. These store
// and restore them; the render package renders one folder per view.
// ---------------------------------------------------------------------------

function activeSiteView() {
  return state.home.siteViews.find((v) => v.id === state.home.activeSiteViewId) || null;
}

/**
 * While a view is active, the alignment work the user does — panning the photo,
 * setting the ground baseline, orbiting — belongs to that view. Without this,
 * you align a photo, cycle to the next one, come back, and the alignment is
 * gone. Suspended while a view is being applied or while the packager is
 * stepping through them, or a half-applied state would be written back.
 */
let suspendViewSync = false;

function syncActiveSiteView() {
  if (suspendViewSync || applyingHistory) return;
  const view = activeSiteView();
  if (!view) return;
  const fresh = captureSiteView({
    id: view.id,
    name: view.name,
    slotKey: view.slotKey,
    sitePhoto: state.home.sitePhoto,
    camera: stage.cameraState(),
    viewLabel: currentViewName,
    savedAt: view.savedAt,
  });
  Object.assign(view, fresh);
}

/** Run `fn` without the active view absorbing the intermediate state. */
function withoutViewSync(fn) {
  const was = suspendViewSync;
  suspendViewSync = true;
  const restore = () => { suspendViewSync = was; };
  let out;
  try {
    out = fn();
  } catch (err) {
    restore();
    throw err;
  }
  // The packager is async and steps through every view, so the guard has to
  // outlive the synchronous call.
  if (out && typeof out.then === 'function') {
    return out.then((v) => { restore(); return v; }, (e) => { restore(); throw e; });
  }
  restore();
  return out;
}

/** One card per standard lot photograph, filled or not. */
function renderSlotList() {
  const host = $('slotList');
  if (!host) return;
  host.textContent = '';
  const views = state.home.siteViews;

  SITE_VIEW_SLOTS.forEach((slot, i) => {
    const view = findSlotView(views, slot.key);
    const filled = !!view?.photo?.src;
    const isActive = view && view.id === state.home.activeSiteViewId;

    const card = document.createElement('div');
    card.className = `slot ${filled ? 'filled' : 'empty'}${isActive ? ' active' : ''}`;

    const thumb = document.createElement(filled ? 'img' : 'div');
    thumb.className = `slot-thumb${filled ? ' has-photo' : ''}`;
    if (filled) { thumb.src = view.photo.src; thumb.alt = slot.name; }
    else thumb.textContent = '+';
    thumb.title = filled ? 'Show this lot photo' : `Load the ${slot.name} photo`;
    thumb.addEventListener('click', () => (filled ? applySiteViewById(view.id) : pickSlotPhoto(slot.key)));
    card.appendChild(thumb);

    const body = document.createElement('div');
    body.className = 'slot-body';

    const name = document.createElement('div');
    name.className = 'slot-name';
    const num = document.createElement('span');
    num.className = 'slot-num';
    num.textContent = `${i + 1}`;
    name.appendChild(num);
    name.appendChild(document.createTextNode(slot.name));
    body.appendChild(name);

    const shoot = document.createElement('div');
    shoot.className = 'slot-shoot';
    shoot.textContent = slot.shoot;
    body.appendChild(shoot);

    const actions = document.createElement('div');
    actions.className = 'slot-actions';

    const load = document.createElement('button');
    load.textContent = filled ? 'Replace photo' : 'Load photo';
    load.addEventListener('click', () => pickSlotPhoto(slot.key));
    actions.appendChild(load);

    if (filled) {
      const use = document.createElement('button');
      use.textContent = isActive ? '● Showing' : 'Show';
      use.disabled = isActive;
      use.addEventListener('click', () => applySiteViewById(view.id));
      actions.appendChild(use);

      const clear = document.createElement('button');
      clear.textContent = 'Clear';
      clear.addEventListener('click', () => deleteSiteView(view.id));
      actions.appendChild(clear);
    }

    body.appendChild(actions);
    card.appendChild(body);
    host.appendChild(card);
  });
}

let pendingSlotKey = null;

function pickSlotPhoto(key) {
  pendingSlotKey = key;
  $('fileSlotPhoto')?.click();
}

/**
 * Load a photograph into one of the four slots. The camera jumps to the preset
 * that slot is defined by, because that is the framing the plate has to be
 * rendered at for the photo to be usable — the user then nudges the alignment
 * from there and the slot keeps it.
 */
function loadSlotPhoto(key, dataUrl) {
  const slot = slotByKey(key);
  if (!slot) return;
  const views = state.home.siteViews;
  const existing = findSlotView(views, key);

  withoutViewSync(() => {
    state.home.sitePhoto = { ...state.home.sitePhoto, ...(existing?.photo || {}), src: dataUrl, show: true };
    currentViewName = slot.name;
    rebuild();
    // An existing slot keeps the framing already dialled in for it; a new one
    // starts from the preset the slot is named after.
    if (existing?.camera) stage.applyCameraState(existing.camera);
    else stage.setView(slot.preset, state.home.dimensions, state.scene);
  });

  const view = captureSiteView({
    id: existing?.id,
    name: existing?.name || uniqueViewName(views, slot.name),
    slotKey: key,
    sitePhoto: state.home.sitePhoto,
    camera: stage.cameraState(),
    viewLabel: slot.name,
    savedAt: new Date().toISOString(),
  });
  if (existing) Object.assign(existing, view);
  else state.home.siteViews = sortSiteViews([...views, view]);

  state.home.activeSiteViewId = view.id;
  syncForm();
  updateSitePhotoPlate();
  updateFramingReadout();
  renderSlotList();
  renderSiteViewList();
  save();
  setPackageStatus(`Loaded the ${slot.name} lot photo. Align the model to it — this slot keeps the alignment and the camera.`);
}

function updateSiteViewBadge() {
  const bar = $('siteViewBar');
  const badge = $('siteViewBadge');
  const has = state.home.siteViews.length > 0;
  if (bar) bar.style.display = has ? '' : 'none';
  if (!badge) return;
  const active = activeSiteView();
  if (active) {
    const at = state.home.siteViews.indexOf(active) + 1;
    badge.textContent = `${at}/${state.home.siteViews.length} · ${active.name}`;
    badge.classList.remove('unsaved');
  } else {
    badge.textContent = has ? 'Unsaved set-up' : 'No site view';
    badge.classList.add('unsaved');
  }
}

/** One row per saved view: thumbnail, editable name, and its own actions. */
function renderSiteViewList() {
  const host = $('siteViewList');
  if (!host) return;
  host.textContent = '';
  const views = state.home.siteViews;

  if (!views.length) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = 'No site views saved yet. Load a lot photo, align it, frame the camera, then "+ Save current".';
    host.appendChild(p);
    updateSiteViewBadge();
    return;
  }

  for (const view of views) {
    const row = document.createElement('div');
    row.className = 'site-view' + (view.id === state.home.activeSiteViewId ? ' active' : '');
    row.title = 'Click to restore this lot photo, its alignment and its camera';

    if (view.photo?.src) {
      const img = document.createElement('img');
      img.className = 'thumb';
      img.src = view.photo.src;
      img.alt = '';
      row.appendChild(img);
    } else {
      const box = document.createElement('div');
      box.className = 'thumb empty';
      box.textContent = 'no photo';
      row.appendChild(box);
    }

    const body = document.createElement('div');
    body.className = 'sv-body';

    const name = document.createElement('input');
    name.className = 'sv-name';
    name.type = 'text';
    name.value = view.name;
    name.addEventListener('click', (e) => e.stopPropagation());
    name.addEventListener('change', () => {
      view.name = uniqueViewName(views, name.value, view.id);
      name.value = view.name;
      updateSiteViewBadge();
      save();
    });
    body.appendChild(name);

    const meta = document.createElement('div');
    meta.className = 'sv-meta';
    const cam = view.camera;
    meta.textContent = [
      view.viewLabel || cam?.preset || 'free camera',
      cam?.type === 'ortho' ? 'orthographic' : 'perspective',
      view.photo?.src ? 'lot photo' : 'no lot photo',
    ].join(' · ');
    body.appendChild(meta);
    row.appendChild(body);

    const actions = document.createElement('div');
    actions.className = 'sv-actions';

    const upd = document.createElement('button');
    upd.textContent = '⭯';
    upd.title = 'Overwrite this view with the current photo, alignment and camera';
    upd.addEventListener('click', (e) => { e.stopPropagation(); updateSiteViewFromLive(view.id); });
    actions.appendChild(upd);

    const del = document.createElement('button');
    del.textContent = '✕';
    del.title = 'Delete this site view';
    del.addEventListener('click', (e) => { e.stopPropagation(); deleteSiteView(view.id); });
    actions.appendChild(del);

    row.appendChild(actions);
    row.addEventListener('click', () => applySiteViewById(view.id));
    host.appendChild(row);
  }
  updateSiteViewBadge();
}

function addSiteView() {
  const views = state.home.siteViews;
  const view = captureSiteView({
    name: suggestViewName(views, currentViewName),
    sitePhoto: state.home.sitePhoto,
    camera: stage.cameraState(),
    viewLabel: currentViewName,
    savedAt: new Date().toISOString(),
  });
  views.push(view);
  state.home.activeSiteViewId = view.id;
  renderSlotList();
  renderSiteViewList();
  save();
  setPackageStatus(`Saved site view "${view.name}". The render package can render every saved view in one pass.`);
}

function updateSiteViewFromLive(id) {
  const views = state.home.siteViews;
  const at = indexOfView(views, id);
  if (at < 0) return;
  views[at] = captureSiteView({
    id,
    name: views[at].name,
    sitePhoto: state.home.sitePhoto,
    camera: stage.cameraState(),
    viewLabel: currentViewName,
    savedAt: new Date().toISOString(),
  });
  state.home.activeSiteViewId = id;
  renderSlotList();
  renderSiteViewList();
  save();
  setPackageStatus(`Updated site view "${views[at].name}".`);
}

function deleteSiteView(id) {
  const views = state.home.siteViews;
  const at = indexOfView(views, id);
  if (at < 0) return;
  const what = views[at].slotKey ? `Clear the ${views[at].name} slot` : `Delete the site view "${views[at].name}"`;
  if (!confirm(`${what}? The lot photo it holds goes with it.`)) return;
  views.splice(at, 1);
  if (state.home.activeSiteViewId === id) state.home.activeSiteViewId = null;
  renderSlotList();
  renderSiteViewList();
  save();
}

/**
 * Restore a saved set-up. The camera goes back AFTER the rebuild: rebuild()
 * re-applies sitePhoto.camDist to the perspective camera, which would otherwise
 * pull the restored framing off the photo it was aligned to.
 */
function applySiteViewById(id) {
  const view = state.home.siteViews.find((v) => v.id === id);
  if (!view) return;
  withoutViewSync(() => {
    state.home.sitePhoto = applySiteView(view, state.home.sitePhoto);
    state.home.activeSiteViewId = view.id;
    if (view.viewLabel) currentViewName = view.viewLabel;
    syncForm();
    rebuild();
    if (view.camera && stage.applyCameraState(view.camera)) {
      // The frustum was rebuilt for the aspect the view was saved at; re-apply
      // the live one so the plate and the photo stay registered.
      fit();
    }
  });
  updateSitePhotoPlate();
  updateFramingReadout();
  renderSlotList();
  renderSiteViewList();
  save();
}

function cycleSiteViews(step) {
  const next = cycleSiteView(state.home.siteViews, state.home.activeSiteViewId, step);
  if (next) applySiteViewById(next.id);
}

function bindSiteViews() {
  if ($('fileSlotPhoto')) {
    $('fileSlotPhoto').addEventListener('change', (e) => {
      const f = e.target.files[0];
      const key = pendingSlotKey;
      pendingSlotKey = null;
      e.target.value = '';
      if (!f || !key) return;
      downscaleImage(f, 1600, 0.85)
        .then((dataUrl) => loadSlotPhoto(key, dataUrl))
        .catch(() => alert('Could not read that image.'));
    });
  }
  if ($('btnAddSiteView')) $('btnAddSiteView').addEventListener('click', addSiteView);
  for (const id of ['btnPrevSiteView', 'btnPrevSiteViewBar']) {
    if ($(id)) $(id).addEventListener('click', () => cycleSiteViews(-1));
  }
  for (const id of ['btnNextSiteView', 'btnNextSiteViewBar']) {
    if ($(id)) $(id).addEventListener('click', () => cycleSiteViews(1));
  }
}

// ---------------------------------------------------------------------------
// Render package
// ---------------------------------------------------------------------------

const briefFields = [
  ['bf_nearCorner', 'nearCorner'], ['bf_pad', 'pad'], ['bf_landmark', 'landmark'],
  ['bf_heightRef', 'heightRef'], ['bf_keep', 'keep'], ['bf_light', 'light'],
  ['bf_notes', 'notes'],
];
const packageChecks = [
  ['pk_contactSheet', 'contactSheet'], ['pk_elevations', 'elevations'],
  ['pk_cutout', 'cutout'], ['pk_lotPhoto', 'lotPhoto'], ['pk_sitePlan', 'sitePlan'],
  ['pk_originalPdf', 'originalPdf'], ['pk_projectJson', 'projectJson'],
  ['pk_allSiteViews', 'allSiteViews'], ['pk_homePhotos', 'homePhotos'],
];

/** Original PDFs are kept for the human, not the model — a 40 MB one is not
 *  worth carrying through localStorage and into every package. */
const MAX_KEPT_PDF_BYTES = 8 * 1024 * 1024;

function packageOptions() {
  const out = {};
  for (const [id, key] of packageChecks) out[key] = $(id) ? $(id).checked : true;
  return out;
}

const pct = (v) => `${Math.round(v * 100)}%`;

function updateFramingReadout() {
  const el = $('framingReadout');
  if (!el) return;
  const f = measureFraming(stage, state.home, currentViewName);
  if (!f) {
    el.textContent = 'The model is out of frame, so the brief will fall back to hand-typed scale blanks. Re-frame the view.';
    return;
  }
  el.textContent =
    `Spans ${pct(f.left)}–${pct(f.right)} of frame width · ridge at ${pct(f.ridgeTop)} of frame height · ` +
    `nearest corner: ${f.nearCorner} · sees ${f.visibleWalls.join(', ') || 'no walls'}.`;
}

function updateSitePlanStatus() {
  const el = $('sitePlanStatus');
  const plan = state.home.sitePlan || {};
  const row = $('row_sitePlanPage');
  if (row) row.style.display = plan.pageCount > 1 ? '' : 'none';
  updatePlanReadState();
  if (!el) return;
  if (!plan.src) {
    el.textContent = 'No site plan loaded. A PDF is converted to PNG automatically — image models ignore PDF attachments.';
    return;
  }
  const pages = plan.pageCount > 1 ? `, page ${plan.page} of ${plan.pageCount}` : '';
  const pdf = plan.pdf ? ' · original PDF kept' : '';
  el.textContent = `${plan.name || 'Site plan'} — ${plan.width}×${plan.height} px PNG${pages}${pdf}.`;
}

function currentBrief() {
  return buildBrief({
    home: state.home,
    scene: state.scene,
    framing: measureFraming(stage, state.home, currentViewName),
    site: state.home.brief || {},
    savedAt: new Date().toISOString().slice(0, 10),
  });
}

/**
 * Lets the packager step through the saved site views and put the live set-up
 * back afterwards. Applying a view has to go through rebuild(): the home group's
 * position, heading and ground baseline all come off sitePhoto, so a plate
 * rendered without it would be framed on the previous view's lot.
 */
function packageRenderContext() {
  const savedPhoto = { ...state.home.sitePhoto };
  const savedCamera = stage.cameraState();
  const savedViewName = currentViewName;
  const savedActive = state.home.activeSiteViewId;
  return {
    applyView: (view) => {
      state.home.sitePhoto = applySiteView(view, state.home.sitePhoto);
      if (view.viewLabel) currentViewName = view.viewLabel;
      rebuild();
      if (view.camera) stage.applyCameraState(view.camera);
    },
    restore: () => {
      state.home.sitePhoto = savedPhoto;
      currentViewName = savedViewName;
      state.home.activeSiteViewId = savedActive;
      rebuild();
      stage.applyCameraState(savedCamera);
    },
  };
}

function setPackageStatus(msg) {
  if ($('packageStatus')) $('packageStatus').textContent = msg || '';
}

/** The picked file becomes a PNG page plus, optionally, the original PDF. */
let sitePlanFile = null;

async function applySitePlanFile(file, page) {
  setPackageStatus(`Reading ${file.name}…`);
  const res = await loadSitePlan(file, { page: page || 1 });
  const keepPdf = isPdf(file) && file.size <= MAX_KEPT_PDF_BYTES;
  state.home.sitePlan = {
    src: res.dataUrl,
    pdf: keepPdf ? await fileToDataUrl(file) : null,
    name: file.name,
    page: res.page,
    pageCount: res.pageCount,
    width: res.width,
    height: res.height,
  };
  if ($('sp_planPage')) $('sp_planPage').value = res.page;
  updateSitePlanStatus();
  save();
  setPackageStatus(
    isPdf(file) && !keepPdf
      ? 'Site plan converted. The original PDF was too large to keep, so only the PNG page is packaged.'
      : 'Site plan ready.',
  );
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('read failed'));
    r.readAsDataURL(file);
  });
}

function bindPackage() {
  for (const [id, key] of briefFields) {
    if (!$(id)) continue;
    $(id).addEventListener('input', (e) => {
      state.home.brief[key] = e.target.value;
      save();
    });
  }

  if ($('fileSitePlan')) {
    $('fileSitePlan').addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      sitePlanFile = f;
      try {
        await applySitePlanFile(f, 1);
      } catch (err) {
        setPackageStatus('');
        alert(`Could not read that site plan: ${err.message}`);
      }
      e.target.value = '';
    });
  }

  if ($('btnSitePlanPage')) {
    $('btnSitePlanPage').addEventListener('click', async () => {
      const page = parseInt($('sp_planPage').value, 10) || 1;
      if (!sitePlanFile) {
        setPackageStatus('Re-pick the PDF to render another page — only the converted page is kept between sessions.');
        return;
      }
      try {
        await applySitePlanFile(sitePlanFile, page);
      } catch (err) {
        alert(`Could not render page ${page}: ${err.message}`);
      }
    });
  }

  if ($('btnCopyBrief')) {
    $('btnCopyBrief').addEventListener('click', async () => {
      const text = currentBrief();
      try {
        await navigator.clipboard.writeText(text);
        setPackageStatus('Brief copied to the clipboard.');
      } catch {
        // Clipboard access is blocked outside a secure context; fall back to a
        // selectable prompt rather than silently doing nothing.
        window.prompt('Copy the brief:', text.slice(0, 2000));
      }
    });
  }

  if ($('btnSaveBrief')) {
    $('btnSaveBrief').addEventListener('click', async () => {
      const blob = new Blob([currentBrief()], { type: 'text/markdown' });
      const name = `${(state.home.name || 'home').replace(/[^\w-]+/g, '_')}-brief.md`;
      const saved = await saveWithPicker(blob, name, 'Markdown brief', 'text/markdown', '.md');
      if (!saved) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      }
      setPackageStatus(`Brief saved as ${name}.`);
    });
  }

  if ($('btnPackage')) {
    $('btnPackage').addEventListener('click', async () => {
      const btn = $('btnPackage');
      btn.disabled = true;
      setPackageStatus('Rendering plates…');
      try {
        // Stepping through the views must not write each one's photo back into
        // whichever view happens to be active.
        const res = await withoutViewSync(() => exportRenderPackage({
          stage,
          state,
          viewName: currentViewName,
          options: packageOptions(),
          savedAt: new Date().toISOString().slice(0, 10),
          ...packageRenderContext(),
        }));
        const kb = Math.round(res.bytes / 1024);
        const passes = res.passes?.length
          ? `${res.passes.length} render pass${res.passes.length === 1 ? '' : 'es'}, one per site view. `
          : '';
        setPackageStatus(`${res.filename} — ${passes}${res.files.length} files, ${kb} KB. ${res.framing ? 'Framing measured off the camera.' : 'Camera framing could not be measured; the brief uses your typed blanks.'}`);
        renderSiteViewList();
      } catch (err) {
        console.error(err);
        setPackageStatus('');
        alert(`Could not build the render package: ${err.message}`);
      } finally {
        btn.disabled = false;
        // Plate rendering resizes the renderer and hides the site photo plate.
        updateSitePhotoPlate();
        updateFramingReadout();
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Form binding
// ---------------------------------------------------------------------------

const dimFields = [
  ['f_width', 'widthFt'], ['f_length', 'lengthFt'], ['f_wallHeight', 'wallHeightFt'],
  ['f_floorHeight', 'floorHeightFt'], ['f_pitch', 'roofPitch'],
  ['f_eaveOverhang', 'eaveOverhangFt'], ['f_rakeOverhang', 'rakeOverhangFt'],
  ['f_dormerWidth', 'dormerWidthFt'], ['f_dormerHeight', 'dormerHeightFt'],
  ['f_windowHeadDrop', 'windowHeadDropFt'], ['f_doorHeadDrop', 'doorHeadDropFt'],
  ['f_frontWallHeight', 'frontWallHeightFt'], ['f_backWallHeight', 'backWallHeightFt'],
  ['f_leftWallHeight', 'leftWallHeightFt'], ['f_rightWallHeight', 'rightWallHeightFt'],
];
const colorFields = [
  ['c_siding', 'siding'], ['c_belowDormerSiding', 'belowDormerSiding'], ['c_dormerSiding', 'dormerSiding'], ['c_gableSiding', 'gableSiding'],
  ['c_trim', 'trim'], ['c_roof', 'roof'], ['c_skirting', 'skirting'], ['c_door', 'door'], ['c_glass', 'glass'],
];
const planFields = [['p_width', 'widthFt'], ['p_rot', 'rotation'], ['p_x', 'offsetX'], ['p_z', 'offsetZ']];
const photoFields = [
  ['sp_op', 'opacity'], ['sp_scale', 'scale'], ['sp_panX', 'panX'],
  ['sp_panY', 'panY'], ['sp_rot', 'rotation'], ['sp_baselineY', 'baselineY'],
  ['sp_camDist', 'camDist'], ['sp_posX', 'posX'], ['sp_posZ', 'posZ'], ['sp_rotY', 'rotY'],
];
const sceneNums = [['s_focal', 'focal'], ['s_eye', 'eye'], ['s_landingDepth', 'landingDepthFt']];
const sceneRanges = [['s_sunAz', 'sunAz'], ['s_sunEl', 'sunEl'], ['s_flat', 'flat']];
const sceneChecks = [['s_grid', 'grid'], ['s_shadow', 'shadow'], ['s_steps', 'steps'], ['s_stepLanding', 'stepLanding'], ['s_wireframe', 'wireframe'], ['s_blockLandscape', 'blockLandscape'], ['s_labels', 'labels'], ['s_dims', 'dims']];

/** Snap to the nearest quarter foot (3 in) so the steps land on whole feet. */
const roundQuarter = (v) => Math.round(v * 4) / 4;

/** The head-drop fields only bite while the global head alignment is on. */
function syncHeadAlignRows() {
  const on = !!state.home.dimensions.headAlign;
  if ($('f_headAlign')) $('f_headAlign').checked = on;
  if ($('row_headDrops')) $('row_headDrops').style.display = on ? '' : 'none';
}

/** Per-dormer width/height rows. Hidden while sizes are linked; when unlinked
 *  each dormer gets its own pair of inputs so one can be wide-and-low and the
 *  other narrow-and-tall. */
function renderDormerSizeRows() {
  const host = $('dormerSizeRows');
  if (!host) return;
  const dim = state.home.dimensions;
  const count = parseInt(dim.dormerCount, 10) || 0;
  const linked = dim.dormerLinkSizes === true;
  // The global width/height only mean anything while the sizes are linked.
  if ($('row_dormerWidth')) $('row_dormerWidth').style.display = linked ? '' : 'none';
  if ($('row_dormerHeight')) $('row_dormerHeight').style.display = linked ? '' : 'none';
  if ($('row_dormerNestOffset')) {
    $('row_dormerNestOffset').style.display = (count === 2 && dim.dormerNested) ? '' : 'none';
  }
  if (linked || count <= 0) {
    host.innerHTML = '';
    host.style.display = 'none';
    return;
  }
  host.style.display = '';
  let html = '';
  for (let i = 0; i < count; i++) {
    const { dW, dH } = dormerSize(dim, i);
    const label = (count === 2 && dim.dormerNested)
      ? (i === 0 ? 'Outer dormer' : 'Inner dormer')
      : `Dormer ${i + 1}`;
    html +=
      `<div class="grid2">` +
      `<label><span>${label} width (ft)</span>` +
      // step 1/12 ft = 1 inch, so the arrows walk the gable an inch at a time.
      `<input type="number" autocomplete="off" step="0.25" min="0.25" max="40" ` +
      `data-dormer-idx="${i}" data-dormer-key="widthFt" value="${roundQuarter(dW)}"></label>` +
      `<label><span>${label} height (ft)</span>` +
      `<input type="number" autocomplete="off" step="0.25" min="0.25" max="20" ` +
      `data-dormer-idx="${i}" data-dormer-key="heightFt" value="${roundQuarter(dH)}"></label>` +
      `</div>`;
  }
  host.innerHTML = html;
}

/** Seed dormerSizes from the current global size so unlinking starts from the
 *  shape already on screen instead of snapping every dormer back to defaults. */
function seedDormerSizes() {
  const dim = state.home.dimensions;
  const count = parseInt(dim.dormerCount, 10) || 0;
  const sizes = Array.isArray(dim.dormerSizes) ? dim.dormerSizes.slice() : [];
  for (let i = 0; i < count; i++) {
    if (!sizes[i]) {
      sizes[i] = { widthFt: dim.dormerWidthFt ?? 10.0, heightFt: dim.dormerHeightFt ?? 4.5 };
    }
  }
  dim.dormerSizes = sizes;
}

function syncForm() {
  $('f_name').value = state.home.name;
  for (const [id, key] of dimFields) {
    if ($(id)) $(id).value = state.home.dimensions[key] ?? '';
  }
  $('f_roofStyle').value = state.home.dimensions.roofStyle;
  if ($('f_dormerCount')) $('f_dormerCount').value = state.home.dimensions.dormerCount ?? 0;
  if ($('f_dormerStyle')) $('f_dormerStyle').value = state.home.dimensions.dormerStyle || 'gable';
  if ($('f_dormerFalseEave')) $('f_dormerFalseEave').checked = state.home.dimensions.dormerFalseEave !== false;
  if ($('f_dormerInnerFalseEave')) $('f_dormerInnerFalseEave').checked = state.home.dimensions.dormerInnerFalseEave !== false;
  if ($('f_dormerConnected')) $('f_dormerConnected').checked = !!state.home.dimensions.dormerConnected;
  if ($('f_dormerDripEdge')) $('f_dormerDripEdge').checked = state.home.dimensions.dormerDripEdge !== false;
  if ($('f_dormerContinuousWall')) $('f_dormerContinuousWall').checked = !!state.home.dimensions.dormerContinuousWall;
  if ($('f_dormerWindow')) $('f_dormerWindow').checked = state.home.dimensions.dormerWindow !== false;
  if ($('f_dormerLinkSizes')) $('f_dormerLinkSizes').checked = state.home.dimensions.dormerLinkSizes === true;
  if ($('f_dormerNested')) $('f_dormerNested').checked = !!state.home.dimensions.dormerNested;
  if ($('f_dormerNestOffset')) $('f_dormerNestOffset').value = state.home.dimensions.dormerNestOffsetFt ?? 0;
  if ($('f_sidingTexture')) $('f_sidingTexture').value = state.home.dimensions.sidingTexture || 'horizontal_lap';
  if ($('f_dormerSidingTexture')) $('f_dormerSidingTexture').value = state.home.dimensions.dormerSidingTexture || state.home.dimensions.sidingTexture || 'horizontal_lap';
  if ($('f_gableSidingTexture')) $('f_gableSidingTexture').value = state.home.dimensions.gableSidingTexture || state.home.dimensions.sidingTexture || 'horizontal_lap';
  if ($('f_cornerTrim')) $('f_cornerTrim').checked = state.home.dimensions.cornerTrim !== false;
  if ($('f_cornerTrimWidth')) $('f_cornerTrimWidth').value = Math.round((state.home.dimensions.cornerTrimWidthFt ?? 0.5) * 12);
  syncHeadAlignRows();
  renderDormerSizeRows();
  for (const [id, key] of colorFields) {
    if ($(id)) $(id).value = state.home.colors[key] || state.home.colors.siding || '#8d9299';
  }
  for (const [id, key] of planFields) $(id).value = state.home.plan[key];
  $('p_op').value = state.home.plan.opacity;
  $('p_show').checked = state.home.plan.show;
  const sp = state.home.sitePhoto || {};
  if ($('sp_fitMode')) $('sp_fitMode').value = sp.fitMode || 'camera';
  for (const [id, key] of photoFields) {
    if ($(id)) $(id).value = sp[key] ?? 0;
  }
  if ($('sp_show')) $('sp_show').checked = sp.show !== false;
  for (const [id, key] of sceneNums) {
    if ($(id)) $(id).value = state.scene[key] ?? 0;
  }
  for (const [id, key] of sceneRanges) {
    if ($(id)) $(id).value = state.scene[key] ?? 0;
  }
  for (const [id, key] of sceneChecks) {
    if ($(id)) $(id).checked = !!state.scene[key];
  }
  if ($('s_stepRailings')) $('s_stepRailings').value = state.scene.stepRailings || 'both';
  if ($('s_stepMat')) $('s_stepMat').value = state.scene.stepMat || 'concrete';
  if ($('s_stepEgress')) $('s_stepEgress').value = state.scene.stepEgress || 'front';
  if ($('s_railMat')) $('s_railMat').value = state.scene.railMat || 'pressure_treated';
  if ($('s_balusterStyle')) $('s_balusterStyle').value = state.scene.balusterStyle || 'balusters';
  if ($('btnWireframe')) $('btnWireframe').classList.toggle('active', !!state.scene.wireframe);
  $('s_bg').value = state.scene.bg;
  $('x_w').value = state.export.w;
  $('x_h').value = state.export.h;
  $('x_alpha').checked = state.export.alpha;
  $('x_burn').checked = state.export.burn;
  for (const [id, key] of briefFields) {
    if ($(id)) $(id).value = state.home.brief?.[key] ?? '';
  }
  if ($('sp_planPage')) $('sp_planPage').value = state.home.sitePlan?.page ?? 1;
  updateSitePlanStatus();
  for (const [id, key] of panoFields) {
    if ($(id)) $(id).value = state.home.panorama?.[key] ?? 0;
  }
  if ($('pn_show')) $('pn_show').checked = state.home.panorama?.show !== false;
  updatePanoStatus();
  renderHomePhotoList();
  renderSlotList();
  renderSiteViewList();
}

/** Swap in a home spec from disk or the library and reframe on it. */
/**
 * Open a project file. A v2 file restores the scene, the export settings and
 * the camera it was saved at; a bare home (the library's homes/*.json, or a file
 * saved before views were stored) still loads and gets the default framing.
 */
function loadProject(raw) {
  const p = readProject(raw);
  state.home = p.home;
  state.scene = p.scene;
  state.export = p.exportOpts;
  selectedId = null;
  selectedIds.clear();
  gizmo.clear();
  syncForm();
  rebuild();
  refreshList();
  updatePlanPlate(stage, state.home.plan);
  updateSitePhotoPlate();

  if (p.view.label) currentViewName = p.view.label;
  // A saved camera wins over the preset — it is the framing the user chose.
  const restored = p.restoredView && stage.applyCameraState(p.view.camera);
  if (restored) {
    // The frustum was rebuilt for the saved aspect; re-apply the live one.
    fit();
  } else {
    // A file with no camera carries no framing intent, so frame it fresh —
    // including after a project whose camera set userMoved.
    stage.userMoved = false;
    stage.setView(p.view.preset || 'hero-left', state.home.dimensions, state.scene);
  }
  updateFramingReadout();
  save();
}

function bind() {
  initAccordions();
  bindPlanReader();
  bindHomePhotos();
  bindPanorama();
  bindSiteViews();
  bindPackage();

  const toggleSidebar = () => {
    const main = $('mainContainer');
    if (!main) return;
    const collapsed = main.classList.toggle('sidebar-collapsed');
    const text = collapsed ? '▶ Show Sidebar' : '◀ Collapse Sidebar';
    if ($('btnToggleSidebar')) $('btnToggleSidebar').textContent = text;
    if ($('btnToggleSidebarTop')) $('btnToggleSidebarTop').textContent = collapsed ? '▶ Sidebar' : '◀ Sidebar';
    
    setTimeout(() => {
      const c = $('view');
      if (c) stage.resize(c.clientWidth, c.clientHeight);
      updateSitePhotoPlate();
    }, 210);
  };

  if ($('btnToggleSidebar')) $('btnToggleSidebar').addEventListener('click', toggleSidebar);
  if ($('btnToggleSidebarTop')) $('btnToggleSidebarTop').addEventListener('click', toggleSidebar);

  $('f_name').addEventListener('input', (e) => { state.home.name = e.target.value; updateHud(); save(); });

  for (const [id, key] of dimFields) {
    $(id).addEventListener('input', (e) => {
      const v = parseFloat(e.target.value);
      if (Number.isNaN(v)) return; // let the field be empty mid-edit
      state.home.dimensions[key] = v;
      rebuild(); syncList();
    });
  }
  $('f_roofStyle').addEventListener('change', (e) => {
    state.home.dimensions.roofStyle = e.target.value;
    rebuild();
  });
  if ($('f_headAlign')) {
    $('f_headAlign').addEventListener('change', (e) => {
      state.home.dimensions.headAlign = e.target.checked;
      syncHeadAlignRows();
      rebuild(); syncList(); save();
    });
  }
  if ($('f_dormerCount')) {
    $('f_dormerCount').addEventListener('change', (e) => {
      state.home.dimensions.dormerCount = parseInt(e.target.value, 10) || 0;
      if (state.home.dimensions.dormerLinkSizes === false) seedDormerSizes();
      renderDormerSizeRows();
      rebuild(); save();
    });
  }
  if ($('f_dormerLinkSizes')) {
    $('f_dormerLinkSizes').addEventListener('change', (e) => {
      state.home.dimensions.dormerLinkSizes = e.target.checked;
      if (!e.target.checked) seedDormerSizes();
      renderDormerSizeRows();
      rebuild(); save();
    });
  }
  if ($('dormerSizeRows')) {
    $('dormerSizeRows').addEventListener('input', (e) => {
      const idx = parseInt(e.target.dataset.dormerIdx ?? '', 10);
      const key = e.target.dataset.dormerKey;
      if (Number.isNaN(idx) || !key) return;
      const v = parseFloat(e.target.value);
      if (!Number.isFinite(v) || v <= 0) return; // let the field be empty mid-edit
      seedDormerSizes();
      state.home.dimensions.dormerSizes[idx] = { ...state.home.dimensions.dormerSizes[idx], [key]: v };
      rebuild(); save();
    });
  }
  if ($('f_dormerStyle')) {
    $('f_dormerStyle').addEventListener('change', (e) => {
      state.home.dimensions.dormerStyle = e.target.value;
      rebuild(); save();
    });
  }
  if ($('f_dormerFalseEave')) {
    $('f_dormerFalseEave').addEventListener('change', (e) => {
      state.home.dimensions.dormerFalseEave = e.target.checked;
      rebuild(); save();
    });
  }
  if ($('f_dormerInnerFalseEave')) {
    $('f_dormerInnerFalseEave').addEventListener('change', (e) => {
      state.home.dimensions.dormerInnerFalseEave = e.target.checked;
      rebuild(); save();
    });
  }
  if ($('f_dormerDripEdge')) {
    $('f_dormerDripEdge').addEventListener('change', (e) => {
      state.home.dimensions.dormerDripEdge = e.target.checked;
      rebuild(); save();
    });
  }
  if ($('f_dormerContinuousWall')) {
    $('f_dormerContinuousWall').addEventListener('change', (e) => {
      state.home.dimensions.dormerContinuousWall = e.target.checked;
      rebuild(); save();
    });
  }
  if ($('f_dormerConnected')) {
    $('f_dormerConnected').addEventListener('change', (e) => {
      state.home.dimensions.dormerConnected = e.target.checked;
      if (e.target.checked && $('f_dormerNested')) {
        state.home.dimensions.dormerNested = false;
        $('f_dormerNested').checked = false;
      }
      renderDormerSizeRows();
      rebuild(); save();
    });
  }
  if ($('f_dormerNested')) {
    $('f_dormerNested').addEventListener('change', (e) => {
      state.home.dimensions.dormerNested = e.target.checked;
      if (e.target.checked) {
        // Nested and connected are mutually exclusive arrangements.
        state.home.dimensions.dormerConnected = false;
        if ($('f_dormerConnected')) $('f_dormerConnected').checked = false;
        seedDormerSizes();
        // Give the inner gable a visibly smaller default so the nesting reads.
        const sizes = state.home.dimensions.dormerSizes;
        if (sizes[1] && sizes[0] && sizes[1].widthFt >= sizes[0].widthFt) {
          sizes[1] = { widthFt: sizes[0].widthFt * 0.55, heightFt: sizes[0].heightFt * 0.7 };
        }
      }
      renderDormerSizeRows();
      rebuild(); save();
    });
  }
  if ($('f_dormerNestOffset')) {
    $('f_dormerNestOffset').addEventListener('input', (e) => {
      const v = parseFloat(e.target.value);
      if (!Number.isFinite(v)) return;
      state.home.dimensions.dormerNestOffsetFt = v;
      rebuild(); save();
    });
  }
  if ($('f_dormerWindow')) {
    $('f_dormerWindow').addEventListener('change', (e) => {
      state.home.dimensions.dormerWindow = e.target.checked;
      rebuild(); save();
    });
  }
  if ($('btnResetDormerPos')) {
    $('btnResetDormerPos').addEventListener('click', () => {
      state.home.dimensions.dormerPositions = [];
      rebuild(); save();
    });
  }
  if ($('f_sidingTexture')) {
    $('f_sidingTexture').addEventListener('change', (e) => {
      state.home.dimensions.sidingTexture = e.target.value;
      rebuild(); save();
    });
  }
  if ($('f_dormerSidingTexture')) {
    $('f_dormerSidingTexture').addEventListener('change', (e) => {
      state.home.dimensions.dormerSidingTexture = e.target.value;
      rebuild(); save();
    });
  }
  if ($('f_gableSidingTexture')) {
    $('f_gableSidingTexture').addEventListener('change', (e) => {
      state.home.dimensions.gableSidingTexture = e.target.value;
      rebuild(); save();
    });
  }
  if ($('f_cornerTrim')) {
    $('f_cornerTrim').addEventListener('change', (e) => {
      state.home.dimensions.cornerTrim = e.target.checked;
      rebuild(); save();
    });
  }
  if ($('f_cornerTrimWidth')) {
    $('f_cornerTrimWidth').addEventListener('input', (e) => {
      const inch = parseFloat(e.target.value);
      if (Number.isNaN(inch) || inch <= 0) return;
      state.home.dimensions.cornerTrimWidthFt = inch / 12;
      rebuild(); save();
    });
  }
  for (const [id, key] of colorFields) {
    $(id).addEventListener('input', (e) => { state.home.colors[key] = e.target.value; rebuild(); });
  }

  for (const [id, key] of planFields) {
    $(id).addEventListener('change', (e) => {
      state.home.plan[key] = parseFloat(e.target.value) || 0;
      updatePlanPlate(stage, state.home.plan); save();
    });
  }
  $('p_op').addEventListener('input', (e) => {
    state.home.plan.opacity = parseFloat(e.target.value);
    updatePlanPlate(stage, state.home.plan); save();
  });
  $('p_show').addEventListener('change', (e) => {
    state.home.plan.show = e.target.checked;
    updatePlanPlate(stage, state.home.plan); save();
  });
  $('filePlan').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      state.home.plan.src = r.result;
      state.home.plan.show = true;
      $('p_show').checked = true;
      updatePlanPlate(stage, state.home.plan);
      save();
    };
    r.readAsDataURL(f);
  });

  function setPhotoDragMode(active) {
    const badge = $('photoDragBadge');
    if (active) {
      stage.controls.enabled = false;
      stage.orthoControls.enabled = false;
      canvas.style.cursor = 'grab';
      if (badge) badge.style.display = 'block';
    } else {
      stage.controls.enabled = stage.camera !== stage.ortho;
      stage.orthoControls.enabled = stage.camera === stage.ortho;
      canvas.style.cursor = '';
      if (badge) badge.style.display = 'none';
    }
  }

  if ($('sp_dragMode')) {
    $('sp_dragMode').addEventListener('change', (e) => {
      setPhotoDragMode(e.target.checked);
    });
  }

  canvas.addEventListener('wheel', (ev) => {
    const isPhotoDrag = $('sp_dragMode')?.checked || ev.shiftKey;
    if (isPhotoDrag && state.home.sitePhoto?.show && state.home.sitePhoto?.src) {
      ev.preventDefault();
      const sp = state.home.sitePhoto;
      const delta = ev.deltaY < 0 ? 0.05 : -0.05;
      sp.scale = Math.max(0.2, Math.min(5.0, Math.round(((sp.scale || 1.0) + delta) * 100) / 100));
      if ($('sp_scale')) $('sp_scale').value = sp.scale;
      updateSitePhotoPlate();
      save();
    }
  }, { passive: false });
  for (const [id, key] of photoFields) {
    if ($(id)) {
      $(id).addEventListener('input', (e) => {
        state.home.sitePhoto[key] = parseFloat(e.target.value) || 0;
        rebuild();
      });
    }
  }
  if ($('sp_show')) {
    $('sp_show').addEventListener('change', (e) => {
      state.home.sitePhoto.show = e.target.checked;
      rebuild();
    });
  }
  if ($('fileSitePhoto')) {
    $('fileSitePhoto').addEventListener('change', (e) => {
      const f = e.target.files[0];
      if (!f) return;
      downscaleImage(f, 1600, 0.85).then((dataUrl) => {
        state.home.sitePhoto.src = dataUrl;
        state.home.sitePhoto.show = true;
        if ($('sp_show')) $('sp_show').checked = true;
        rebuild();
      }).catch(() => {
        alert('Could not read that image.');
      });
    });
  }
  if ($('btnResetPhoto')) {
    $('btnResetPhoto').addEventListener('click', () => {
      state.home.sitePhoto = {
        ...state.home.sitePhoto,
        fitMode: 'camera', scale: 1.0, panX: 0, panY: 0, rotation: 0, baselineY: 0, camDist: 60, posX: 0, posZ: 0, rotY: 0, show: true
      };
      syncForm();
      rebuild();
    });
  }

  function syncCameraStateToForm() {
    const cam = stage.camera;
    let changed = false;

    // 1. Camera Distance — only meaningful for the perspective camera; an
    // ortho-view change must not stomp the site-photo distance with a
    // reading taken from the untouched persp camera.
    if (cam === stage.persp) {
      const dist = Math.round(stage.getCameraDistance() * 10) / 10;
      if (dist !== state.home.sitePhoto.camDist) {
        state.home.sitePhoto.camDist = dist;
        changed = true;
      }
      if ($('sp_camDist') && document.activeElement !== $('sp_camDist')) {
        $('sp_camDist').value = dist;
      }
    }

    // 2. Eye height
    const eyeY = Math.round(cam.position.y * 10) / 10;
    if (eyeY !== state.scene.eye) {
      state.scene.eye = eyeY;
      changed = true;
    }
    if ($('s_eye') && document.activeElement !== $('s_eye')) {
      $('s_eye').value = eyeY;
    }

    updateHud();
    updateFramingReadout();
    // Orbiting IS the alignment work for a site view, so the active one takes
    // the new camera even when nothing else about the state changed.
    syncActiveSiteView();
    // OrbitControls damping keeps firing 'change' for as long as the camera is
    // easing, so saving unconditionally here wrote to localStorage several times
    // a second and, once history existed, filled the undo stack with camera drift.
    if (changed) save();
  }

  stage.controls.addEventListener('change', syncCameraStateToForm);
  stage.orthoControls.addEventListener('change', syncCameraStateToForm);

  for (const [id, key] of [...sceneNums, ...sceneRanges]) {
    if ($(id)) {
      $(id).addEventListener('input', (e) => {
        state.scene[key] = parseFloat(e.target.value);
        if (key === 'landingDepthFt') rebuild();
        else stage.applySceneOpts(state.scene, state.home.dimensions);
        if ((key === 'focal' || key === 'eye') && stage._lastView) {
          stage.setView(stage._lastView, state.home.dimensions, state.scene);
        }
        save();
      });
    }
  }
  for (const [id, key] of sceneChecks) {
    if ($(id)) {
      $(id).addEventListener('change', (e) => {
        state.scene[key] = e.target.checked;
        if (['steps', 'stepLanding', 'labels', 'dims'].includes(key)) rebuild();
        else { stage.applySceneOpts(state.scene, state.home.dimensions); save(); }
      });
    }
  }
  if ($('s_stepRailings')) {
    $('s_stepRailings').addEventListener('change', (e) => {
      state.scene.stepRailings = e.target.value;
      rebuild();
    });
  }
  if ($('s_stepMat')) {
    $('s_stepMat').addEventListener('change', (e) => {
      state.scene.stepMat = e.target.value;
      rebuild();
    });
  }
  if ($('s_stepEgress')) {
    $('s_stepEgress').addEventListener('change', (e) => {
      state.scene.stepEgress = e.target.value;
      rebuild();
    });
  }
  if ($('s_railMat')) {
    $('s_railMat').addEventListener('change', (e) => {
      state.scene.railMat = e.target.value;
      rebuild();
    });
  }
  if ($('s_balusterStyle')) {
    $('s_balusterStyle').addEventListener('change', (e) => {
      state.scene.balusterStyle = e.target.value;
      rebuild();
    });
  }
  $('s_bg').addEventListener('input', (e) => {
    state.scene.bg = e.target.value;
    stage.applySceneOpts(state.scene, state.home.dimensions);
    syncStageBackdrop();
    save();
  });

  for (const [id, key] of [['x_w', 'w'], ['x_h', 'h']]) {
    $(id).addEventListener('change', (e) => { state.export[key] = parseInt(e.target.value, 10) || 1200; save(); });
  }
  $('x_alpha').addEventListener('change', (e) => { state.export.alpha = e.target.checked; save(); });
  $('x_burn').addEventListener('change', (e) => { state.export.burn = e.target.checked; save(); });

  $('btnAddDoor').addEventListener('click', () => armAdd('door'));
  $('btnAddSlider').addEventListener('click', () => armAdd('slider'));
  $('btnAddWindow').addEventListener('click', () => armAdd('window'));

  if ($('btnRotL90')) {
    $('btnRotL90').addEventListener('click', () => stage.rotateView(-90));
  }
  if ($('btnRotR90')) {
    $('btnRotR90').addEventListener('click', () => stage.rotateView(90));
  }
  if ($('btnWireframe')) {
    $('btnWireframe').addEventListener('click', () => {
      state.scene.wireframe = !state.scene.wireframe;
      if ($('s_wireframe')) $('s_wireframe').checked = state.scene.wireframe;
      $('btnWireframe').classList.toggle('active', state.scene.wireframe);
      stage.setWireframe(state.scene.wireframe);
      save();
    });
  }

  for (const b of document.querySelectorAll('#viewPresets button')) {
    b.addEventListener('click', () => {
      stage.setView(b.dataset.view, state.home.dimensions, state.scene);
      currentViewName = b.textContent.trim();
      updateFramingReadout();
    });
  }

  // Home library: homes/index.json lists the JSON specs sitting next to it.
  fetch('homes/index.json')
    .then((r) => (r.ok ? r.json() : []))
    .then((list) => {
      for (const item of list) {
        const opt = document.createElement('option');
        opt.value = item.file;
        opt.textContent = item.name || item.file;
        $('library').appendChild(opt);
      }
    })
    .catch(() => { /* opened without a server, or no library — the file picker still works */ });

  $('library').addEventListener('change', async (e) => {
    const file = e.target.value;
    if (!file) return;
    try {
      const res = await fetch(`homes/${file}`);
      if (!res.ok) throw new Error(res.statusText);
      loadProject(await res.json());
    } catch (err) {
      alert(`Could not load homes/${file}: ${err.message}`);
    }
  });

  const dlgAiKeys = $('dlgAiKeys');
  if ($('btnAiSettings') && dlgAiKeys) {
    $('btnAiSettings').addEventListener('click', () => {
      const keys = loadApiKeys();
      if ($('selAiProvider')) $('selAiProvider').value = keys.activeProvider || 'anthropic';
      if ($('key_anthropic')) $('key_anthropic').value = keys.anthropic || '';
      if ($('key_openai')) $('key_openai').value = keys.openai || '';
      if ($('key_grok')) $('key_grok').value = keys.grok || '';
      if ($('key_gemini')) $('key_gemini').value = keys.gemini || '';
      if ($('chkPersistKeys')) $('chkPersistKeys').checked = isPersisted();
      dlgAiKeys.showModal();
    });
  }
  if ($('btnCloseAiKeys') && dlgAiKeys) {
    $('btnCloseAiKeys').addEventListener('click', () => dlgAiKeys.close());
  }
  if ($('btnSaveAiKeys') && dlgAiKeys) {
    $('btnSaveAiKeys').addEventListener('click', () => {
      const keys = {
        activeProvider: $('selAiProvider')?.value || 'anthropic',
        anthropic: $('key_anthropic')?.value?.trim() || '',
        openai: $('key_openai')?.value?.trim() || '',
        grok: $('key_grok')?.value?.trim() || '',
        gemini: $('key_gemini')?.value?.trim() || '',
      };
      saveApiKeys(keys, $('chkPersistKeys')?.checked);
      dlgAiKeys.close();
    });
  }

  $('btnNew').addEventListener('click', () => {
    if (!confirm('Discard the current home and start a new one?')) return;
    state.home = defaultHome();
    selectedId = null;
    selectedIds.clear();
    gizmo.clear();
    syncForm(); rebuild(); refreshList();
    updatePlanPlate(stage, state.home.plan);
    stage.setView('hero-left', state.home.dimensions, state.scene);
  });

  $('btnSave').addEventListener('click', async () => {
    const project = buildProject({
      home: state.home,
      scene: state.scene,
      exportOpts: state.export,
      view: { preset: stage._lastView || null, label: currentViewName, camera: stage.cameraState() },
      savedAt: new Date().toISOString(),
    });
    const filename = `${(state.home.name || 'home').replace(/[^\w-]+/g, '_')}.json`;
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
    const saved = await saveWithPicker(blob, filename, 'SiteMassing3D Project File', 'application/json', '.json');
    if (!saved) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }
  });

  $('fileHome').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        loadProject(JSON.parse(r.result));
      } catch (err) {
        alert(`Could not read that JSON: ${err.message}`);
      }
    };
    r.readAsText(f);
    e.target.value = '';
  });

  // An elevation is far wider than it is tall; a 3:2 export wastes most of the
  // frame on sky. This retargets the pixel height to the subject's proportions.
  $('btnFitPx').addEventListener('click', () => {
    // A PNG always frames exactly what is on screen, so the only height a
    // screenshot can deliver is the one the live viewport's aspect implies.
    // This button just fills that number in; the contact sheet still uses it.
    const dom = stage.renderer.domElement;
    const ratio = dom.width > 0 ? dom.height / dom.width : 0.62;
    state.export.h = Math.max(240, Math.round(state.export.w * ratio));
    $('x_h').value = state.export.h;
    save();
  });

  const doShot = () => {
    const c = shoot(stage, state.home, state.scene, state.export, currentViewName);
    // shoot() locks the height to the live aspect so the PNG frames exactly what
    // is on screen — show the user the height they actually got.
    if (c) { state.export.h = c.height; $('x_h').value = c.height; save(); }
    updateSitePhotoPlate();
  };
  $('btnShot').addEventListener('click', doShot);
  $('btnShot2').addEventListener('click', doShot);
  $('btnSheet').addEventListener('click', () => {
    contactSheet(stage, state.home, state.scene, state.export);
    updateSitePhotoPlate();
  });

  canvas.addEventListener('pointerdown', onPick);
  // Move/up live on the window so a drag survives the pointer leaving the canvas.
  addEventListener('pointermove', onMove);
  addEventListener('pointerup', onUp);
  if ($('btnUndo')) $('btnUndo').addEventListener('click', doUndo);
  if ($('btnRedo')) $('btnRedo').addEventListener('click', doRedo);

  addEventListener('keydown', (e) => {
    // Ctrl/Cmd+Z and Ctrl+Shift+Z (or Ctrl+Y) drive the project history. Text
    // fields keep their own undo — retyping a label should not roll the model
    // back — but number fields and selects belong to the model, so they don't.
    if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z' || e.key === 'y' || e.key === 'Y')) {
      const inText = e.target instanceof HTMLInputElement && e.target.type === 'text';
      if (!inText) {
        e.preventDefault();
        const redo = e.key === 'y' || e.key === 'Y' || e.shiftKey;
        if (redo) doRedo(); else doUndo();
        return;
      }
    }
    // [ and ] cycle the saved site views, but not while a field has focus —
    // they are printable characters.
    if ((e.key === '[' || e.key === ']') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const typing = e.target instanceof HTMLInputElement
        || e.target instanceof HTMLTextAreaElement
        || e.target instanceof HTMLSelectElement;
      if (!typing) {
        e.preventDefault();
        cycleSiteViews(e.key === ']' ? 1 : -1);
        return;
      }
    }
    if (e.key === 'Escape') { pendingAdd = null; canvas.style.cursor = ''; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.size && e.target === document.body) {
      state.home.openings = state.home.openings.filter((o) => !selectedIds.has(o.id));
      clearSelection(); rebuild(); save();
    }
    // Ctrl/Cmd+A selects every opening for a whole-house edit.
    if ((e.key === 'a' || e.key === 'A') && (e.ctrlKey || e.metaKey) && e.target === document.body) {
      e.preventDefault();
      selectedIds = new Set(state.home.openings.map((o) => o.id));
      selectedId = selectedId && selectedIds.has(selectedId) ? selectedId : (state.home.openings[0]?.id ?? null);
      showGizmo(); refreshList();
    }
  });
}

let currentViewName = '¾ front-L';

function armAdd(type) {
  pendingAdd = type;
  canvas.style.cursor = 'crosshair';
}

// ---------------------------------------------------------------------------
// Picking
// ---------------------------------------------------------------------------

const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let drag = null;
let dormerDrag = null;  // { index, startX, startPosX }

function setRay(ev) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, stage.camera);
}

const findOpeningId = (obj) => {
  for (let o = obj; o; o = o.parent) if (o.userData?.opening) return o.userData.opening;
  return null;
};

const findDormerIndex = (obj) => {
  for (let o = obj; o; o = o.parent) {
    if (o.userData?.dormerIndex !== undefined) return o.userData.dormerIndex;
  }
  return null;
};

let photoDrag = null;

function onPick(ev) {
  const isPhotoDrag = $('sp_dragMode')?.checked || (ev.shiftKey && state.home.sitePhoto?.show && state.home.sitePhoto?.src);
  if (isPhotoDrag) {
    photoDrag = {
      startX: ev.clientX,
      startY: ev.clientY,
      startPanX: state.home.sitePhoto.panX ?? 0,
      startPanY: state.home.sitePhoto.panY ?? 0,
      startRot: state.home.sitePhoto.rotation ?? 0,
      button: ev.button,
    };
    stage.controls.enabled = false;
    stage.orthoControls.enabled = false;
    canvas.style.cursor = 'grabbing';
    ev.preventDefault();
    return;
  }

  if (ev.button !== 0) return;
  setRay(ev);

  // Dormer picking — check before opening picks so dormers can be dragged.
  if (!pendingAdd) {
    const dormerHits = ray.intersectObjects(stage.homeGroup.children, true);
    const dormerIdx = dormerHits.map((h) => findDormerIndex(h.object)).find((v) => v !== null);
    if (dormerIdx !== null && dormerIdx !== undefined) {
      const dim = state.home.dimensions;
      const count = parseInt(dim.dormerCount, 10) || 0;
      if (count > 0) {
        // Initialise positions array from auto-positions if empty
        if (!Array.isArray(dim.dormerPositions) || dim.dormerPositions.length !== count) {
          dim.dormerPositions = count === 1 ? [0] : [-dim.lengthFt * 0.25, dim.lengthFt * 0.25];
        }
        // In nested mode the inner gable rides the outer one, so dragging it
        // moves its nest offset rather than its own ridge position.
        const nestedInner = count === 2 && dim.dormerNested && dormerIdx === 1;
        dormerDrag = {
          index: dormerIdx,
          nestedInner,
          startClientX: ev.clientX,
          startPosX: nestedInner ? (+dim.dormerNestOffsetFt || 0) : dim.dormerPositions[dormerIdx],
        };
        stage.controls.enabled = false;
        stage.orthoControls.enabled = false;
        canvas.style.cursor = 'grabbing';
        ev.preventDefault();
        return;
      }
    }
  }

  const planPick = $('p_pick').checked;

  if (planPick) {
    const hits = ray.intersectObjects(stage.planGroup.children, true);
    if (hits.length) {
      const hit = nearestWallHit(hits[0].point, state.home.dimensions);
      addOpening(pendingAdd || 'door', hit.wall, hit.offsetFt, null);
      return;
    }
  }

  const hits = ray.intersectObjects(stage.homeGroup.children, true);

  if (pendingAdd) {
    const wallHit = hits.find((h) => h.object.userData.wall);
    if (!wallHit) return;
    const wall = wallHit.object.userData.wall;
    const f = wallFrames(state.home.dimensions)[wall];
    const rel = wallHit.point.clone().sub(f.origin);
    addOpening(pendingAdd, wall, rel.dot(f.right), rel.y);
    return;
  }

  // Resize handle takes priority over the geometry behind it.
  const mode = gizmo.pick(ray);
  const sel = state.home.openings.find((o) => o.id === selectedId);
  if (mode && sel) return beginDrag(sel, mode);

  const hitId = hits.map((h) => findOpeningId(h.object)).find(Boolean);
  if (hitId) {
    const o = state.home.openings.find((x) => x.id === hitId);
    // Ctrl/Cmd extends the selection. Shift is reserved for the axis lock and
    // the site-photo drag, so it is not a modifier here.
    const additive = ev.ctrlKey || ev.metaKey;
    select(hitId, additive ? 'toggle' : (selectedIds.has(hitId) ? 'anchor' : 'replace'));
    scrollToSelected();
    if (additive) return; // building a selection, not moving it
    return beginDrag(o, 'move');
  }

  if (selectedIds.size) clearSelection();
}

function beginDrag(o, mode) {
  const hit = wallPlaneHit(ray, o.wall, state.home.dimensions, stage.homeGroup);
  if (!hit) return;
  // Every selected unit rides the same (du, dv) travel, each from its own start.
  const group = selectedIds.has(o.id) && selectedIds.size > 1 ? selectedOpenings() : [o];
  drag = {
    id: o.id,
    mode,
    origin: hit,
    starts: group.map((u) => [u.id, { offsetFt: u.offsetFt, widthFt: u.widthFt, heightFt: u.heightFt, sillFt: u.sillFt }]),
  };
  stage.controls.enabled = false;
  stage.orthoControls.enabled = false;
  canvas.style.cursor = mode === 'move' ? 'grabbing' : 'crosshair';
}

function onMove(ev) {
  // Dormer drag — project screen-space delta onto the world X axis.
  if (dormerDrag) {
    const dim = state.home.dimensions;
    const { dW } = dormerSize(dim, dormerDrag.index);
    const halfL = dim.lengthFt / 2 - dW / 2 - 1; // keep dormer inside the building
    // Approximate world-space feet per pixel from camera distance.
    const r = canvas.getBoundingClientRect();
    const camDist = stage.getCameraDistance();
    const ftPerPx = (camDist * 2 * Math.tan(THREE.MathUtils.degToRad(stage.persp.fov / 2))) / r.height;
    const screenDx = (ev.clientX - dormerDrag.startClientX) * ftPerPx;
    // Use the camera's right vector to determine the world-X sign so the
    // drag direction matches the cursor regardless of camera angle.
    const camRight = new THREE.Vector3();
    stage.camera.getWorldDirection(camRight);
    camRight.cross(stage.camera.up).normalize();
    const dx = screenDx * Math.sign(camRight.x || 1);
    if (dormerDrag.nestedInner) {
      const outerW = dormerSize(dim, 0).dW;
      const lim = Math.max(0, (outerW - dW) / 2 - 0.5);
      const v = Math.max(-lim, Math.min(lim, dormerDrag.startPosX + dx));
      dim.dormerNestOffsetFt = roundQuarter(v);
      if ($('f_dormerNestOffset')) $('f_dormerNestOffset').value = dim.dormerNestOffsetFt;
      queueRebuild();
      return;
    }
    const newX = Math.max(-halfL, Math.min(halfL, dormerDrag.startPosX + dx));
    dim.dormerPositions[dormerDrag.index] = roundQuarter(newX); // snap to 3 in
    queueRebuild();
    return;
  }

  if (photoDrag) {
    const r = canvas.getBoundingClientRect();
    const dx = ev.clientX - photoDrag.startX;
    const dy = ev.clientY - photoDrag.startY;
    const sp = state.home.sitePhoto;

    if (photoDrag.button === 0 && !ev.altKey) {
      const percentX = (dx / r.height) * 100;
      const percentY = (dy / r.height) * 100;
      sp.panX = Math.round((photoDrag.startPanX + percentX) * 10) / 10;
      sp.panY = Math.round((photoDrag.startPanY + percentY) * 10) / 10;
      if ($('sp_panX')) $('sp_panX').value = sp.panX;
      if ($('sp_panY')) $('sp_panY').value = sp.panY;
    } else if (photoDrag.button === 2 || ev.altKey) {
      sp.rotation = Math.round((photoDrag.startRot + dx * 0.5) % 360);
      if ($('sp_rot')) $('sp_rot').value = sp.rotation;
    }
    updateSitePhotoPlate();
    save();
    return;
  }

  if (!drag) {
    if (!selectedId || ev.target !== canvas) return;
    setRay(ev);
    const mode = gizmo.pick(ray);
    gizmo.highlight(mode);
    if (mode) canvas.style.cursor = (mode === 'left' || mode === 'right') ? 'ew-resize' : 'ns-resize';
    else if (!pendingAdd && !$('sp_dragMode')?.checked) canvas.style.cursor = '';
    return;
  }

  const o = state.home.openings.find((x) => x.id === drag.id);
  if (!o) return;
  setRay(ev);
  const hit = wallPlaneHit(ray, o.wall, state.home.dimensions, stage.homeGroup);
  if (!hit) return;

  let du = hit.u - drag.origin.u;
  let dv = hit.v - drag.origin.v;
  // Shift locks the drag to the dominant axis; Alt turns off the 1" snap.
  if (ev.shiftKey && !photoDrag) { if (Math.abs(du) >= Math.abs(dv)) dv = 0; else du = 0; }

  for (const [id, start] of drag.starts) {
    const u = state.home.openings.find((x) => x.id === id);
    if (!u) continue;
    applyDrag(u, drag.mode, start, { du, dv }, state.home.dimensions, ev.altKey);
    clampOpening(u, state.home.dimensions);
  }
  queueRebuild();
}

function onUp() {
  if (dormerDrag) {
    dormerDrag = null;
    stage.controls.enabled = stage.camera !== stage.ortho;
    stage.orthoControls.enabled = stage.camera === stage.ortho;
    canvas.style.cursor = '';
    rebuild();
    save();
    return;
  }

  if (photoDrag) {
    photoDrag = null;
    if ($('sp_dragMode')?.checked) {
      canvas.style.cursor = 'grab';
    } else {
      stage.controls.enabled = stage.camera !== stage.ortho;
      stage.orthoControls.enabled = stage.camera === stage.ortho;
      canvas.style.cursor = '';
    }
    save();
    return;
  }

  if (!drag) return;
  drag = null;
  stage.controls.enabled = stage.camera !== stage.ortho;
  stage.orthoControls.enabled = stage.camera === stage.ortho;
  canvas.style.cursor = '';
  syncList();
  save();
}

let rebuildQueued = false;
function queueRebuild() {
  if (rebuildQueued) return;
  rebuildQueued = true;
  requestAnimationFrame(() => {
    rebuildQueued = false;
    rebuild();
    syncList();
  });
}

function scrollToSelected() {
  const el = document.querySelector('.opening.sel');
  el?.scrollIntoView({ block: 'nearest' });
}

function addOpening(type, wall, u, v) {
  const p = OPENING_PRESETS[type];
  const o = {
    id: nextId(type[0]),
    type,
    wall,
    offsetFt: Math.max(0, u - p.widthFt / 2),
    widthFt: p.widthFt,
    heightFt: p.heightFt,
    sillFt: type === 'window' && v != null ? Math.max(0, v - p.heightFt / 2) : p.sillFt,
    label: p.label,
  };
  clampOpening(o, state.home.dimensions);
  state.home.openings.push(o);
  selectedId = o.id;
  selectedIds = new Set([o.id]);
  pendingAdd = null;
  canvas.style.cursor = '';
  rebuild();
  refreshList();
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------



let warnedQuota = false;

// ---------------------------------------------------------------------------
// Undo / redo
// ---------------------------------------------------------------------------

const history = new History({ limit: 80, coalesceMs: 600 });

/**
 * Image data URLs are megabytes each, so they never go into a snapshot. The pool
 * holds one copy of every distinct plan / site-photo image and the snapshot
 * carries its key; entries no longer reachable from the stack are dropped.
 */
const imagePool = new Map();
let imageSeq = 0;

function poolKey(src) {
  if (!src) return null;
  for (const [key, value] of imagePool) if (value === src) return key;
  const key = `img${++imageSeq}`;
  imagePool.set(key, src);
  return key;
}

function pruneImagePool() {
  const live = new Set();
  for (const snap of history.snapshots()) {
    if (snap.home?.plan?.srcKey) live.add(snap.home.plan.srcKey);
    if (snap.home?.sitePhoto?.srcKey) live.add(snap.home.sitePhoto.srcKey);
    for (const v of snap.home?.siteViews || []) {
      if (v?.photo?.srcKey) live.add(v.photo.srcKey);
    }
    if (snap.home?.panorama?.srcKey) live.add(snap.home.panorama.srcKey);
    for (const p of Object.values(snap.home?.homePhotos || {})) {
      if (p?.srcKey) live.add(p.srcKey);
    }
  }
  if (state.home.panorama?.src) live.add(poolKey(state.home.panorama.src));
  for (const p of Object.values(state.home.homePhotos || {})) {
    if (p?.src) live.add(poolKey(p.src));
  }
  if (state.home.plan?.src) live.add(poolKey(state.home.plan.src));
  if (state.home.sitePhoto?.src) live.add(poolKey(state.home.sitePhoto.src));
  for (const v of state.home.siteViews || []) {
    if (v.photo?.src) live.add(poolKey(v.photo.src));
  }
  for (const key of [...imagePool.keys()]) if (!live.has(key)) imagePool.delete(key);
}

/** Project state worth undoing: the home and the scene, images held by key. */
function snapshotState() {
  const home = { ...state.home };
  home.plan = { ...home.plan, src: undefined, srcKey: poolKey(home.plan?.src) };
  // camDist and scene.eye are readings taken off the live camera, so orbiting
  // would otherwise queue undo steps. Where the camera is pointing is
  // navigation; undo should not drag it back.
  home.sitePhoto = { ...home.sitePhoto, src: undefined, camDist: undefined, srcKey: poolKey(home.sitePhoto?.src) };
  // The site plan is an attachment, not a modelling decision — undo should not
  // put a previous PDF page back, and its megabytes have no business on the stack.
  home.sitePlan = { ...home.sitePlan, src: undefined, pdf: undefined };
  // Each saved site view carries its own lot photo. Same rule as the live one:
  // the photo goes to the pool and the snapshot keeps only its key, or a
  // four-view site would put four full-size images on every undo step.
  home.siteViews = (home.siteViews || []).map((v) => ({
    ...v,
    photo: { ...v.photo, src: undefined, srcKey: poolKey(v.photo?.src) },
  }));
  home.panorama = { ...home.panorama, src: undefined, srcKey: poolKey(home.panorama?.src) };
  home.homePhotos = Object.fromEntries(
    Object.entries(home.homePhotos || {}).map(([k, p]) => [k, { name: p.name, srcKey: poolKey(p.src) }]),
  );
  const scene = { ...state.scene, eye: undefined };
  return JSON.parse(JSON.stringify({ home, scene }));
}

let applyingHistory = false;

function applySnapshot(snap) {
  applyingHistory = true;
  try {
    const home = migrate(snap.home);
    home.plan.src = snap.home.plan?.srcKey ? imagePool.get(snap.home.plan.srcKey) ?? null : null;
    home.sitePhoto.src = snap.home.sitePhoto?.srcKey ? imagePool.get(snap.home.sitePhoto.srcKey) ?? null : null;
    // Carry the camera readings across untouched — they are not part of history.
    home.sitePhoto.camDist = state.home.sitePhoto?.camDist ?? home.sitePhoto.camDist;
    home.sitePlan = { ...home.sitePlan, ...(state.home.sitePlan || {}) };
    // migrate() has already normalised the views; only their pooled photos are
    // missing, and the snapshot's parallel entry carries the key.
    home.siteViews = home.siteViews.map((v, i) => {
      const key = snap.home.siteViews?.[i]?.photo?.srcKey;
      return { ...v, photo: { ...v.photo, src: key ? imagePool.get(key) ?? null : null } };
    });
    const panoKey = snap.home.panorama?.srcKey;
    home.panorama = { ...home.panorama, src: panoKey ? imagePool.get(panoKey) ?? null : null };
    home.homePhotos = Object.fromEntries(
      Object.entries(snap.home.homePhotos || {})
        .map(([k, p]) => [k, { name: p.name || '', src: p.srcKey ? imagePool.get(p.srcKey) ?? null : null }])
        .filter(([, p]) => p.src),
    );
    state.home = home;
    state.scene = { ...defaultScene(), ...snap.scene, eye: state.scene.eye };

    // Keep whatever of the selection still exists after the state swap.
    const ids = new Set(state.home.openings.map((o) => o.id));
    selectedIds = new Set([...selectedIds].filter((id) => ids.has(id)));
    if (!ids.has(selectedId)) selectedId = selectedIds.values().next().value ?? null;

    syncForm();
    rebuild();
    refreshList();
    updatePlanPlate(stage, state.home.plan);
    updateSitePhotoPlate();
  } finally {
    applyingHistory = false;
  }
  save();
  updateHistoryButtons();
}

let historyTimer = null;

/**
 * Every mutation already funnels through save(), so that is where history is
 * taken. It is debounced because a drag calls save() on every frame — only the
 * state the pointer came to rest in is worth an undo step.
 */
function scheduleHistory() {
  if (applyingHistory) return;
  clearTimeout(historyTimer);
  historyTimer = setTimeout(() => {
    const snap = snapshotState();
    const label = describeChange(history.current, snap);
    if (history.record(snap, label)) {
      pruneImagePool();
      updateHistoryButtons();
    }
  }, 350);
}

function updateHistoryButtons() {
  const undo = $('btnUndo'), redo = $('btnRedo');
  if (undo) {
    undo.disabled = !history.canUndo;
    undo.title = history.canUndo ? `Undo ${history.peekUndo()} (Ctrl+Z)` : 'Nothing to undo';
  }
  if (redo) {
    redo.disabled = !history.canRedo;
    redo.title = history.canRedo ? `Redo ${history.peekRedo()} (Ctrl+Shift+Z)` : 'Nothing to redo';
  }
}

function doUndo() {
  clearTimeout(historyTimer);
  const step = history.undo();
  if (step) applySnapshot(step.snapshot);
}

function doRedo() {
  clearTimeout(historyTimer);
  const step = history.redo();
  if (step) applySnapshot(step.snapshot);
}

function save() {
  syncActiveSiteView();
  scheduleHistory();
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch {
    // Plan/site-photo images are data URLs and can blow the quota; drop them
    // from the persisted copy rather than fail the whole save, but tell the
    // user once so the images don't just silently vanish on next reload.
    try {
      const lean = {
        ...state,
        home: {
          ...state.home,
          plan: { ...state.home.plan, src: null },
          sitePhoto: { ...state.home.sitePhoto, src: null },
          sitePlan: { ...state.home.sitePlan, src: null, pdf: null },
          siteViews: state.home.siteViews.map((v) => ({ ...v, photo: { ...v.photo, src: null } })),
          panorama: { ...state.home.panorama, src: null },
          homePhotos: {},
        },
      };
      localStorage.setItem(STORE_KEY, JSON.stringify(lean));
    } catch { /* give up quietly; the JSON export is the real save path */ }
    if (!warnedQuota) {
      warnedQuota = true;
      alert(
        'Browser storage is full, so the images could not be autosaved with this project — '
        + 'the lot photos, the site plan, the panorama and the photos of the home will all be '
        + 'missing after a reload.\n\n'
        + 'This gets easier to hit than it looks: every filled lot-photo slot carries its own '
        + 'full-size image, and the site plan page is another one.\n\n'
        + 'Use "Save JSON" now to keep a complete copy on disk. That file always holds '
        + 'everything; the browser autosave is only a convenience.',
      );
    }
  }
}

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    return {
      home: migrate(s.home || {}),
      scene: { ...defaultScene(), ...(s.scene || {}) },
      export: { ...defaultExport(), ...(s.export || {}) },
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

/**
 * Pan X used to be a percentage of the stage WIDTH; it is now a percentage of
 * the HEIGHT, like pan Y, so a width-only resize cannot slide the photo out of
 * register with the model. Convert a project saved under the old rule once,
 * using the current stage size, which keeps the alignment the user last saw.
 */
function convertPhotoPanBasis() {
  const sp = state.home.sitePhoto;
  if (!sp || sp.panBasis === 'height') return;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (w > 0 && h > 0 && sp.panX) sp.panX = Math.round(sp.panX * (w / h) * 10) / 10;
  sp.panBasis = 'height';
  if ($('sp_panX')) $('sp_panX').value = sp.panX ?? 0;
  updateSitePhotoPlate();
  save();
}

function fit() {
  const p = canvas.parentElement;
  if (!p) return;
  const r = p.getBoundingClientRect();
  if (r.width > 0 && r.height > 0) {
    stage.resize(Math.floor(r.width), Math.floor(r.height));
  }
  updateSitePhotoPlate();
}

syncForm();
bind();
rebuild();
refreshList();
fit();
convertPhotoPanBasis();
updatePlanPlate(stage, state.home.plan);
stage.setView('hero-left', state.home.dimensions, state.scene);
updateFramingReadout();

if (window.ResizeObserver && canvas.parentElement) {
  const ro = new ResizeObserver(fit);
  ro.observe(canvas.parentElement);
}
addEventListener('resize', fit);

// Seed the undo stack once boot has settled — the initial rebuild, the site
// photo pan conversion and the opening view preset all write state, and none of
// them is an edit the user made.
requestAnimationFrame(() => {
  clearTimeout(historyTimer);
  history.reset(snapshotState(), 'opened');
  updateHistoryButtons();
});

// Debug handle: lets you poke at state/stage from the console without a build step.
window.__app = {
  state, stage, rebuild, refreshList, renderToCanvas,
  // Package internals, so a package can be inspected without going through the
  // save dialog: __app.buildPackage().then(p => p.files.map(f => f.name)).
  buildPackage: (options) => withoutViewSync(() => buildRenderPackage({
    stage, state, viewName: currentViewName, options,
    savedAt: new Date().toISOString().slice(0, 10),
    ...packageRenderContext(),
  })),
  siteViews: { add: addSiteView, apply: applySiteViewById, cycle: cycleSiteViews },
  brief: currentBrief,
  framing: () => measureFraming(stage, state.home, currentViewName),
};

(function loop() {
  requestAnimationFrame(loop);
  stage.render();
})();
