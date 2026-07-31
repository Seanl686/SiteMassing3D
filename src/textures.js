// Dynamic Canvas 2D texture generators for vinyl siding styles.
// Creates seamless textures for Three.js without requiring external image files.

import * as THREE from 'three';

const materialCache = new Map();
const textureCache = new Map();

// The relief is authored on white and applied multiplicatively, so a flat
// stretch of siding samples 1.0 and `material.color * map` comes out as exactly
// material.color.
//
// This used to paint the siding colour into the texture AND set it as
// material.color, which multiplied the colour by itself: a wall picked at
// #6f8ba3 rendered around #2d4862 before the light even touched it, and the
// error grew with saturation. It also made the relief depend on the colour —
// the shadow was `colour - 50` clamped at zero, so a dark siding got a
// near-black groove and a pale one got almost none.
//
// The alphas below are the old absolute ±50/±45 deltas re-expressed as
// multipliers, so the profile still reads the way it always did.
const SHADOW_STRENGTH = 0.34;
const HIGHLIGHT_STRENGTH = 0.28;

/**
 * Generate the procedural relief for a siding style: a colour-independent
 * multiplier map, white where the face is flat.
 * @param {string} style - 'horizontal_lap', 'board_batten', 'cedar_shingle', 'smooth'
 * @returns {THREE.CanvasTexture|null}
 */
