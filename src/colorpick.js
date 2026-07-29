// The eyedropper dialog: pick the exterior finishes off the actual photograph.
//
// Typing hex into nine colour fields is guessing, and the guess is always a
// little too clean — real siding is greyer and cooler than its swatch name, and
// a roof read by eye off a catalogue shot lands a couple of shades light. The
// photographs of the real home are already loaded two panels away and they hold
// the answer exactly, so this puts them under a crosshair.
//
// Every pick previews straight onto the 3D model. That is the whole point: the
// user is not matching hex codes, they are watching the render become the unit
// in the photograph. Cancel puts every colour back.
//
// The dialog is built here rather than in index.html so the whole feature is one
// file — markup, behaviour and teardown together.

import {
  rgbToHex, hexToRgb, sampleAverage, samplePixels, quantize, suggestFinishRoles,
} from './eyedrop.js';

const SAMPLE_SIZES = [
  { radius: 0, label: '1 px — exact pixel' },
  { radius: 1, label: '3 × 3 — light average' },
  { radius: 2, label: '5 × 5 — recommended' },
  { radius: 5, label: '11 × 11 — heavy average' },
];

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

let dlg = null;      // the <dialog>, built once and reused
let ui = null;       // its parts, so open() can repopulate without rebuilding
let session = null;  // the open call's state

/** Palettes are expensive to extract and never change for a given image. */
const paletteCache = new Map();

function build() {
  dlg = el('dialog', 'modal eyedrop-modal');
  dlg.id = 'dlgEyedrop';

  const head = el('div', 'eyedrop-head');
  const title = el('h3', null, '🎯 Pick finishes off the photo');
  const hint = el('p', 'eyedrop-subtitle',
    'Arm a surface on the right, then click it in the photograph. The model updates as you go.');
  const headText = el('div');
  headText.append(title, hint);
  const close = el('button', 'eyedrop-x', '✕');
  close.type = 'button';
  head.append(headText, close);

  // --- sources -------------------------------------------------------------
  const sourceStrip = el('div', 'eyedrop-sources');

  // --- picking surface -----------------------------------------------------
  const stage = el('div', 'eyedrop-stage');
  const canvas = el('canvas', 'eyedrop-canvas');
  const loupe = el('canvas', 'eyedrop-loupe');
  loupe.width = 132; loupe.height = 132;
  const readout = el('div', 'eyedrop-readout');
  const empty = el('div', 'eyedrop-empty');
  stage.append(canvas, loupe, readout, empty);

  const tools = el('div', 'eyedrop-tools');
  const sizeWrap = el('label', 'eyedrop-tool');
  sizeWrap.append(el('span', null, 'Sample'));
  const sizeSel = el('select');
  SAMPLE_SIZES.forEach((s, i) => {
    const o = el('option', null, s.label);
    o.value = String(i);
    sizeSel.appendChild(o);
  });
  sizeSel.value = '2';
  sizeWrap.appendChild(sizeSel);

  const zoomWrap = el('label', 'eyedrop-tool');
  zoomWrap.append(el('span', null, 'Zoom'));
  const zoom = el('input');
  zoom.type = 'range'; zoom.min = '1'; zoom.max = '8'; zoom.step = '0.1'; zoom.value = '1';
  zoomWrap.appendChild(zoom);

  const advanceWrap = el('label', 'eyedrop-tool check');
  const advance = el('input');
  advance.type = 'checkbox'; advance.checked = true;
  advanceWrap.append(advance, el('span', null, 'Move to the next surface after each pick'));

  const btnFit = el('button', null, 'Fit');
  btnFit.type = 'button';
  const btnScreen = el('button', null, '🖥 Pick from anywhere on screen');
  btnScreen.type = 'button';
  btnScreen.title = 'Uses the browser eyedropper — works on the 3D view, another window, anything visible';
  if (!window.EyeDropper) btnScreen.style.display = 'none';

  tools.append(sizeWrap, zoomWrap, btnFit, advanceWrap, btnScreen);

  // --- palette -------------------------------------------------------------
  const paletteWrap = el('div', 'eyedrop-palette-wrap');
  const paletteHead = el('div', 'eyedrop-section-head');
  paletteHead.append(el('span', null, 'Colours this photo is actually made of'));
  const btnAuto = el('button', null, 'Auto-assign all');
  btnAuto.type = 'button';
  btnAuto.title = 'Darkest large area to the roof, lightest to the trim, biggest remaining area to the siding';
  paletteHead.appendChild(btnAuto);
  const palette = el('div', 'eyedrop-palette');
  paletteWrap.append(paletteHead, palette);

  // --- targets -------------------------------------------------------------
  const side = el('div', 'eyedrop-side');
  const sideHead = el('div', 'eyedrop-section-head');
  sideHead.append(el('span', null, 'Surfaces'));
  const btnReset = el('button', null, 'Revert all');
  btnReset.type = 'button';
  sideHead.appendChild(btnReset);
  const targets = el('div', 'eyedrop-targets');
  side.append(sideHead, targets);

  const main = el('div', 'eyedrop-main');
  const left = el('div', 'eyedrop-left');
  left.append(sourceStrip, stage, tools, paletteWrap);
  main.append(left, side);

  const foot = el('div', 'eyedrop-foot');
  const status = el('p', 'eyedrop-status');
  const btnCancel = el('button', null, 'Cancel');
  btnCancel.type = 'button';
  const btnApply = el('button', 'primary', 'Apply colours');
  btnApply.type = 'button';
  foot.append(status, btnCancel, btnApply);

  dlg.append(head, main, foot);
  document.body.appendChild(dlg);

  ui = {
    canvas, ctx: canvas.getContext('2d'), loupe, lctx: loupe.getContext('2d'),
    readout, empty, sourceStrip, palette, targets, status,
    sizeSel, zoom, advance, btnFit, btnScreen, btnAuto, btnReset, btnApply, btnCancel, close,
  };

  bindEvents();
}

