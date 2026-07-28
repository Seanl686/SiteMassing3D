// App wiring: state -> geometry -> viewport, plus all the panel controls.

import * as THREE from 'three';
import { Stage } from './scene.js';
import { buildHome, disposeTree, wallFrames, clampOpening, fmtFt, derived } from './build.js';
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
let selectedId = null;
let pendingAdd = null;

const canvas = document.getElementById('view');
const stage = new Stage(canvas);
const gizmo = new Gizmo(stage.homeGroup);
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
  stage.homeGroup.add(gizmo.group);

  const sp = state.home.sitePhoto || {};
  const baseY = sp.baselineY || 0;
  stage.setGroundBaseline(baseY);
  stage.homeGroup.position.set(sp.posX || 0, baseY, sp.posZ || 0);
  stage.homeGroup.rotation.y = THREE.MathUtils.degToRad(sp.rotY || 0);

  if (sp.camDist && isFinite(sp.camDist) && sp.camDist > 0) {
    stage.setCameraDistance(sp.camDist);
  }

  stage.applySceneOpts(state.scene, state.home.dimensions);
  gizmo.show(state.home.openings.find((o) => o.id === selectedId), state.home.dimensions);
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
      if (geometry) clampOpening(o, state.home.dimensions);
      rebuild();
      save();
      syncList();
    },
    onRestructure: (id) => { rebuild(); save(); refreshList(); select(id); },
    onDelete: (id) => {
      state.home.openings = state.home.openings.filter((o) => o.id !== id);
      if (selectedId === id) { selectedId = null; gizmo.clear(); }
      rebuild(); save(); refreshList();
    },
    onDuplicate: (id) => {
      const src = state.home.openings.find((o) => o.id === id);
      if (!src) return;
      const copy = { ...src, id: nextId(src.type[0]), offsetFt: src.offsetFt + src.widthFt + 2 };
      state.home.openings.push(copy);
      rebuild(); save(); refreshList(); select(copy.id);
    },
  });
  updateCounts();
}

/** Cheap update: values and selection only, existing rows untouched. */
function syncList() {
  syncOpeningValues($('openingList'), state.home, selectedId, {
    selectedId,
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
];
const colorFields = [
  ['c_siding', 'siding'], ['c_trim', 'trim'], ['c_roof', 'roof'],
  ['c_skirting', 'skirting'], ['c_door', 'door'], ['c_glass', 'glass'],
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

function syncForm() {
  $('f_name').value = state.home.name;
  for (const [id, key] of dimFields) $(id).value = state.home.dimensions[key] ?? 0;
  $('f_roofStyle').value = state.home.dimensions.roofStyle;
  if ($('f_dormerCount')) $('f_dormerCount').value = state.home.dimensions.dormerCount ?? 0;
  if ($('f_dormerStyle')) $('f_dormerStyle').value = state.home.dimensions.dormerStyle || 'gable';
  if ($('f_dormerFalseEave')) $('f_dormerFalseEave').checked = state.home.dimensions.dormerFalseEave !== false;
  if ($('f_dormerWindow')) $('f_dormerWindow').checked = state.home.dimensions.dormerWindow !== false;
  for (const [id, key] of colorFields) $(id).value = state.home.colors[key];
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
  if ($('f_dormerCount')) {
    $('f_dormerCount').addEventListener('change', (e) => {
      state.home.dimensions.dormerCount = parseInt(e.target.value, 10) || 0;
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
  if ($('f_dormerWindow')) {
    $('f_dormerWindow').addEventListener('change', (e) => {
      state.home.dimensions.dormerWindow = e.target.checked;
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
      const r = new FileReader();
      r.onload = () => {
        state.home.sitePhoto.src = r.result;
        state.home.sitePhoto.show = true;
        if ($('sp_show')) $('sp_show').checked = true;
        rebuild();
      };
      r.readAsDataURL(f);
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

    // 1. Camera Distance
    const dist = Math.round(stage.getCameraDistance() * 10) / 10;
    state.home.sitePhoto.camDist = dist;
    if ($('sp_camDist') && document.activeElement !== $('sp_camDist')) {
      $('sp_camDist').value = dist;
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
  const hit = wallPlaneHit(ray, o.wall, state.home.dimensions, stage.homeGroup);
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

  applyDrag(o, drag.mode, drag.start, { du, dv }, state.home.dimensions, ev.altKey);
  clampOpening(o, state.home.dimensions);
  queueRebuild();
}

function onUp() {
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
  pendingAdd = null;
  canvas.style.cursor = '';
  rebuild();
  refreshList();
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------



function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch {
    // Plan plates are stored as data URLs and can blow the quota; drop it and retry.
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
