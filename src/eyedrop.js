// Colour sampling off a photograph.
//
// The exterior colours used to be typed in as hex, which means they were
// guessed. A guess is close enough to look wrong: vinyl siding photographs a
// good deal greyer and cooler than the swatch name suggests, and a roof read off
// a catalogue photo by eye lands two shades too light almost every time. The
// photograph of the real home already holds the answer — this reads it out of
// the pixels so the model's finish is one for one with the unit.
//
// DOM-free maths only; the dialog that drives it lives in colorpick.js.

const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

export const rgbToHex = ({ r, g, b }) =>
  `#${[r, g, b].map((v) => clamp255(v).toString(16).padStart(2, '0')).join('')}`;

export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** Rec. 709 luma. Used for ordering a palette dark-to-light, not for contrast. */
export const luma = ({ r, g, b }) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** HSV saturation, 0..1. Cheap, and enough to tell a door colour from siding. */
export function saturation({ r, g, b }) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

/**
 * Average the pixels in a square of side `2 * radius + 1` centred on (x, y).
 *
 * A single pixel is the wrong sample off a photograph: JPEG blocking, sensor
 * noise and the speckle in a shingle all move one pixel several shades away
 * from the colour a person sees. Averaging a small box is what makes two picks
 * on the same wall agree. Fully transparent pixels are skipped so sampling a
 * cutout render does not drag the answer toward black.
 *
 * `data` is RGBA as produced by CanvasRenderingContext2D.getImageData.
 * Returns null when the box lands entirely outside the image or on transparency.
 */
export function sampleAverage(data, width, height, x, y, radius = 2) {
  const cx = Math.round(x);
  const cy = Math.round(y);
  const r = Math.max(0, Math.round(radius));
  let sr = 0, sg = 0, sb = 0, n = 0;
  for (let dy = -r; dy <= r; dy++) {
    const py = cy + dy;
    if (py < 0 || py >= height) continue;
    for (let dx = -r; dx <= r; dx++) {
      const px = cx + dx;
      if (px < 0 || px >= width) continue;
      const i = (py * width + px) * 4;
      if (data[i + 3] < 8) continue;
      sr += data[i]; sg += data[i + 1]; sb += data[i + 2]; n++;
    }
  }
  if (!n) return null;
  return { r: Math.round(sr / n), g: Math.round(sg / n), b: Math.round(sb / n) };
}

/**
 * Pull up to `max` pixels out of an RGBA buffer on a regular stride.
 *
 * Regular rather than random: the palette has to come out the same every time
 * the same photo is opened, or the suggested colours shuffle under the user
 * between one visit and the next.
 */
export function samplePixels(data, width, height, max = 20000) {
  const total = width * height;
  const stride = Math.max(1, Math.floor(total / Math.max(1, max)));
  const out = [];
  for (let i = 0; i < total; i += stride) {
    const p = i * 4;
    if (data[p + 3] < 8) continue;
    out.push([data[p], data[p + 1], data[p + 2]]);
  }
  return out;
}

function boxRange(box) {
  let lo = [255, 255, 255];
  let hi = [0, 0, 0];
  for (const p of box) {
    for (let c = 0; c < 3; c++) {
      if (p[c] < lo[c]) lo[c] = p[c];
      if (p[c] > hi[c]) hi[c] = p[c];
    }
  }
  return [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
}

const within = (p, c, tol) =>
  Math.abs(p[0] - c.r) <= tol && Math.abs(p[1] - c.g) <= tol && Math.abs(p[2] - c.b) <= tol;

/**
 * A colour that is actually IN this box, rather than the average of it.
 *
 * The mean of a median-cut box is the single most tempting thing to return and
 * it is wrong: a box straddling white siding and blue sky averages to a
 * lifeless grey that appears nowhere in the photograph. On a real lot photo
 * every mean-derived entry turned out to match under 2% of the pixels while
 * claiming to represent 13% of them.
 *
 * So: take the per-channel median, which ignores the tail that a mean chases,
 * then re-average only the members close to it. That one mean-shift step
 * settles onto the box's dominant cluster instead of the midpoint between two
 * of them, and the answer is a colour a person can actually point at.
 */
function representative(box, tol) {
  if (!box.length) return null;
  const med = [0, 1, 2].map((ch) => {
    const v = box.map((p) => p[ch]).sort((a, b) => a - b);
    return v[v.length >> 1];
  });
  const seed = { r: med[0], g: med[1], b: med[2] };
  let inliers = box.filter((p) => within(p, seed, tol));
  // A box with no dominant cluster (a smooth gradient) has nothing better to
  // offer than its own middle.
  if (inliers.length < Math.max(4, box.length * 0.05)) inliers = box;
  let r = 0, g = 0, b = 0;
  for (const p of inliers) { r += p[0]; g += p[1]; b += p[2]; }
  const n = inliers.length;
  return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) };
}

