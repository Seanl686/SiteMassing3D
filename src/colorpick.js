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
  zoomAnchoredPan, wheelZoomFactor,
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
    'Arm a surface on the right, then click it in the photograph — the model updates as you go. '
    + 'Zoom with the wheel, a trackpad pinch or two fingers; drag to pan.');
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

  // The slider carries a 0..1 position, not a zoom factor — the mapping to zoom
  // is logarithmic so the useful low end is not crammed into the first sixth.
  const zoomWrap = el('label', 'eyedrop-tool zoom-tool');
  zoomWrap.append(el('span', null, 'Zoom'));
  const zoomOut = el('button', 'zoom-step', '−');
  zoomOut.type = 'button';
  zoomOut.title = 'Zoom out (−)';
  const zoom = el('input');
  zoom.type = 'range'; zoom.min = '0'; zoom.max = '1'; zoom.step = '0.001'; zoom.value = '0';
  zoom.title = 'Drag to zoom. The wheel, a trackpad pinch and two fingers all work on the photo itself.';
  const zoomIn = el('button', 'zoom-step', '+');
  zoomIn.type = 'button';
  zoomIn.title = 'Zoom in (+)';
  const zoomLabel = el('span', 'zoom-label', '1.0×');
  zoomWrap.append(zoomOut, zoom, zoomIn, zoomLabel);

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
    sizeSel, zoom, zoomIn, zoomOut, zoomLabel, advance,
    btnFit, btnScreen, btnAuto, btnReset, btnApply, btnCancel, close,
  };

  bindEvents();
}

// The full-resolution copy of the current source. Sampling always reads this,
// never the on-screen canvas, so zoom and fit have no effect on the colour.
let fullCanvas = null;
let fullCtx = null;
let fullData = null;
let fullW = 0, fullH = 0;

// ---------------------------------------------------------------------------
// The view: zoom and pan
//
// Zoom is the part of this that has to feel right, and there are three separate
// ways to get it wrong:
//
//   - Zooming about the centre of the frame rather than the pointer. The thing
//     being aimed at slides away exactly when it is being aimed at, which is
//     what makes a picker feel like it is fighting you.
//   - Treating one wheel event as one fixed step. A trackpad sends dozens of
//     tiny deltas per flick and a notched mouse wheel sends one big one, so a
//     per-event step is either hypersensitive or unusably coarse depending on
//     what is plugged in. Scale by the delta, not by the event.
//   - A linear slider, where the bottom sixth covers 1×–2× — the range people
//     actually use — and the rest is a wasteland.
//
// And on a touch screen none of the above exists at all unless two-finger pinch
// is handled explicitly: `touch-action: none` is required for the pointer
// stream, and it also switches off the browser's own pinch.
// ---------------------------------------------------------------------------

const view = { zoom: 1, panX: 0, panY: 0, scale: 1, base: 1, ox: 0, oy: 0, w: 0, h: 0 };

/** 1 = the whole photo fitted to the frame. Below that is just empty margin. */
const MIN_ZOOM = 1;

// Every pointer currently down on the canvas. Two of them is a pinch; one is a
// drag or a pick. Mouse, pen and touch all arrive through the same stream.
// Module scope so closing the dialog mid-gesture cannot leave a phantom finger
// behind for the next time it opens.
const pointers = new Map();
let gesture = null;      // 'pan' | 'pinch'
let moved = 0;
let last = null;
let origin = null;
let pinch = null;
let suppressTap = false;

function resetGesture() {
  pointers.clear();
  gesture = null;
  pinch = null;
  last = null;
  origin = null;
  moved = 0;
  suppressTap = false;
}

/**
 * How far in it is worth going: about 24 screen pixels per image pixel. Past
 * that the canvas is a wall of squares and the loupe is the better instrument.
 * Derived from the image, so a 4000 px photo and an 800 px one each stop
 * somewhere useful instead of sharing one arbitrary ceiling.
 */
function maxZoom() {
  if (!fullCanvas || !view.base) return 8;
  return Math.max(2, Math.min(60, 24 / view.base));
}