// The full-resolution copy of the current source. Sampling always reads this,
// never the on-screen canvas, so zoom and fit have no effect on the colour.
let fullCanvas = null;
let fullCtx = null;
let fullData = null;
let fullW = 0, fullH = 0;

const view = { zoom: 1, panX: 0, panY: 0, scale: 1, ox: 0, oy: 0 };

function fitView() {
  view.zoom = 1; view.panX = 0; view.panY = 0;
  if (ui) ui.zoom.value = '1';
  draw();
}

function draw() {
  if (!ui) return;
  const { canvas, ctx } = ui;
  const rect = canvas.parentElement.getBoundingClientRect();
  const w = Math.max(80, Math.floor(rect.width));
  const h = Math.max(80, Math.floor(rect.height));
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
  }
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (!fullCanvas) return;

  const base = Math.min(w / fullW, h / fullH);
  view.scale = base * view.zoom;
  const dw = fullW * view.scale;
  const dh = fullH * view.scale;
  // Keep at least a third of the image on screen however far it is dragged.
  const limX = Math.max(0, (dw - w) / 2 + w / 3);
  const limY = Math.max(0, (dh - h) / 2 + h / 3);
  view.panX = Math.max(-limX, Math.min(limX, view.panX));
  view.panY = Math.max(-limY, Math.min(limY, view.panY));
  view.ox = (w - dw) / 2 + view.panX;
  view.oy = (h - dh) / 2 + view.panY;

  ctx.imageSmoothingEnabled = view.zoom < 3;
  ctx.drawImage(fullCanvas, view.ox, view.oy, dw, dh);
}

/** Canvas point (CSS px) to image pixel. */
const toImage = (x, y) => ({ x: (x - view.ox) / view.scale, y: (y - view.oy) / view.scale });

function sampleAt(ix, iy) {
  if (!fullData) return null;
  if (ix < 0 || iy < 0 || ix >= fullW || iy >= fullH) return null;
  const radius = SAMPLE_SIZES[parseInt(ui.sizeSel.value, 10) || 0].radius;
  const rgb = sampleAverage(fullData, fullW, fullH, ix, iy, radius);
  return rgb ? { rgb, hex: rgbToHex(rgb) } : null;
}

