// App wiring: state -> geometry -> viewport, plus all the panel controls.

import * as THREE from 'three';
import { Stage } from './scene.js';
import { buildHome, disposeTree, wallFrames, clampOpening, fmtFt, derived, dormerSize } from './build.js';
import { renderOpeningList, syncOpeningValues, initAccordions } from './ui.js';
import { updatePlanPlate, nearestWallHit } from './plan.js';
import { Gizmo, wallPlaneHit, applyDrag } from './gizmo.js';
import { shoot, contactSheet, renderToCanvas } from './capture.js';
import { defaultHome, defaultScene, defaultExport, nextId, OPENING_PRESETS, migrate } from './defaults.js';

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

  stage.applySceneOpts(state.scene, state.home.dimensions);
  showGizmo();
  updateHud();
  updateSitePhotoPlate();
  save();
}

function updateSitePhotoPlate() {
  const bg = $('sitePhotoBg');
  if (!bg) return;
  const sp = state.home.sitePhoto;
  if (!sp || !sp.src || !sp.show || state.scene.blockLandscape) {
    bg.style.display = 'none';
    if (state.scene) stage.scene.background = state.scene.bgVisible === false ? null : new THREE.Color(state.scene.bg);
    return;
  }
  bg.style.display = 'block';
  bg.style.backgroundImage = `url("${sp.src}")`;
  bg.style.opacity = sp.opacity ?? 0.85;
  bg.style.backgroundSize = sp.fitMode || 'contain';
  const scale = sp.scale ?? 1.0;
  const panX = sp.panX ?? 0;
  const panY = sp.panY ?? 0;
  const rot = sp.rotation ?? 0;
  bg.style.transform = `translate(${panX}%, ${panY}%) scale(${scale}) rotate(${rot}deg)`;
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
  if ($('sp_fitMode')) $('sp_fitMode').value = sp.fitMode || 'contain';
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
}

/** Swap in a home spec from disk or the library and reframe on it. */
function loadHome(raw) {
  state.home = migrate(raw);
  selectedId = null;
  selectedIds.clear();
  gizmo.clear();
  syncForm();
  rebuild();
  refreshList();
  updatePlanPlate(stage, state.home.plan);
  if (!stage.userMoved) {
    stage.setView('hero-left', state.home.dimensions, state.scene);
  }
}

function bind() {
  initAccordions();

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
        fitMode: 'contain', scale: 1.0, panX: 0, panY: 0, rotation: 0, baselineY: 0, camDist: 60, posX: 0, posZ: 0, rotY: 0, show: true
      };
      syncForm();
      rebuild();
    });
  }

  function syncCameraStateToForm() {
    const cam = stage.camera;

    // 1. Camera Distance — only meaningful for the perspective camera; an
    // ortho-view change must not stomp the site-photo distance with a
    // reading taken from the untouched persp camera.
    if (cam === stage.persp) {
      const dist = Math.round(stage.getCameraDistance() * 10) / 10;
      state.home.sitePhoto.camDist = dist;
      if ($('sp_camDist') && document.activeElement !== $('sp_camDist')) {
        $('sp_camDist').value = dist;
      }
    }

    // 2. Eye height
    const eyeY = Math.round(cam.position.y * 10) / 10;
    state.scene.eye = eyeY;
    if ($('s_eye') && document.activeElement !== $('s_eye')) {
      $('s_eye').value = eyeY;
    }

    updateHud();
    save();
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
      loadHome(await res.json());
    } catch (err) {
      alert(`Could not load homes/${file}: ${err.message}`);
    }
  });

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

  $('btnSave').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state.home, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(state.home.name || 'home').replace(/[^\w-]+/g, '_')}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  });

  $('fileHome').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        loadHome(JSON.parse(r.result));
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
    const fit = stage._orthoFit;
    let ratio;
    if (stage.camera === stage.ortho && fit) {
      ratio = fit.h / fit.w;
    } else {
      const d = state.home.dimensions;
      ratio = 0.62; // three-quarter views read well near 8:5
      if (d.lengthFt > 0) ratio = Math.max(0.5, Math.min(0.75, (derived(d).ridgeY * 2.4) / d.lengthFt));
    }
    state.export.h = Math.max(240, Math.round((state.export.w * ratio) / 16) * 16);
    $('x_h').value = state.export.h;
    save();
  });

  const doShot = () => {
    shoot(stage, state.home, state.scene, state.export, currentViewName);
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
  addEventListener('keydown', (e) => {
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
      const percentX = (dx / r.width) * 100 * (sp.scale || 1);
      const percentY = (dy / r.height) * 100 * (sp.scale || 1);
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

function save() {
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
        },
      };
      localStorage.setItem(STORE_KEY, JSON.stringify(lean));
    } catch { /* give up quietly; the JSON export is the real save path */ }
    if (!warnedQuota) {
      warnedQuota = true;
      alert('Storage is full, so the site photo / plan image could not be saved with this project. They will be missing after a reload — use "Export JSON" to keep a full copy, or upload a smaller image.');
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

function fit() {
  const r = canvas.parentElement.getBoundingClientRect();
  stage.resize(Math.max(1, Math.floor(r.width)), Math.max(1, Math.floor(r.height)));
}

syncForm();
bind();
rebuild();
refreshList();
fit();
updatePlanPlate(stage, state.home.plan);
stage.setView('hero-left', state.home.dimensions, state.scene);
addEventListener('resize', fit);

// Debug handle: lets you poke at state/stage from the console without a build step.
window.__app = { state, stage, rebuild, refreshList, renderToCanvas };

(function loop() {
  requestAnimationFrame(loop);
  stage.render();
})();
