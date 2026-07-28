// App wiring: state -> geometry -> viewport, plus all the panel controls.

import * as THREE from 'three';
import { Stage } from './scene.js';
import { buildHome, disposeTree, wallFrames, clampOpening, fmtFt, derived } from './build.js';
import { renderOpeningList, syncOpeningValues } from './ui.js';
import { updatePlanPlate, nearestWallHit } from './plan.js';
import { Gizmo, wallPlaneHit, applyDrag } from './gizmo.js';
import { shoot, contactSheet, renderToCanvas } from './capture.js';
import { defaultHome, defaultScene, defaultExport, nextId, OPENING_PRESETS } from './defaults.js';

const STORE_KEY = 'sitemassing3d.v1';

const state = load() || {
  home: defaultHome(),
  scene: defaultScene(),
  export: defaultExport(),
};
let selectedId = null;
let pendingAdd = null;

const canvas = document.getElementById('view');
const stage = new Stage(canvas);
const gizmo = new Gizmo(stage.scene);
stage.overlay = gizmo.group; // hidden during export — it is UI, not part of the render
const $ = (id) => document.getElementById(id);

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
  stage.applySceneOpts(state.scene, state.home.dimensions);
  gizmo.show(state.home.openings.find((o) => o.id === selectedId), state.home.dimensions);
  updateHud();
  save();
}

function select(id) {
  selectedId = id;
  gizmo.show(state.home.openings.find((o) => o.id === id), state.home.dimensions);
  refreshList();
}

/** Full rebuild of the list DOM — only for changes that move rows between groups. */
function refreshList() {
  renderOpeningList($('openingList'), state.home, {
    selectedId,
    onSelect: select,
    onEdit: (o, geometry) => {
      if (geometry) { clampOpening(o, state.home.dimensions); rebuild(); }
      else save();
    },
    onRestructure: (id) => { rebuild(); refreshList(); select(id); },
    onDelete: (id) => {
      state.home.openings = state.home.openings.filter((o) => o.id !== id);
      if (selectedId === id) { selectedId = null; gizmo.clear(); }
      rebuild(); refreshList();
    },
    onDuplicate: (id) => {
      const src = state.home.openings.find((o) => o.id === id);
      if (!src) return;
      const copy = { ...src, id: nextId(src.type[0]), offsetFt: src.offsetFt + src.widthFt + 2 };
      state.home.openings.push(copy);
      rebuild(); refreshList(); select(copy.id);
    },
  });
  updateCounts();
}

/** Cheap update: values and selection only, existing rows untouched. */
function syncList() {
  syncOpeningValues($('openingList'), state.home, selectedId);
  updateCounts();
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
];
const colorFields = [
  ['c_siding', 'siding'], ['c_trim', 'trim'], ['c_roof', 'roof'],
  ['c_skirting', 'skirting'], ['c_door', 'door'], ['c_glass', 'glass'],
];
const planFields = [['p_width', 'widthFt'], ['p_rot', 'rotation'], ['p_x', 'offsetX'], ['p_z', 'offsetZ']];
const sceneNums = [['s_focal', 'focal'], ['s_eye', 'eye']];
const sceneRanges = [['s_sunAz', 'sunAz'], ['s_sunEl', 'sunEl'], ['s_flat', 'flat']];
const sceneChecks = [['s_grid', 'grid'], ['s_shadow', 'shadow'], ['s_steps', 'steps'], ['s_labels', 'labels'], ['s_dims', 'dims']];

function syncForm() {
  $('f_name').value = state.home.name;
  for (const [id, key] of dimFields) $(id).value = state.home.dimensions[key];
  $('f_roofStyle').value = state.home.dimensions.roofStyle;
  for (const [id, key] of colorFields) $(id).value = state.home.colors[key];
  for (const [id, key] of planFields) $(id).value = state.home.plan[key];
  $('p_op').value = state.home.plan.opacity;
  $('p_show').checked = state.home.plan.show;
  for (const [id, key] of sceneNums) $(id).value = state.scene[key];
  for (const [id, key] of sceneRanges) $(id).value = state.scene[key];
  for (const [id, key] of sceneChecks) $(id).checked = state.scene[key];
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
  gizmo.clear();
  syncForm();
  rebuild();
  refreshList();
  updatePlanPlate(stage, state.home.plan);
  stage.setView('hero-left', state.home.dimensions, state.scene);
}