function drawLoupe(ix, iy) {
  const { loupe, lctx } = ui;
  const span = 13;               // source pixels across the loupe
  const cell = loupe.width / span;
  lctx.imageSmoothingEnabled = false;
  lctx.clearRect(0, 0, loupe.width, loupe.height);
  lctx.fillStyle = '#0d1117';
  lctx.fillRect(0, 0, loupe.width, loupe.height);
  const sx = Math.round(ix) - (span >> 1);
  const sy = Math.round(iy) - (span >> 1);
  lctx.drawImage(fullCanvas, sx, sy, span, span, 0, 0, loupe.width, loupe.height);

  const radius = SAMPLE_SIZES[parseInt(ui.sizeSel.value, 10) || 0].radius;
  const box = (2 * radius + 1) * cell;
  lctx.strokeStyle = '#ffffff';
  lctx.lineWidth = 1.5;
  lctx.strokeRect(
    (loupe.width - box) / 2, (loupe.height - box) / 2, box, box,
  );
  lctx.strokeStyle = 'rgba(0,0,0,0.75)';
  lctx.lineWidth = 1;
  lctx.strokeRect(
    (loupe.width - box) / 2 - 1, (loupe.height - box) / 2 - 1, box + 2, box + 2,
  );
}

function positionLoupe(x, y) {
  const { loupe } = ui;
  const stage = loupe.parentElement.getBoundingClientRect();
  const size = 132;
  // Flip to the other side of the cursor near an edge so the loupe never covers
  // the thing being sampled.
  const lx = x + 18 + size > stage.width ? x - 18 - size : x + 18;
  const ly = y + 18 + size > stage.height ? y - 18 - size : y + 18;
  loupe.style.left = `${Math.max(4, lx)}px`;
  loupe.style.top = `${Math.max(4, ly)}px`;
}

function setReadout(hex, ix, iy) {
  const { readout } = ui;
  if (!hex || !session) { readout.style.display = 'none'; return; }
  readout.style.display = 'flex';
  readout.textContent = '';
  const chip = el('span', 'eyedrop-chip');
  chip.style.background = hex;
  const armed = session.targets.find((t) => t.key === session.armedKey);
  readout.append(
    chip,
    el('span', 'eyedrop-hex', hex.toUpperCase()),
    el('span', 'eyedrop-coord', `${Math.round(ix)}, ${Math.round(iy)} px`),
    el('span', 'eyedrop-armed', armed ? `→ ${armed.label}` : 'no surface armed'),
  );
}

function applyPick(hex) {
  if (!session) return;
  const armed = session.armedKey;
  if (!armed) {
    setStatus('Click a surface on the right first — that is what the pick lands on.');
    return;
  }
  session.colors[armed] = hex;
  session.touched.add(armed);
  session.onPreview({ ...session.colors });
  const label = session.targets.find((t) => t.key === armed)?.label || armed;
  setStatus(`${label} set to ${hex.toUpperCase()}.`);
  if (ui.advance.checked) armNext();
  renderTargets();
}

function armNext() {
  const i = session.targets.findIndex((t) => t.key === session.armedKey);
  const next = session.targets[(i + 1) % session.targets.length];
  session.armedKey = next.key;
}

function setStatus(msg) {
  if (ui) ui.status.textContent = msg || '';
}

// ---------------------------------------------------------------------------
// Source loading
// ---------------------------------------------------------------------------

function loadSource(source) {
  session.activeId = source?.id || null;
  renderSources();
  ui.empty.style.display = 'none';
  if (!source) {
    fullCanvas = fullCtx = fullData = null;
    ui.empty.textContent = 'No photograph is loaded yet. Load one in the "Photos Of The Real Home" panel and it shows up here.';
    ui.empty.style.display = 'flex';
    ui.palette.textContent = '';
    draw();
    return;
  }

  const img = new Image();
  img.onload = () => {
    // Cap the working copy: a 4000 px photo costs 64 MB of ImageData to sample
    // from and reads no differently once averaged.
    const maxDim = 2000;
    const s = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    fullW = Math.max(1, Math.round(img.naturalWidth * s));
    fullH = Math.max(1, Math.round(img.naturalHeight * s));
    fullCanvas = document.createElement('canvas');
    fullCanvas.width = fullW;
    fullCanvas.height = fullH;
    fullCtx = fullCanvas.getContext('2d', { willReadFrequently: true });
    fullCtx.drawImage(img, 0, 0, fullW, fullH);
    fullData = fullCtx.getImageData(0, 0, fullW, fullH).data;
    fitView();
    renderPalette(source);
  };
  img.onerror = () => {
    fullCanvas = fullData = null;
    ui.empty.textContent = 'That image could not be decoded.';
    ui.empty.style.display = 'flex';
    draw();
  };
  img.src = source.src;
}

