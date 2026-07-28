// Offscreen-size rendering and PNG export.

import * as THREE from 'three';
import { fmtFt } from './build.js';

function slug(s) {
  return (s || 'home').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'home';
}

function download(canvas, filename) {
  canvas.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }, 'image/png');
}

const photoImgCache = new Map();

function getCachedImage(src) {
  if (!src) return null;
  if (photoImgCache.has(src)) return photoImgCache.get(src);
  const img = new Image();
  img.src = src;
  photoImgCache.set(src, img);
  return img;
}

/**
 * Render the current camera at an arbitrary pixel size and return a 2D canvas.
 * The live viewport size is restored before returning.
 */
export function renderToCanvas(stage, w, h, alpha, sceneOpts, home) {
  const dom = stage.renderer?.domElement;
  const prevSize = new THREE.Vector2();
  stage.renderer.getSize(prevSize);
  const prevRatio = stage.renderer.getPixelRatio();
  const prevBg = stage.scene.background;

  // Save active camera transform, target, and orientation
  const isOrtho = stage.camera === stage.ortho;
  const activeControls = isOrtho ? stage.orthoControls : stage.controls;
  const savedPos = stage.camera.position.clone();
  const savedTarget = activeControls.target.clone();
  const savedQuat = stage.camera.quaternion.clone();
  const savedZoom = stage.camera.zoom;
  const prevAspect = stage.persp.aspect;

  const isLiveSize = dom && Math.abs(w - dom.width) < 2 && Math.abs(h - dom.height) < 2;

  if (!isLiveSize) {
    stage.renderer.setPixelRatio(1);
    stage.renderer.setSize(w, h, false);

    if (!isOrtho) {
      stage.persp.aspect = w / h;
      stage.persp.updateProjectionMatrix();
    } else {
      stage._aspect = w / h;
      stage.reframeOrtho();
    }
  }

  const sp = home?.sitePhoto;
  // Same test the live plate uses — "block landscape" hides the photo on screen,
  // so it has to hide it here too.
  const useBgPhoto = sp && sp.src && sp.show && !alpha && !sceneOpts?.blockLandscape;

  if (alpha || useBgPhoto) {
    stage.scene.background = null;
    stage.renderer.setClearAlpha(0);
  }
  // The ground grid is part of the view, not an overlay, so it is exported when
  // it is switched on. A cutout (alpha) export is the exception: it exists to be
  // composited elsewhere, where a baked-in grid would be in the way.
  if (alpha) stage.grid.visible = false;

  const overlayWas = stage.overlay?.visible;
  if (stage.overlay) stage.overlay.visible = false;

  // Render current camera view
  stage.renderer.render(stage.scene, stage.camera);

  if (stage.overlay) stage.overlay.visible = overlayWas;

  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const ctx = out.getContext('2d');

  if (!alpha && sceneOpts?.bg && sceneOpts.bgVisible !== false) {
    ctx.fillStyle = sceneOpts.bg;
    ctx.fillRect(0, 0, w, h);
  }

  if (useBgPhoto) {
    const img = getCachedImage(sp.src);
    if (img && (img.complete || img.naturalWidth)) {
      ctx.save();
      ctx.globalAlpha = sp.opacity ?? 0.85;
      const scale = sp.scale ?? 1.0;
      // Pan is a fraction of HEIGHT on both axes, exactly as the live plate
      // applies it, so an export at another aspect keeps the same alignment.
      const panX = ((sp.panX ?? 0) / 100) * h;
      const panY = ((sp.panY ?? 0) / 100) * h;
      const rot = THREE.MathUtils.degToRad(sp.rotation ?? 0);

      // Match the live plate's transform order exactly: the element rotates
      // about the STAGE centre and the pan rides that rotation, so panning a
      // rotated photo has to move along the rotated axes here as well.
      ctx.translate(w / 2, h / 2);
      ctx.rotate(rot);
      ctx.translate(panX, panY);
      ctx.scale(scale, scale);

      const fitMode = sp.fitMode || 'camera';
      const imgAspect = (img.naturalWidth || img.width) / (img.naturalHeight || img.height || 1);
      const canvasAspect = w / h;
      let drawW = w, drawH = h;
      if (fitMode === 'cover') {
        if (imgAspect > canvasAspect) { drawW = h * imgAspect; }
        else { drawH = w / imgAspect; }
      } else if (fitMode !== 'stretch' && fitMode !== '100% 100%') {
        // 'camera': height-locked, the CSS equivalent of background-size: auto 100%.
        drawH = h;
        drawW = h * imgAspect;
      }

      ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
      ctx.restore();
    }
  }

  ctx.drawImage(stage.renderer.domElement, 0, 0, w, h);

  // Restore live viewport state
  stage.scene.background = prevBg;
  if (prevBg === null || useBgPhoto) {
    stage.renderer.setClearAlpha(0);
  } else {
    stage.renderer.setClearAlpha(1);
  }
  stage.grid.visible = !!sceneOpts.grid && !sceneOpts.blockLandscape;

  if (!isLiveSize) {
    stage.renderer.setPixelRatio(prevRatio);
    stage.renderer.setSize(prevSize.x, prevSize.y, false);

    stage.camera.position.copy(savedPos);
    activeControls.target.copy(savedTarget);
    stage.camera.quaternion.copy(savedQuat);
    stage.camera.zoom = savedZoom;

    if (!isOrtho) {
      stage.persp.aspect = prevAspect;
      stage.persp.updateProjectionMatrix();
    } else {
      stage._aspect = prevAspect;
      stage.reframeOrtho();
    }
    activeControls.update();
  }

  return out;
}