// The slider is logarithmic: equal travel gives equal proportional change, so
// 1×–2× gets as much of the track as 20×–40×.
const zoomFromSlider = (t) => {
  const span = maxZoom() / MIN_ZOOM;
  return span <= 1 ? MIN_ZOOM : MIN_ZOOM * Math.pow(span, Math.max(0, Math.min(1, t)));
};
const sliderFromZoom = (z) => {
  const span = maxZoom() / MIN_ZOOM;
  return span <= 1 ? 0 : Math.log(Math.max(MIN_ZOOM, z) / MIN_ZOOM) / Math.log(span);
};

function syncZoomUi() {
  if (!ui) return;
  ui.zoom.value = String(sliderFromZoom(view.zoom));
  ui.zoomLabel.textContent = `${view.zoom < 10 ? view.zoom.toFixed(1) : Math.round(view.zoom)}×`;
  const hi = maxZoom();
  ui.zoomOut.disabled = !fullCanvas || view.zoom <= MIN_ZOOM + 1e-4;
  ui.zoomIn.disabled = !fullCanvas || view.zoom >= hi - 1e-4;
}

function fitView() {
  view.zoom = 1; view.panX = 0; view.panY = 0;
  draw();
  syncZoomUi();
}

/**
 * Change the zoom, keeping the image point under (ax, ay) exactly where it is.
 *
 * `panDx`/`panDy` are applied first, so a pinch — which drags and scales in the
 * same event — anchors against the nudged pan rather than a frame-old one, and
 * the whole gesture costs a single redraw.
 */
function setZoom(next, ax, ay, panDx = 0, panDy = 0) {
  if (!fullCanvas) return;
  const z = Math.max(MIN_ZOOM, Math.min(maxZoom(), next));
  const w = view.w || 1;
  const h = view.h || 1;
  view.panX += panDx;
  view.panY += panDy;

  if (Math.abs(z - view.zoom) > 1e-4) {
    const next = zoomAnchoredPan({
      frame: { w, h },
      image: { w: fullW, h: fullH },
      scale: view.scale,
      pan: { x: view.panX, y: view.panY },
      nextScale: view.base * z,
      anchor: ax == null ? null : { x: ax, y: ay },
    });
    view.zoom = z;
    view.panX = next.x;
    view.panY = next.y;
  }
  draw();
  syncZoomUi();
}