function bind() {
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

  for (const [id, key] of [...sceneNums, ...sceneRanges]) {
    $(id).addEventListener('input', (e) => {
      state.scene[key] = parseFloat(e.target.value);
      stage.applySceneOpts(state.scene, state.home.dimensions);
      // Focal and eye height change the framing, so re-fit the active preset.
      if ((key === 'focal' || key === 'eye') && stage._lastView) {
        stage.setView(stage._lastView, state.home.dimensions, state.scene);
      }
      save();
    });
  }
  for (const [id, key] of sceneChecks) {
    $(id).addEventListener('change', (e) => {
      state.scene[key] = e.target.checked;
      // steps/labels/dims are geometry; grid/shadow are lighting-only.
      if (['steps', 'labels', 'dims'].includes(key)) rebuild();
      else { stage.applySceneOpts(state.scene, state.home.dimensions); save(); }
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

  const doShot = () => shoot(stage, state.home, state.scene, state.export, currentViewName);
  $('btnShot').addEventListener('click', doShot);
  $('btnShot2').addEventListener('click', doShot);
  $('btnSheet').addEventListener('click', () => contactSheet(stage, state.home, state.scene, state.export));

  canvas.addEventListener('pointerdown', onPick);
  // Move/up live on the window so a drag survives the pointer leaving the canvas.
  addEventListener('pointermove', onMove);
  addEventListener('pointerup', onUp);
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { pendingAdd = null; canvas.style.cursor = ''; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId && e.target === document.body) {
      state.home.openings = state.home.openings.filter((o) => o.id !== selectedId);
      selectedId = null; gizmo.clear(); rebuild(); refreshList();
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

function setRay(ev) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, stage.camera);
}

const findOpeningId = (obj) => {
  for (let o = obj; o; o = o.parent) if (o.userData?.opening) return o.userData.opening;
  return null;
};

function onPick(ev) {
  if (ev.button !== 0) return;
  setRay(ev);
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
    select(hitId);
    scrollToSelected();
    return beginDrag(o, 'move');
  }

  if (selectedId) { selectedId = null; gizmo.clear(); refreshList(); }
}

function beginDrag(o, mode) {
  const hit = wallPlaneHit(ray, o.wall, state.home.dimensions);
  if (!hit) return;
  drag = {
    id: o.id,
    mode,
    origin: hit,
    start: { offsetFt: o.offsetFt, widthFt: o.widthFt, heightFt: o.heightFt, sillFt: o.sillFt },
  };
  stage.controls.enabled = false;
  stage.orthoControls.enabled = false;
  canvas.style.cursor = mode === 'move' ? 'grabbing' : 'crosshair';
}

function onMove(ev) {
  if (!drag) {
    if (!selectedId || ev.target !== canvas) return;
    setRay(ev);
    const mode = gizmo.pick(ray);
    gizmo.highlight(mode);
    if (mode) canvas.style.cursor = (mode === 'left' || mode === 'right') ? 'ew-resize' : 'ns-resize';
    else if (!pendingAdd) canvas.style.cursor = '';
    return;
  }

  const o = state.home.openings.find((x) => x.id === drag.id);
  if (!o) return;
  setRay(ev);
  const hit = wallPlaneHit(ray, o.wall, state.home.dimensions);
  if (!hit) return;

  let du = hit.u - drag.origin.u;
  let dv = hit.v - drag.origin.v;
  // Shift locks the drag to the dominant axis; Alt turns off the 1" snap.
  if (ev.shiftKey) { if (Math.abs(du) >= Math.abs(dv)) dv = 0; else du = 0; }

  applyDrag(o, drag.mode, drag.start, { du, dv }, state.home.dimensions, ev.altKey);
  clampOpening(o, state.home.dimensions);
  queueRebuild();
}

function onUp() {
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
  pendingAdd = null;
  canvas.style.cursor = '';
  rebuild();
  refreshList();
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function migrate(home) {
  const base = defaultHome();
  const out = {
    name: home.name || base.name,
    dimensions: { ...base.dimensions, ...(home.dimensions || {}) },
    colors: { ...base.colors, ...(home.colors || {}) },
    openings: (home.openings || []).map((o) => ({
      id: o.id || nextId('o'),
      type: o.type || 'window',
      wall: o.wall || 'front',
      offsetFt: +o.offsetFt || 0,
      widthFt: +o.widthFt || 3,
      heightFt: +o.heightFt || 3,
      sillFt: +o.sillFt || 0,
      label: o.label || '',
    })),
    plan: { ...base.plan, ...(home.plan || {}) },
  };
  return out;
}

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch {
    // Plan plates are stored as data URLs and can blow the quota; drop it and retry.
    try {
      const lean = { ...state, home: { ...state.home, plan: { ...state.home.plan, src: null } } };
      localStorage.setItem(STORE_KEY, JSON.stringify(lean));
    } catch { /* give up quietly; the JSON export is the real save path */ }
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
