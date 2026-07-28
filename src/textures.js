// Dynamic Canvas 2D texture generators for vinyl siding styles.
// Creates seamless textures for Three.js without requiring external image files.

import * as THREE from 'three';

const materialCache = new Map();

/**
 * Generate a procedural Canvas 2D texture for a specific siding style and color.
 * @param {string} style - 'horizontal_lap', 'board_batten', 'cedar_shingle', 'smooth'
 * @param {string} colorHex - Base color hex string (e.g. '#8d9299')
 * @returns {THREE.CanvasTexture|null}
 */
export function generateSidingTexture(style, colorHex) {
  if (!style || style === 'smooth' || typeof document === 'undefined') return null;

  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');

  // Base fill
  ctx.fillStyle = colorHex || '#8d9299';
  ctx.fillRect(0, 0, 512, 512);

  // Convert hex color to RGB values for shading calculation
  const color = new THREE.Color(colorHex || '#8d9299');
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);

  const shadowRgb = `rgba(${Math.max(0, r - 50)}, ${Math.max(0, g - 50)}, ${Math.max(0, b - 50)}, `;
  const highlightRgb = `rgba(${Math.min(255, r + 45)}, ${Math.min(255, g + 45)}, ${Math.min(255, b + 45)}, `;

  if (style === 'horizontal_lap') {
    // 8 courses of 6-inch horizontal lap siding (64px each)
    const courseH = 64;
    for (let y = 0; y < 512; y += courseH) {
      // Top bevel gradient (light to base)
      const grad = ctx.createLinearGradient(0, y, 0, y + courseH);
      grad.addColorStop(0, `${highlightRgb}0.35)`);
      grad.addColorStop(0.12, `${highlightRgb}0.08)`);
      grad.addColorStop(0.85, 'rgba(0, 0, 0, 0)');
      grad.addColorStop(1, `${shadowRgb}0.55)`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, y, 512, courseH);

      // Deep groove line at lap overlap
      ctx.fillStyle = `${shadowRgb}0.85)`;
      ctx.fillRect(0, y + courseH - 3, 512, 3);

      // Bright lip highlight line above overlap
      ctx.fillStyle = `${highlightRgb}0.65)`;
      ctx.fillRect(0, y + courseH, 512, 1);
    }
  } else if (style === 'board_batten') {
    // 8 vertical battens every 64px (representing 12-inch spacing)
    const battenSpacing = 64;
    const battenW = 12;

    for (let x = 0; x < 512; x += battenSpacing) {
      // Board background shading
      const bgGrad = ctx.createLinearGradient(x, 0, x + battenSpacing, 0);
      bgGrad.addColorStop(0, `${shadowRgb}0.20)`);
      bgGrad.addColorStop(0.5, 'rgba(0, 0, 0, 0)');
      bgGrad.addColorStop(1, `${shadowRgb}0.20)`);
      ctx.fillStyle = bgGrad;
      ctx.fillRect(x, 0, battenSpacing, 512);

      // Batten strip
      const battenX = x + (battenSpacing - battenW) / 2;
      ctx.fillStyle = `${highlightRgb}0.25)`;
      ctx.fillRect(battenX, 0, battenW, 512);

      // Left highlight edge
      ctx.fillStyle = `${highlightRgb}0.70)`;
      ctx.fillRect(battenX, 0, 2, 512);

      // Right shadow edge
      ctx.fillStyle = `${shadowRgb}0.80)`;
      ctx.fillRect(battenX + battenW - 2, 0, 2, 512);
    }
  } else if (style === 'cedar_shingle') {
    // Staggered cedar shingle / shake courses
    const courseH = 64; // 8 courses
    let rowIdx = 0;

    for (let y = 0; y < 512; y += courseH) {
      // Course horizontal overlap shadow
      ctx.fillStyle = `${shadowRgb}0.75)`;
      ctx.fillRect(0, y + courseH - 3, 512, 3);
      ctx.fillStyle = `${highlightRgb}0.50)`;
      ctx.fillRect(0, y, 512, 1);

      // Vertical shingle breaks with offset per row
      const offset = (rowIdx % 2 === 0) ? 0 : 32;
      const shingleWidths = [48, 64, 40, 56, 72, 48, 56, 64, 64];

      let curX = -offset;
      let wIdx = 0;
      while (curX < 512) {
        const sw = shingleWidths[wIdx % shingleWidths.length];
        // Vertical gap between shingles
        ctx.fillStyle = `${shadowRgb}0.70)`;
        ctx.fillRect(curX, y, 2, courseH - 3);

        // Right side subtle highlight
        ctx.fillStyle = `${highlightRgb}0.30)`;
        ctx.fillRect(curX + 2, y, 1, courseH - 3);

        // Wood grain subtle vertical texture lines inside shingle
        ctx.fillStyle = `${shadowRgb}0.15)`;
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

  const texture = generateSidingTexture(style, colorHex);
  const matConfig = {
    color: new THREE.Color(colorHex || '#8d9299'),
    roughness: opts.roughness ?? 0.82,
    metalness: opts.metalness ?? 0.05,
  };

  if (texture) {
    if (style === 'horizontal_lap' || style === 'board_batten' || style === 'cedar_shingle') {
      texture.repeat.set(1 / 8, 1 / 8);
    }
    matConfig.map = texture;
  }

  const material = new THREE.MeshStandardMaterial(matConfig);
  materialCache.set(cacheKey, material);
  return material;
}

export function clearMaterialCache() {
  for (const mat of materialCache.values()) {
    mat.map?.dispose();
    mat.dispose();
  }
  materialCache.clear();
}