/**
 * Median-cut quantisation down to at most `k` colours.
 *
 * Median cut over k-means on purpose: it is deterministic with no seeding, it
 * keeps a small strongly-coloured region (a red door) instead of averaging it
 * into the wall behind it, and at this size it runs in a frame.
 *
 * `tolerance` is how close two colours have to be to count as the same one. It
 * governs both the mean-shift above and the weights, which are measured against
 * the whole image rather than taken from the box sizes — a box holding 13% of
 * the pixels tells you nothing if its colour only matches 0.5% of them, and the
 * UI prints that number as "how much of the photo is this colour".
 */
export function quantize(pixels, k = 8, { tolerance = 22 } = {}) {
  const px = pixels.filter(Boolean);
  if (!px.length) return [];
  let boxes = [px];
  while (boxes.length < k) {
    // Split the box that is widest on any one channel; ties go to the bigger box.
    let target = -1, bestSpread = -1, bestChannel = 0;
    boxes.forEach((box, i) => {
      if (box.length < 2) return;
      const range = boxRange(box);
      const channel = range.indexOf(Math.max(...range));
      const spread = range[channel] * Math.log(box.length + 1);
      if (spread > bestSpread) { bestSpread = spread; target = i; bestChannel = channel; }
    });
    if (target < 0) break;
    const box = boxes[target].slice().sort((a, b) => a[bestChannel] - b[bestChannel]);
    const mid = box.length >> 1;
    const left = box.slice(0, mid);
    const right = box.slice(mid);
    if (!left.length || !right.length) break;
    boxes = [...boxes.slice(0, target), left, right, ...boxes.slice(target + 1)];
  }

  // Two boxes routinely settle on the same cluster once they stop reporting
  // their midpoints; a palette with the same grey in it three times is worse
  // than a shorter one.
  const merged = [];
  for (const box of boxes) {
    const c = representative(box, tolerance);
    if (!c) continue;
    if (!merged.some((m) => within([m.r, m.g, m.b], c, tolerance))) merged.push(c);
  }

  // Weight by assigning every pixel to its nearest representative. Counting
  // "pixels within tolerance" instead would double-count the overlaps and the
  // percentages would sum past 100, which reads as nonsense in a legend.
  const tally = new Array(merged.length).fill(0);
  for (const p of px) {
    let best = 0, bestD = Infinity;
    for (let i = 0; i < merged.length; i++) {
      const c = merged[i];
      const d = (p[0] - c.r) ** 2 + (p[1] - c.g) ** 2 + (p[2] - c.b) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    tally[best]++;
  }

  return merged
    .map((c, i) => ({ ...c, hex: rgbToHex(c), weight: tally[i] / px.length }))
    .sort((a, b) => b.weight - a.weight);
}

// ---------------------------------------------------------------------------
// White balance
//
// A photograph records the light of the day it was taken, not the colour of the
// paint. White siding shot against a bright sky comes back around #a5aaaa, and
// the picker faithfully reports #a5aaaa — correct, and not what anyone means
// when they say the house is white. The eye discounts the illuminant
// automatically and the sensor does not, so the reading looks wrong when it is
// the perception that is doing the work.
//
// The fix is the same one every camera and every colour checker uses: point at
// something known to be neutral and divide it out.
// ---------------------------------------------------------------------------

/** What a white reference is taken to be. Paint is never #ffffff. */
export const REFERENCE_WHITE = 242;

/**
 * Per-channel (von Kries) correction that maps `reference` — a pixel the user
 * has identified as white — onto neutral white, and carries every other colour
 * with it.
 *
 * Returns null for a reference too dark to divide by safely: a black pixel
 * carries no information about the illuminant and would scale everything to
 * clipping.
 */
export function whiteBalanceGains(reference, target = REFERENCE_WHITE) {
  if (!reference) return null;
  const { r, g, b } = reference;
  if (Math.max(r, g, b) < 40) return null;
  return {
    r: target / Math.max(1, r),
    g: target / Math.max(1, g),
    b: target / Math.max(1, b),
  };
}

/** Apply gains from `whiteBalanceGains`. A null gain leaves the colour alone. */
export function applyWhiteBalance(rgb, gains) {
  if (!rgb) return rgb;
  if (!gains) return { ...rgb };
  return {
    r: clamp255(rgb.r * gains.r),
    g: clamp255(rgb.g * gains.g),
    b: clamp255(rgb.b * gains.b),
  };
}

// ---------------------------------------------------------------------------
// Zoom maths
//
// Both of these are pure so the behaviour that decides whether the picker feels
// responsive or feels like it is fighting you can actually be tested.
// ---------------------------------------------------------------------------

/**
 * The pan that keeps the image point under `anchor` under `anchor` after the
 * scale changes.
 *
 * Zooming about the centre of the frame instead of the pointer is the single
 * thing that makes a picker unusable: the pixel being aimed at slides away
 * exactly when it is being aimed at, so every zoom needs a corrective drag.
 *
 * The image is drawn centred, offset by the pan:
 *   ox = (frame.w - image.w * scale) / 2 + pan.x
 * so the image point under the anchor is (anchor.x - ox) / scale, and holding it
 * still is a matter of solving that same equation the other way round.
 */
export function zoomAnchoredPan({ frame, image, scale, pan, nextScale, anchor }) {
  const ax = anchor?.x ?? frame.w / 2;
  const ay = anchor?.y ?? frame.h / 2;
  const ox = (frame.w - image.w * scale) / 2 + pan.x;
  const oy = (frame.h - image.h * scale) / 2 + pan.y;
  const ix = (ax - ox) / scale;
  const iy = (ay - oy) / scale;
  return {
    x: ax - ix * nextScale - (frame.w - image.w * nextScale) / 2,
    y: ay - iy * nextScale - (frame.h - image.h * nextScale) / 2,
  };
}

/**
 * Turn one wheel event into a zoom multiplier that feels the same whatever
 * produced it.
 *
 * A notched mouse wheel sends a single deltaY near 100. A trackpad flick sends
 * a stream of deltas around 2–10. Firefox reports lines (deltaMode 1) rather
 * than pixels. A trackpad pinch arrives as a wheel event with `ctrlKey` set and
 * deltas an order of magnitude smaller again. Counting events instead of
 * scaling by the delta makes one of those hypersensitive and another unusably
 * coarse, which is the usual reason wheel zoom feels wrong.
 *
 * The result is clamped to [0.5, 2] so a flung wheel or a momentum burst cannot
 * teleport the view past the thing being looked for.
 */
export function wheelZoomFactor({ deltaY, deltaMode = 0, ctrlKey = false, pageHeight = 800 }) {
  const unit = deltaMode === 1 ? 16 : deltaMode === 2 ? pageHeight : 1;
  const rate = ctrlKey ? 0.012 : 0.0022;
  const factor = Math.exp(-deltaY * unit * rate);
  return Math.min(2, Math.max(0.5, factor));
}

/**
 * Guess which palette entry is which part of the house.
 *
 * These are opening bids, not answers — the point is that a user who clicks
 * "auto" gets a house that is roughly the right colour in one action and then
 * corrects the two that are wrong, rather than picking nine colours by hand.
 *
 * Roof is the darkest large area, trim the lightest, siding the one covering
 * the most frame that is neither. Doors and skirting fall back to siding-family
 * colours because on most units they are.
 */
/**
 * Whether an entry reads as sky rather than paint.
 *
 * Every exterior photograph of a house has sky in it, and sky is usually both
 * the lightest thing in frame and a large part of it — so without this the
 * trim, which is picked as the lightest colour, comes back as pale blue on
 * essentially every real photo. Sky is light AND markedly blue-dominant;
 * house paint that pale is not that blue.
 */
export const looksLikeSky = (c) => luma(c) > 150 && (c.b - c.r) > 25;

export function suggestFinishRoles(palette) {
  const p = (palette || []).filter((c) => c && typeof c.hex === 'string');
  if (!p.length) return {};

  // Ignore near-black and blown-white slivers: those are shadow and glare.
  const usable = p.filter((c) => {
    const l = luma(c);
    return l > 14 && l < 246;
  });
  const lit = usable.length >= 3 ? usable : p;
  // Drop the sky, but never to the point of having nothing left to assign.
  const grounded = lit.filter((c) => !looksLikeSky(c));
  const pool = grounded.length >= 3 ? grounded : lit;

  const byLuma = [...pool].sort((a, b) => luma(a) - luma(b));
  const roof = byLuma[0];
  const trim = byLuma[byLuma.length - 1];

  const rest = pool.filter((c) => c !== roof && c !== trim);
  const siding = (rest.length ? rest : pool).slice().sort((a, b) => b.weight - a.weight)[0];

  // The most saturated entry that is not already spoken for reads as the door
  // on a surprising number of units; when nothing is saturated, match the trim.
  const colourful = pool
    .filter((c) => c !== roof && c !== trim && c !== siding)
    .sort((a, b) => saturation(b) - saturation(a))[0];

  const out = {
    roof: roof?.hex,
    trim: trim?.hex,
    siding: siding?.hex,
    belowDormerSiding: siding?.hex,
    dormerSiding: siding?.hex,
    gableSiding: siding?.hex,
    skirting: trim?.hex,
    door: (colourful && saturation(colourful) > 0.18 ? colourful.hex : trim?.hex),
  };
  for (const key of Object.keys(out)) if (!out[key]) delete out[key];
  return out;
}