function draw() {
  if (!ui) return;
  const { canvas, ctx } = ui;
  const rect = canvas.parentElement.getBoundingClientRect();
  const w = Math.max(80, Math.floor(rect.width));
  const h = Math.max(80, Math.floor(rect.height));
  view.w = w; view.h = h;
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

  view.base = Math.min(w / fullW, h / fullH);
  view.zoom = Math.max(MIN_ZOOM, Math.min(maxZoom(), view.zoom));
  view.scale = view.base * view.zoom;
  const dw = fullW * view.scale;
  const dh = fullH * view.scale;
  // The pan limit has to be loose enough that it never fights the zoom anchor.
  // A tight clamp silently overrides the pan that holds a point under the
  // cursor, and the point drifts anyway — which reads as the anchoring being
  // broken when it is the clamp overruling it. The rule here is only that the
  // image and the frame keep overlapping by 40% of the smaller of the two, so
  // the photo can never be lost off the edge but can always be brought right
  // up to it.
  const keepX = Math.min(dw, w) * 0.4;
  const keepY = Math.min(dh, h) * 0.4;
  const limX = Math.max(0, (w + dw) / 2 - keepX);
  const limY = Math.max(0, (h + dh) / 2 - keepY);
  view.panX = Math.max(-limX, Math.min(limX, view.panX));
  view.panY = Math.max(-limY, Math.min(limY, view.panY));
  view.ox = (w - dw) / 2 + view.panX;
  view.oy = (h - dh) / 2 + view.panY;

  // Once one image pixel covers more than a couple of screen pixels, smoothing
  // is inventing colours between the ones being sampled. Show the real grid.
  ctx.imageSmoothingEnabled = view.scale < 2;
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

/**
 * Park the loupe beside the cursor, flipping across it near an edge so it never
 * covers the thing being sampled. A finger needs a much bigger gap than a mouse
 * pointer — it is covering that part of the screen itself.
 */
function positionLoupe(x, y, gap = 18) {
  const { loupe } = ui;
  const stage = loupe.parentElement.getBoundingClientRect();
  const size = 132;
  const lx = x + gap + size > stage.width ? x - gap - size : x + gap;
  const ly = y + gap + size > stage.height ? y - gap - size : y + gap;
  loupe.style.left = `${Math.max(4, Math.min(stage.width - size - 4, lx))}px`;
  loupe.style.top = `${Math.max(4, Math.min(stage.height - size - 4, ly))}px`;
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
    syncZoomUi();
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
    syncZoomUi();
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

/**
 * A pointer or wheel event's position in canvas coordinates.
 *
 * `offsetX`/`offsetY` would say the same thing for a real event, but they are
 * defined against the target's padding box and are unreliable on synthesised
 * events, which makes the zoom anchor untestable. The bounding rect is
 * unambiguous.
 */
function localPoint(e) {
  const r = ui.canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

/** How far a press may wander and still count as a pick rather than a drag. */
const tapSlop = (pointerType) => (pointerType === 'mouse' ? 4 : 12);

/** Show the loupe and the readout for a point on the canvas. */
function updateHover(x, y, pointerType = 'mouse') {
  const { loupe } = ui;
  if (!fullCanvas) { loupe.style.display = 'none'; setReadout(null); return; }
  const { x: ix, y: iy } = toImage(x, y);
  if (ix < 0 || iy < 0 || ix >= fullW || iy >= fullH) {
    loupe.style.display = 'none';
    setReadout(null);
    return;
  }
  loupe.style.display = 'block';
  positionLoupe(x, y, pointerType === 'mouse' ? 18 : 52);
  drawLoupe(ix, iy);
  setReadout(sampleAt(ix, iy)?.hex, ix, iy);
}

const hideHover = () => {
  if (!ui) return;
  ui.loupe.style.display = 'none';
  setReadout(null);
};

/** Distance between the two live pointers, and the midpoint between them. */
function pinchState() {
  const [a, b] = [...pointers.values()];
  if (!a || !b) return null;
  return {
    dist: Math.hypot(b.x - a.x, b.y - a.y),
    mx: (a.x + b.x) / 2,
    my: (a.y + b.y) / 2,
  };
}

function bindEvents() {
  const { canvas, sizeSel, zoom, zoomIn, zoomOut, btnFit, btnScreen, btnAuto, btnReset, btnApply, btnCancel, close } = ui;

  canvas.addEventListener('pointerdown', (e) => {
    if (!fullCanvas) return;
    canvas.setPointerCapture(e.pointerId);
    const pt = localPoint(e);
    pointers.set(e.pointerId, { x: pt.x, y: pt.y });
    if (pointers.size === 1) {
      gesture = 'pan';
      moved = 0;
      suppressTap = false;
      last = { x: pt.x, y: pt.y };
      origin = { x: pt.x, y: pt.y };
    } else if (pointers.size === 2) {
      gesture = 'pinch';
      // A second finger means the user is framing, not picking. Whatever the
      // first finger was doing must not land as a colour when they lift.
      suppressTap = true;
      pinch = pinchState();
      hideHover();
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!fullCanvas) return;
    const pt = localPoint(e);
    const p = pointers.get(e.pointerId);
    if (p) { p.x = pt.x; p.y = pt.y; }

    if (gesture === 'pinch' && pointers.size >= 2) {
      const now = pinchState();
      if (pinch && now && pinch.dist > 8 && now.dist > 8) {
        // One gesture, both transforms: the midpoint's travel pans, the spread
        // between the fingers zooms, and the zoom is anchored on that midpoint.
        setZoom(view.zoom * (now.dist / pinch.dist), now.mx, now.my,
          now.mx - pinch.mx, now.my - pinch.my);
      }
      pinch = now;
      return;
    }

    if (gesture === 'pan' && last && origin) {
      const dx = pt.x - last.x;
      const dy = pt.y - last.y;
      // Straight-line distance from where the press started, not the sum of
      // every wobble — a slow hand tracing a small circle is still a click.
      moved = Math.max(moved, Math.hypot(pt.x - origin.x, pt.y - origin.y));
      // Only pan once the press is clearly a drag — otherwise a shaky click, or
      // the wobble of a fingertip, slides the photo instead of sampling it.
      if (moved > tapSlop(e.pointerType)) {
        view.panX += dx; view.panY += dy;
        last = { x: pt.x, y: pt.y };
        draw();
      }
    }
    updateHover(pt.x, pt.y, e.pointerType);
  });

  const endPointer = (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    try { canvas.releasePointerCapture(e.pointerId); } catch { /* pointer already gone */ }

    if (pointers.size === 1) {
      // A finger lifted out of a pinch. Carry on panning from the survivor, and
      // never treat the rest of that gesture as a pick.
      const [only] = [...pointers.values()];
      gesture = 'pan';
      last = { x: only.x, y: only.y };
      origin = { x: only.x, y: only.y };
      pinch = null;
      suppressTap = true;
      return;
    }
    if (pointers.size > 1) { pinch = pinchState(); return; }

    const wasTap = gesture === 'pan' && !suppressTap && moved <= tapSlop(e.pointerType);
    gesture = null;
    pinch = null;
    suppressTap = false;
    if (wasTap && fullCanvas) {
      const up = localPoint(e);
      const { x: ix, y: iy } = toImage(up.x, up.y);
      const hit = sampleAt(ix, iy);
      if (hit) applyPick(hit.hex);
    }
    // A finger leaves nothing hovering behind it.
    if (e.pointerType !== 'mouse') hideHover();
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('pointerleave', (e) => {
    if (!pointers.has(e.pointerId)) hideHover();
  });

  canvas.addEventListener('wheel', (e) => {
    if (!fullCanvas) return;
    // Always: an unhandled wheel here scrolls the dialog or zooms the page.
    e.preventDefault();
    // ctrlKey on a wheel event is a trackpad pinch, which both macOS and
    // Windows synthesise; wheelZoomFactor handles that and the line/page delta
    // modes so a trackpad and a notched wheel land on the same feel.
    const factor = wheelZoomFactor({
      deltaY: e.deltaY, deltaMode: e.deltaMode, ctrlKey: e.ctrlKey, pageHeight: view.h,
    });
    const pt = localPoint(e);
    setZoom(view.zoom * factor, pt.x, pt.y);
    updateHover(pt.x, pt.y, e.pointerType || 'mouse');
  }, { passive: false });

  // Keeping the pointer where it is means the anchor for a keyboard or button
  // zoom is the centre of the frame, which is what the eye expects.
  const stepZoom = (mult) => setZoom(view.zoom * mult, null, null);
  zoomIn.addEventListener('click', () => stepZoom(1.6));
  zoomOut.addEventListener('click', () => stepZoom(1 / 1.6));
  zoom.addEventListener('input', () => setZoom(zoomFromSlider(parseFloat(zoom.value) || 0), null, null));
  btnFit.addEventListener('click', fitView);

  dlg.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement && e.target.type !== 'range') return;
    if (e.key === '+' || e.key === '=') { e.preventDefault(); stepZoom(1.6); }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); stepZoom(1 / 1.6); }
    else if (e.key === '0') { e.preventDefault(); fitView(); }
  });
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

  // The zoom ceiling is derived from how the image fits, so a resize moves it.
  addEventListener('resize', () => { if (dlg?.open) { draw(); syncZoomUi(); } });
}

function finish(commit) {
  if (!session) return;
  const s = session;
  session = null;
  if (commit) s.onCommit({ ...s.colors }, [...s.touched]);
  else { s.onPreview({ ...s.original }); s.onCancel?.(); }
  // Free the working copy; these are multi-megabyte buffers.
  fullCanvas = fullCtx = fullData = null;
  resetGesture();
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

  resetGesture();
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