function renderPalette(source) {
  const { palette } = ui;
  palette.textContent = '';
  let colors = paletteCache.get(source.id + source.src.length);
  if (!colors) {
    colors = quantize(samplePixels(fullData, fullW, fullH, 24000), 9);
    paletteCache.set(source.id + source.src.length, colors);
  }
  session.palette = colors;
  for (const c of colors) {
    const sw = el('button', 'eyedrop-swatch');
    sw.type = 'button';
    sw.style.background = c.hex;
    sw.title = `${c.hex.toUpperCase()} — ${Math.round(c.weight * 100)}% of the photo. Click to give it to the armed surface.`;
    sw.append(el('span', 'eyedrop-swatch-pct', `${Math.round(c.weight * 100)}%`));
    sw.addEventListener('click', () => applyPick(c.hex));
    palette.appendChild(sw);
  }
}

function renderSources() {
  const { sourceStrip } = ui;
  sourceStrip.textContent = '';
  if (!session.sources.length) return;
  for (const s of session.sources) {
    const b = el('button', `eyedrop-source${s.id === session.activeId ? ' active' : ''}`);
    b.type = 'button';
    b.title = `${s.kindLabel || ''}${s.detail ? ` — ${s.detail}` : ''}`;
    const img = el('img');
    img.src = s.src;
    img.alt = s.label;
    b.append(img, el('span', null, s.label));
    b.addEventListener('click', () => { if (s.id !== session.activeId) loadSource(s); });
    sourceStrip.appendChild(b);
  }
}

function renderTargets() {
  const { targets } = ui;
  targets.textContent = '';
  for (const t of session.targets) {
    const row = el('button', `eyedrop-target${t.key === session.armedKey ? ' armed' : ''}${session.touched.has(t.key) ? ' changed' : ''}`);
    row.type = 'button';

    const before = el('span', 'eyedrop-target-chip before');
    before.style.background = session.original[t.key];
    before.title = `Was ${String(session.original[t.key]).toUpperCase()}`;
    const after = el('span', 'eyedrop-target-chip after');
    after.style.background = session.colors[t.key];

    const label = el('span', 'eyedrop-target-label', t.label);
    const hex = el('span', 'eyedrop-target-hex', String(session.colors[t.key]).toUpperCase());

    row.append(before, el('span', 'eyedrop-target-arrow', '→'), after, label, hex);
    row.addEventListener('click', () => { session.armedKey = t.key; renderTargets(); });

    if (session.touched.has(t.key)) {
      const undo = el('span', 'eyedrop-target-undo', '↺');
      undo.title = 'Put this one back';
      undo.addEventListener('click', (e) => {
        e.stopPropagation();
        session.colors[t.key] = session.original[t.key];
        session.touched.delete(t.key);
        session.onPreview({ ...session.colors });
        renderTargets();
      });
      row.appendChild(undo);
    }
    targets.appendChild(row);
  }
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

function bindEvents() {
  const { canvas, loupe, sizeSel, zoom, btnFit, btnScreen, btnAuto, btnReset, btnApply, btnCancel, close } = ui;

  let dragging = false;
  let moved = 0;
  let last = null;

  canvas.addEventListener('pointerdown', (e) => {
    if (!fullCanvas) return;
    dragging = true; moved = 0; last = { x: e.offsetX, y: e.offsetY };
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!fullCanvas) return;
    if (dragging && last) {
      const dx = e.offsetX - last.x;
      const dy = e.offsetY - last.y;
      moved += Math.abs(dx) + Math.abs(dy);
      // Only pan once the drag is clearly a drag — otherwise a slightly shaky
      // click would slide the photo instead of sampling it.
      if (moved > 4) {
        view.panX += dx; view.panY += dy;
        last = { x: e.offsetX, y: e.offsetY };
        draw();
      }
    }
    const { x: ix, y: iy } = toImage(e.offsetX, e.offsetY);
    if (ix < 0 || iy < 0 || ix >= fullW || iy >= fullH) {
      loupe.style.display = 'none';
      setReadout(null);
      return;
    }
    loupe.style.display = 'block';
    positionLoupe(e.offsetX, e.offsetY);
    drawLoupe(ix, iy);
    const hit = sampleAt(ix, iy);
    setReadout(hit?.hex, ix, iy);
  });

  const endDrag = (e) => {
    if (!dragging) return;
    dragging = false;
    try { canvas.releasePointerCapture(e.pointerId); } catch { /* pointer already gone */ }
    if (moved <= 4 && fullCanvas) {
      const { x: ix, y: iy } = toImage(e.offsetX, e.offsetY);
      const hit = sampleAt(ix, iy);
      if (hit) applyPick(hit.hex);
    }
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', () => { dragging = false; });

  canvas.addEventListener('pointerleave', () => {
    loupe.style.display = 'none';
    setReadout(null);
  });

  canvas.addEventListener('wheel', (e) => {
    if (!fullCanvas) return;
    e.preventDefault();
    const next = Math.max(1, Math.min(8, view.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
    view.zoom = next;
    zoom.value = String(next);
    draw();
  }, { passive: false });

  zoom.addEventListener('input', () => { view.zoom = parseFloat(zoom.value) || 1; draw(); });
  btnFit.addEventListener('click', fitView);
  sizeSel.addEventListener('change', () => setStatus(`Sampling ${SAMPLE_SIZES[parseInt(sizeSel.value, 10)].label}.`));

  btnScreen.addEventListener('click', async () => {
    if (!window.EyeDropper) return;
    try {
      const res = await new window.EyeDropper().open();
      if (res?.sRGBHex && hexToRgb(res.sRGBHex)) applyPick(res.sRGBHex.toLowerCase());
    } catch { /* the user pressed Escape out of the picker */ }
  });

  btnAuto.addEventListener('click', () => {
    if (!session.palette?.length) return;
    const guess = suggestFinishRoles(session.palette);
    let n = 0;
    for (const t of session.targets) {
      if (guess[t.key]) { session.colors[t.key] = guess[t.key]; session.touched.add(t.key); n++; }
    }
    session.onPreview({ ...session.colors });
    renderTargets();
    setStatus(`${n} surface${n === 1 ? '' : 's'} set from the photo's dominant colours. Correct anything that reads wrong.`);
  });

  btnReset.addEventListener('click', () => {
    session.colors = { ...session.original };
    session.touched.clear();
    session.onPreview({ ...session.colors });
    renderTargets();
    setStatus('Every colour put back.');
  });

  btnApply.addEventListener('click', () => finish(true));
  btnCancel.addEventListener('click', () => finish(false));
  close.addEventListener('click', () => finish(false));
  // A dialog dismissed with Escape must not silently keep the preview colours.
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); finish(false); });

  addEventListener('resize', () => { if (dlg?.open) draw(); });
}