export function generateSidingTexture(style) {
  if (!style || style === 'smooth' || typeof document === 'undefined') return null;
  if (textureCache.has(style)) return textureCache.get(style);

  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 512, 512);

  // `a` is the old absolute-delta alpha; the strengths above turn it into the
  // equivalent multiplier so the profile looks the same as it always did.
  const shade = (a) => `rgba(0, 0, 0, ${(a * SHADOW_STRENGTH).toFixed(3)})`;
  const lite = (a) => `rgba(255, 255, 255, ${(a * HIGHLIGHT_STRENGTH).toFixed(3)})`;

  if (style === 'horizontal_lap') {
    // 8 courses of 6-inch horizontal lap siding (64px each)
    const courseH = 64;
    for (let y = 0; y < 512; y += courseH) {
      // Top bevel gradient (light to base)
      const grad = ctx.createLinearGradient(0, y, 0, y + courseH);
      grad.addColorStop(0, lite(0.35));
      grad.addColorStop(0.12, lite(0.08));
      grad.addColorStop(0.85, 'rgba(0, 0, 0, 0)');
      grad.addColorStop(1, shade(0.55));
      ctx.fillStyle = grad;
      ctx.fillRect(0, y, 512, courseH);

      // Deep groove line at lap overlap
      ctx.fillStyle = shade(0.85);
      ctx.fillRect(0, y + courseH - 3, 512, 3);

      // Bright lip highlight line above overlap
      ctx.fillStyle = lite(0.65);
      ctx.fillRect(0, y + courseH, 512, 1);
    }
  } else if (style === 'board_batten') {
    // 8 vertical battens every 64px (representing 12-inch spacing)
    const battenSpacing = 64;
    const battenW = 12;

    for (let x = 0; x < 512; x += battenSpacing) {
      // Board background shading
      const bgGrad = ctx.createLinearGradient(x, 0, x + battenSpacing, 0);
      bgGrad.addColorStop(0, shade(0.20));
      bgGrad.addColorStop(0.5, 'rgba(0, 0, 0, 0)');
      bgGrad.addColorStop(1, shade(0.20));
      ctx.fillStyle = bgGrad;
      ctx.fillRect(x, 0, battenSpacing, 512);

      // Batten strip
      const battenX = x + (battenSpacing - battenW) / 2;
      ctx.fillStyle = lite(0.25);
      ctx.fillRect(battenX, 0, battenW, 512);

      // Left highlight edge
      ctx.fillStyle = lite(0.70);
      ctx.fillRect(battenX, 0, 2, 512);

      // Right shadow edge
      ctx.fillStyle = shade(0.80);
      ctx.fillRect(battenX + battenW - 2, 0, 2, 512);
    }
  } else if (style === 'cedar_shingle') {
    // Staggered cedar shingle / shake courses
    const courseH = 64; // 8 courses
    let rowIdx = 0;

    for (let y = 0; y < 512; y += courseH) {
      // Course horizontal overlap shadow
      ctx.fillStyle = shade(0.75);
      ctx.fillRect(0, y + courseH - 3, 512, 3);
      ctx.fillStyle = lite(0.50);
      ctx.fillRect(0, y, 512, 1);

      // Vertical shingle breaks with offset per row
      const offset = (rowIdx % 2 === 0) ? 0 : 32;
      const shingleWidths = [48, 64, 40, 56, 72, 48, 56, 64, 64];

      let curX = -offset;
      let wIdx = 0;
      while (curX < 512) {
        const sw = shingleWidths[wIdx % shingleWidths.length];
        // Vertical gap between shingles
        ctx.fillStyle = shade(0.70);
        ctx.fillRect(curX, y, 2, courseH - 3);

        // Right side subtle highlight
        ctx.fillStyle = lite(0.30);
        ctx.fillRect(curX + 2, y, 1, courseH - 3);

        // Wood grain subtle vertical texture lines inside shingle
        ctx.fillStyle = shade(0.15);
        ctx.fillRect(curX + sw * 0.35, y, 1, courseH - 3);
        ctx.fillRect(curX + sw * 0.7, y, 1, courseH - 3);

        curX += sw;
        wIdx++;
      }

      rowIdx++;
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  // Colour-independent now, so one texture per style serves every colour the
  // user tries instead of a fresh 512x512 canvas per pick.
  texture.repeat.set(1 / 8, 1 / 8);
  textureCache.set(style, texture);
  return texture;
}

/**
 * Creates or retrieves a cached THREE.MeshStandardMaterial for a given siding style and color.
 * @param {string} colorHex
 * @param {string} style - 'horizontal_lap', 'board_batten', 'cedar_shingle', 'smooth'
 * @param {Object} [opts]
 * @returns {THREE.MeshStandardMaterial}
 */
export function createSidingMaterial(colorHex, style = 'horizontal_lap', opts = {}) {
  const cacheKey = `${style}_${colorHex}_${opts.roughness || 0.82}`;
  if (materialCache.has(cacheKey)) {
    return materialCache.get(cacheKey);
  }

  const texture = generateSidingTexture(style);
  const matConfig = {
    // The map is a white-based multiplier, so this colour is the colour the
    // flat face of the siding renders as. Painting it into the map as well
    // would apply it twice.
    color: new THREE.Color(colorHex || '#8d9299'),
    roughness: opts.roughness ?? 0.82,
    metalness: opts.metalness ?? 0.05,
  };
  if (texture) matConfig.map = texture;

  const material = new THREE.MeshStandardMaterial(matConfig);
  materialCache.set(cacheKey, material);
  return material;
}

/**
 * Procedural relief for a skirting style, same colour-independent-multiplier
 * approach as the siding textures above.
 * @param {string} style - 'vinyl_panel', 'concrete_block', 'brick', 'stacked_stone', 'lattice'
 */
export function generateSkirtingTexture(style) {
  if (!style || typeof document === 'undefined') return null;
  const cacheKey = `skirt_${style}`;
  if (textureCache.has(cacheKey)) return textureCache.get(cacheKey);

  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 512, 512);

  const shade = (a) => `rgba(0, 0, 0, ${(a * SHADOW_STRENGTH).toFixed(3)})`;
  const lite = (a) => `rgba(255, 255, 255, ${(a * HIGHLIGHT_STRENGTH).toFixed(3)})`;
  let repeatX = 1 / 8;
  let repeatY = 1 / 4;

  if (style === 'vinyl_panel') {
    // Narrow vertical ribs, like a ribbed vinyl skirting panel.
    const ribSpacing = 32;
    for (let x = 0; x < 512; x += ribSpacing) {
      ctx.fillStyle = shade(0.35);
      ctx.fillRect(x, 0, 3, 512);
      ctx.fillStyle = lite(0.4);
      ctx.fillRect(x + 3, 0, 2, 512);
    }
    repeatX = 1 / 6; repeatY = 1 / 2;
  } else if (style === 'concrete_block') {
    const courseH = 64;
    const blockW = 128;
    let row = 0;
    for (let y = 0; y < 512; y += courseH) {
      const offset = (row % 2 === 0) ? 0 : blockW / 2;
      for (let x = -offset; x < 512; x += blockW) {
        ctx.fillStyle = shade(0.6);
        ctx.strokeStyle = shade(0.6);
        ctx.lineWidth = 3;
        ctx.strokeRect(x, y, blockW, courseH);
      }
      row++;
    }
    repeatX = 1 / 4; repeatY = 1 / 3;
  } else if (style === 'brick') {
    const courseH = 32;
    const brickW = 96;
    let row = 0;
    for (let y = 0; y < 512; y += courseH) {
      const offset = (row % 2 === 0) ? 0 : brickW / 2;
      for (let x = -offset; x < 512; x += brickW) {
        ctx.fillStyle = shade(0.55);
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, brickW, courseH);
      }
      ctx.fillStyle = lite(0.15);
      ctx.fillRect(0, y, 512, 1);
      row++;
    }
    repeatX = 1 / 3; repeatY = 1 / 3;
  } else if (style === 'stacked_stone') {
    // Irregular coursing built from a pseudo-random but repeatable pattern.
    let seed = 7;
    const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    let y = 0;
    while (y < 512) {
      const rowH = 40 + Math.floor(rand() * 40);
      let x = 0;
      while (x < 512) {
        const w = 50 + Math.floor(rand() * 90);
        ctx.fillStyle = shade(0.3 + rand() * 0.3);
        ctx.fillRect(x, y, Math.min(w, 512 - x) - 4, rowH - 4);
        ctx.fillStyle = lite(0.2);
        ctx.fillRect(x, y, Math.min(w, 512 - x) - 4, 2);
        x += w;
      }
      y += rowH;
    }
    repeatX = 1 / 4; repeatY = 1 / 2;
  } else if (style === 'lattice') {
    // Diagonal crosshatch — the visual read of a lattice panel; the mesh
    // stays solid, this is a stand-in until real pierced geometry exists.
    ctx.fillStyle = shade(0.5);
    const step = 24;
    for (let i = -512; i < 512 * 2; i += step) {
      ctx.fillRect(i, 0, 4, 512 * 1.5);
    }
    ctx.save();
    ctx.translate(256, 256);
    ctx.rotate(Math.PI / 4);
    ctx.translate(-256, -256);
    ctx.fillStyle = shade(0.5);
    for (let i = -512; i < 512 * 2; i += step) {
      ctx.fillRect(i, -256, 4, 1024);
    }
    ctx.restore();
    repeatX = 1 / 3; repeatY = 1 / 3;
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.repeat.set(repeatX, repeatY);
  textureCache.set(cacheKey, texture);
  return texture;
}

export function createSkirtingMaterial(colorHex, style = 'vinyl_panel', opts = {}) {
  const cacheKey = `skirt_${style}_${colorHex}_${opts.roughness || 0.9}`;
  if (materialCache.has(cacheKey)) return materialCache.get(cacheKey);

  const texture = generateSkirtingTexture(style);
  const matConfig = {
    color: new THREE.Color(colorHex || '#e6e6e1'),
    roughness: opts.roughness ?? (style === 'vinyl_panel' ? 0.7 : 0.92),
    metalness: 0,
  };
  if (texture) matConfig.map = texture;
  const material = new THREE.MeshStandardMaterial(matConfig);
  materialCache.set(cacheKey, material);
  return material;
}

export function clearMaterialCache() {
  // Textures are shared between materials now, so they are disposed from their
  // own cache rather than through whichever material happened to hold one.
  for (const mat of materialCache.values()) mat.dispose();
  materialCache.clear();
  for (const tex of textureCache.values()) tex.dispose();
  textureCache.clear();
}
