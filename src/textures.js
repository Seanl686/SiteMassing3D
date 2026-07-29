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

export function clearMaterialCache() {
  // Textures are shared between materials now, so they are disposed from their
  // own cache rather than through whichever material happened to hold one.
  for (const mat of materialCache.values()) mat.dispose();
  materialCache.clear();
  for (const tex of textureCache.values()) tex.dispose();
  textureCache.clear();
}