function finish(commit) {
  if (!session) return;
  const s = session;
  session = null;
  if (commit) s.onCommit({ ...s.colors }, [...s.touched]);
  else { s.onPreview({ ...s.original }); s.onCancel?.(); }
  // Free the working copy; these are multi-megabyte buffers.
  fullCanvas = fullCtx = fullData = null;
  if (dlg.open) dlg.close();
}

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

/**
 * Open the picker.
 *
 * `sources` are the photographs to sample from, best first. `targets` are the
 * surfaces that can receive a colour, each `{ key, label, color }`. `armedKey`
 * is the surface a pick lands on to start with — pass the field the user
 * clicked the eyedropper next to, so one click gets them to the right target.
 *
 * `onPreview` fires on every change including the revert, so wire it straight to
 * the model. `onCommit` fires once on Apply with the final map and the list of
 * keys the user actually touched.
 */
export function openColorPicker({ sources = [], targets = [], armedKey = null, onPreview, onCommit, onCancel } = {}) {
  if (!dlg) build();
  const original = {};
  for (const t of targets) original[t.key] = t.color;

  session = {
    sources,
    targets,
    original,
    colors: { ...original },
    touched: new Set(),
    armedKey: armedKey && targets.some((t) => t.key === armedKey) ? armedKey : (targets[0]?.key || null),
    activeId: null,
    palette: [],
    onPreview: onPreview || (() => {}),
    onCommit: onCommit || (() => {}),
    onCancel,
  };

  renderTargets();
  setStatus(sources.length
    ? 'Tip: the three-quarter catalogue shot shows siding, trim and roof under one light — it is the best single source.'
    : '');
  dlg.showModal();
  // showModal has to run before the stage has a size to fit the image into.
  requestAnimationFrame(() => loadSource(sources[0] || null));
}

/** Whether the picker is on screen — the keyboard shortcuts check this. */
export const colorPickerOpen = () => !!dlg?.open;