export function getExportFilename(home, viewName) {
  const modelSlug = slug(home?.name || 'home');
  const viewSlug = slug(viewName || 'view');
  return `${modelSlug}-${viewSlug}.png`;
}

export function caption(home, viewName, filename) {
  const d = home.dimensions;
  const modelName = home?.name || 'Untitled Model';
  const fname = filename || getExportFilename(home, viewName);
  return `${modelName}  ·  File: ${fname}  ·  ${fmtFt(d.widthFt)} × ${fmtFt(d.lengthFt)}  ·  ${viewName}`;
}

function burnCaption(canvas, text) {
  const ctx = canvas.getContext('2d');
  const fs = Math.max(16, Math.round(canvas.width / 62));
  const pad = Math.round(fs * 0.7);
  ctx.font = `600 ${fs}px ui-sans-serif, system-ui, sans-serif`;
  const w = ctx.measureText(text).width + pad * 2;
  const h = fs + pad * 1.4;
  const x = pad, y = canvas.height - h - pad;
  ctx.fillStyle = 'rgba(12,14,18,0.78)';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + pad, y + h / 2);
  return canvas;
}

export function shoot(stage, home, sceneOpts, exportOpts, viewName) {
  const dom = stage.renderer?.domElement;
  const liveW = dom ? dom.width : 1920;
  const liveH = dom ? dom.height : 1080;
  const liveAspect = liveW / liveH;

  let targetW = liveW;
  let targetH = liveH;

  if (exportOpts && exportOpts.w > 0) {
    targetW = Math.round(exportOpts.w);
    targetH = Math.max(1, Math.round(targetW / liveAspect));
  }

  const filename = getExportFilename(home, viewName);
  const c = renderToCanvas(stage, targetW, targetH, exportOpts.alpha, sceneOpts, home);
  if (exportOpts.burn && !exportOpts.alpha) burnCaption(c, caption(home, viewName, filename));
  download(c, filename);
  return c;
}

const SHEET_VIEWS = [
  ['front', 'Front elevation'],
  ['right', 'Right end elevation'],
  ['rear', 'Rear elevation'],
  ['hero-left', 'Three-quarter, front-left'],
];

/** 2x2 contact sheet of the standard elevation set — the plate set for an image model. */
export function contactSheet(stage, home, sceneOpts, exportOpts) {
  const cw = Math.round(exportOpts.w / 2);
  const ch = Math.round(exportOpts.h / 2);
  const sheet = document.createElement('canvas');
  sheet.width = cw * 2;
  sheet.height = ch * 2;
  const ctx = sheet.getContext('2d');
  ctx.fillStyle = sceneOpts.bg;
  ctx.fillRect(0, 0, sheet.width, sheet.height);

  const restoreView = stage._lastView;

  SHEET_VIEWS.forEach(([view, label], i) => {
    stage.setView(view, home.dimensions, sceneOpts);
    const tile = renderToCanvas(stage, cw, ch, false, sceneOpts, home);
    burnCaption(tile, label);
    ctx.drawImage(tile, (i % 2) * cw, Math.floor(i / 2) * ch);
  });

  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.beginPath();
  ctx.moveTo(cw, 0); ctx.lineTo(cw, sheet.height);
  ctx.moveTo(0, ch); ctx.lineTo(sheet.width, ch);
  ctx.stroke();

  const sheetFilename = `${slug(home?.name || 'home')}-elevation-set.png`;
  burnCaption(sheet, caption(home, 'elevation set', sheetFilename));
  if (restoreView) stage.setView(restoreView, home.dimensions, sceneOpts);
  download(sheet, sheetFilename);
  return sheet;
}
