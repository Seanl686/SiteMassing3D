// The render brief: turns the live model into the text you paste into an image
// model alongside the plates.
//
// This is the piece that closes the loop. The massing plates say what the
// geometry is; the site photo says what the lot is; the brief says, in the
// wording the image models actually respond to, how to combine them — with the
// numbers read off the model rather than typed by hand, which is where the
// original prompt template leaked errors.
//
// DOM-free and three.js-free so it can be unit-tested. Everything the brief
// cannot know — what is on the lot, what to preserve — arrives as `site`.

import { derived, fmtFt } from './build.js';
import { WALL_LABEL } from './defaults.js';

/** Plain-English name for a hex colour, so the prompt reads like a description. */
const NAMED = [
  ['white', 0xf5f5f2], ['off-white', 0xe9e7df], ['light grey', 0xc7ccd1],
  ['medium grey', 0x8d9299], ['slate grey', 0x5b636d], ['charcoal', 0x3a3d42],
  ['black', 0x17191c], ['warm beige', 0xd8c9ab], ['tan', 0xb99f72],
  ['brown', 0x6d543a], ['barn red', 0x8c3a33], ['terracotta', 0xb5603f],
  ['sage green', 0x8a9a7b], ['forest green', 0x3c5140], ['navy blue', 0x2b3a55],
  ['sky blue', 0x7d9dc0], ['steel blue', 0x4d6070], ['cream', 0xf0e6cf],
];

export function colorName(hex) {
  const v = parseInt(String(hex || '').replace('#', ''), 16);
  if (!Number.isFinite(v)) return 'unspecified';
  const r = (v >> 16) & 255, g = (v >> 8) & 255, b = v & 255;
  let best = NAMED[0], bestD = Infinity;
  for (const entry of NAMED) {
    const [, c] = entry;
    const dr = r - ((c >> 16) & 255), dg = g - ((c >> 8) & 255), db = b - (c & 255);
    // Weighted to roughly match perceived difference; exactness is not the point,
    // "charcoal grey" vs "medium grey" is.
    const d = dr * dr * 2 + dg * dg * 4 + db * db;
    if (d < bestD) { bestD = d; best = entry; }
  }
  return best[0];
}

export const describeColor = (hex) => `${colorName(hex)} (${String(hex || '').toLowerCase()})`;

const SIDING_LABEL = {
  horizontal_lap: 'horizontal lap siding',
  board_batten: 'vertical board-and-batten siding',
  cedar_shingle: 'cedar shingle / shake siding',
  smooth: 'smooth vinyl siding',
};

export const sidingLabel = (key) => SIDING_LABEL[key] || SIDING_LABEL.horizontal_lap;

const TYPE_LABEL = { door: 'Door', slider: 'Sliding door', window: 'Window' };

/**
 * Every opening as a flat row, grouped by wall in the app's wall order. The
 * point of this table is the walls no photograph covers — it is the only place
 * the image model can learn that the rear wall has one door and no windows.
 */
export function openingSchedule(home) {
  const order = ['front', 'back', 'left', 'right'];
  const rows = [];
  for (const wall of order) {
    const units = (home.openings || [])
      .filter((o) => o.wall === wall)
      .sort((a, b) => a.offsetFt - b.offsetFt);
    for (const o of units) {
      rows.push({
        wall,
        wallLabel: WALL_LABEL[wall] || wall,
        type: TYPE_LABEL[o.type] || o.type,
        label: o.label || '',
        offsetFt: o.offsetFt,
        widthFt: o.widthFt,
        heightFt: o.heightFt,
        sillFt: o.sillFt,
      });
    }
  }
  return rows;
}

/** One-line summary of a wall's openings, for the per-wall prose. */
export function wallSummary(home, wall) {
  const units = (home.openings || []).filter((o) => o.wall === wall);
  if (!units.length) return 'blank — no doors, no windows';
  const doors = units.filter((o) => o.type === 'door').length;
  const sliders = units.filter((o) => o.type === 'slider').length;
  const windows = units.filter((o) => o.type === 'window').length;
  const bits = [];
  if (doors) bits.push(`${doors} entry door${doors > 1 ? 's' : ''}`);
  if (sliders) bits.push(`${sliders} sliding door${sliders > 1 ? 's' : ''}`);
  if (windows) bits.push(`${windows} window${windows > 1 ? 's' : ''}`);
  return bits.join(', ');
}

/** Lighting language derived from the sun/overcast controls, not typed by hand. */
export function describeLighting(scene) {
  const flat = scene?.flat ?? 0.6;
  if (flat >= 0.8) return 'flat overcast daylight, no hard shadows';
  if (flat >= 0.45) return 'soft hazy daylight with gentle, low-contrast shadows';
  const az = scene?.sunAz ?? 135;
  const el = scene?.sunEl ?? 42;
  // Azimuth 0 puts the sun behind the home (+Z, the rear); 180 is in front.
  const side = az > 180 ? 'from the right' : 'from the left';
  const height = el > 55 ? 'high' : el > 25 ? 'mid-height' : 'low, late-afternoon';
  return `direct ${height} sun ${side}, with defined cast shadows`;
}

const pct = (v) => `${Math.round(v * 100)}%`;

/**
 * Everything the brief states about the finished picture. `framing` comes from
 * measuring the live camera (see framing.js) — when it is absent, the brief
 * falls back to the blanks the user filled in, and says so.
 */
export function buildBrief({ home, scene, framing, site, manifest, savedAt, passName } = {}) {
  if (!home || !home.dimensions) throw new Error('buildBrief needs a home');
  const d = home.dimensions;
  const dv = derived(d);
  const c = home.colors || {};
  const s = site || {};
  const ratio = (d.lengthFt / d.widthFt).toFixed(2);

  const nearCorner = s.nearCorner || framing?.nearCorner || 'front-right corner';
  const pad = s.pad || 'the level pad in the middle of the lot';
  const landmark = s.landmark || '{{LANDMARK — name something in the lot photo}}';
  const keep = s.keep || 'the ground, vegetation, trees, sky and every built structure already in frame';
  const heightRef = s.heightRef || '{{HEIGHT_REF — name a height reference in the lot photo}}';
  const light = s.light || describeLighting(scene);
  const x1 = framing ? pct(framing.left) : '{{X1}}';
  const x2 = framing ? pct(framing.right) : '{{X2}}';
  const ridgeLine = framing
    ? `its roof ridge reaches about ${pct(framing.ridgeTop)} of the way up the frame (measured from the bottom edge)`
    : `its roof ridge reaches about the height of ${heightRef}`;

  const skirtLine = `white ribbed vinyl skirting continuous around the visible perimeter, meeting the ground with a soft contact shadow`;
  const stepsLine = scene?.steps
    ? 'Steps at each exterior door' + (scene.stepLanding ? ' with a top landing platform' : '') + '.'
    : 'No steps or landings at the doors.';

  const dormers = (parseInt(d.dormerCount, 10) || 0) > 0
    ? `${d.dormerCount} gable dormer${d.dormerCount > 1 ? 's' : ''} on the front roof slope`
    : 'no dormers';

  const L = [];
  const w = (line = '') => L.push(line);

  w(`# Site render brief — ${home.name || 'Untitled model'}${passName ? ` · ${passName}` : ''}`);
  w();
  w(`Generated by SiteMassing3D${savedAt ? ` on ${savedAt}` : ''}. Every number below is`);
  w(`measured off the 3D massing model in the attached plates, not typed by hand.`);
  if (passName) {
    w();
    w(`This is the **${passName}** pass — one lot photo, shot from one position, and`);
    w(`the massing plate framed to match it. Other passes in this package use`);
    w(`different photos and different camera positions; do not mix their files.`);
  }
  w();

  // ---- attachments -------------------------------------------------------
  w(`## 1. Attach these files, in this order`);
  w();
  if (manifest && manifest.length) {
    for (const m of manifest) w(`${m.index}. \`${m.file}\` — ${m.role}`);
  } else {
    // Standalone brief — no package was built, so name the roles rather than
    // the filenames, which do not exist yet.
    w(`1. The lot photo — the source of truth for the site. Do not re-render it.`);
    w(`2. The massing plate framed to match that photo — match its placement, angle and size.`);
    w(`3. The elevation plates — geometry reference only, not views to render.`);
    w(`4. The site plan / spec sheet page, as a PNG.`);
  }
  w();
  w(`Attach the site plan as a **PNG, not a PDF** — most image models ignore PDF`);
  w(`attachments outright. The package already contains the converted page.`);
  w();
  w(`**Produce ONE image.** There is one lot photo, taken from one position, and`);
  w(`one massing plate framed to match it — that pair is the render. The contact`);
  w(`sheet, the elevations and the roof plan are **geometry references**: read the`);
  w(`home's proportions, roof and opening positions off them, but do not render`);
  w(`them as separate views and do not composite them onto the lot. Rendering a`);
  w(`view the lot photo was not shot from is the single most common failure here.`);
  w();

  // ---- geometry of record ------------------------------------------------
  w(`## 2. The home, as measured`);
  w();
  w(`| Property | Value |`);
  w(`|---|---|`);
  w(`| Model | ${home.name || 'Untitled'} |`);
  w(`| Footprint | ${fmtFt(d.widthFt)} wide × ${fmtFt(d.lengthFt)} long |`);
  w(`| Front-wall to gable-end ratio | **${ratio} : 1** — the front wall must read ${ratio}× as long as the end wall is wide |`);
  w(`| Wall height | ${fmtFt(d.wallHeightFt)} |`);
  w(`| Floor deck above grade | ${fmtFt(d.floorHeightFt)} |`);
  w(`| Roof | ${d.roofStyle === 'flat' ? 'flat / low slope' : `${d.roofPitch}/12 gable, ridge running along the length`} |`);
  w(`| Eave height above grade | ${fmtFt(dv.eaveY)} |`);
  w(`| Ridge height above grade | ${fmtFt(dv.ridgeY)} |`);
  w(`| Dormers | ${dormers} |`);
  w();

  w(`## 3. Materials and colours`);
  w();
  w(`| Element | Finish |`);
  w(`|---|---|`);
  w(`| Main siding | ${sidingLabel(d.sidingTexture)}, ${describeColor(c.siding)} |`);
  if (c.gableSiding && c.gableSiding !== c.siding) {
    w(`| Gable end accent | ${sidingLabel(d.gableSidingTexture)}, ${describeColor(c.gableSiding)} |`);
  }
  if ((parseInt(d.dormerCount, 10) || 0) > 0) {
    w(`| Dormer siding | ${sidingLabel(d.dormerSidingTexture)}, ${describeColor(c.dormerSiding)} |`);
  }
  w(`| Trim and window surrounds | ${describeColor(c.trim)} |`);
  w(`| Roof | ${describeColor(c.roof)} |`);
  w(`| Skirting | ${describeColor(c.skirting)} |`);
  w(`| Doors | ${describeColor(c.door)} |`);
  w(`| Glass | ${describeColor(c.glass)} |`);
  if (d.cornerTrim !== false) {
    w(`| Corner boards | ${Math.round((d.cornerTrimWidthFt ?? 0.5) * 12)}" vertical corner trim, ${colorName(c.trim)} |`);
  }
  w();

  // ---- opening schedule --------------------------------------------------
  w(`## 4. Opening schedule — including the walls no photo shows`);
  w();
  w(`Offsets run left→right as you face each wall from outside; sills are measured`);
  w(`above the floor deck, not above grade.`);
  w();
  w(`| Wall | Type | Label | Offset | Width | Height | Sill |`);
  w(`|---|---|---|---|---|---|---|`);
  for (const r of openingSchedule(home)) {
    w(`| ${r.wallLabel} | ${r.type} | ${r.label} | ${fmtFt(r.offsetFt)} | ${fmtFt(r.widthFt)} | ${fmtFt(r.heightFt)} | ${fmtFt(r.sillFt)} |`);
  }
  w();
  w(`Per wall: **front** — ${wallSummary(home, 'front')}. **rear** — ${wallSummary(home, 'back')}.`);
  w(`**left end** — ${wallSummary(home, 'left')}. **right end** — ${wallSummary(home, 'right')}.`);
  w();

  // ---- turn 1 ------------------------------------------------------------
  w(`## 5. Turn 1 — paste this`);
  w();
  w(`> A photograph of the manufactured home shown in the massing plates, sited on`);
  w(`> the empty lot from the lot photo.`);
  w(`>`);
  w(`> **The home is ${fmtFt(d.widthFt)} wide by ${fmtFt(d.lengthFt)} long.** Before rendering, state those`);
  w(`> two dimensions back to me so I can confirm you read them. The front wall`);
  w(`> must read **${ratio}× as long** as the gable end wall is wide — not close to square.`);
  w(`>`);
  w(`> **Use the massing plates as the source of truth for geometry.** They are a`);
  w(`> clean untextured 3D model of this exact home: footprint proportion, roof`);
  w(`> pitch (${d.roofPitch}/12), eave and ridge heights, and the position of every door and`);
  w(`> window on all four walls. Reproduce that geometry exactly. Where a wall is`);
  w(`> not visible in any photograph, follow the plates — do not invent openings.`);
  w(`>`);
  w(`> Match the camera of the **hero plate** — it is framed from the same position`);
  w(`> as the lot photo. The elevations and the contact sheet are measurements to`);
  w(`> read, not viewpoints to render. Return a single image from the lot photo's`);
  w(`> own camera position.`);
  w(`>`);
  w(`> **Use the home photos (if attached) as the source of truth for finish**, and`);
  w(`> otherwise use this specification: ${sidingLabel(d.sidingTexture)} in`);
  w(`> ${describeColor(c.siding)}, ${describeColor(c.trim)} trim and window surrounds,`);
  w(`> ${describeColor(c.roof)} roof, ${describeColor(c.door)} doors.`);
  w(`> Do not redesign, restyle, or add features.`);
  w(`>`);
  if (s.backdrop === 'panorama') {
    // The plate is a view out of a 360 wrapped around the site, so the lot is
    // already behind the home in the correct perspective. Saying so changes the
    // job from "composite two plates" to "photographise one".
    w(`> **The lot is already behind the home in the hero plate.** That plate is a`);
    w(`> view out of a 360 panorama shot from the middle of the pad, so the`);
    w(`> perspective, the horizon and the surroundings are the real site at the`);
    w(`> real angle. Keep ${keep} exactly as they appear there — do not re-render,`);
    w(`> re-frame or redraw the ground or the vegetation. Your job is to turn the`);
    w(`> untextured massing into a photographed home inside that scene.`);
  } else {
    w(`> **Use the lot photo as the source of truth for the site.** Keep ${keep}`);
    w(`> exactly as photographed — same camera position, same framing, same`);
    w(`> perspective. Do not re-render the ground or the vegetation.`);
  }
  w(`>`);
  w(`> Siting: place the home on ${pad}, angled so the camera sees the long front`);
  w(`> wall receding and the short gable end wall facing the camera. The nearest`);
  w(`> point to the camera is the ${nearCorner}. The far end of the home sits beside`);
  w(`> ${landmark}.`);
  w(`>`);
  w(`> Scale: the home spans roughly ${x1} to ${x2} of the image width, and ${ridgeLine}.`);
  w(`>`);
  w(`> Finish: ${skirtLine}. ${stepsLine}`);
  w(`>`);
  w(`> Lighting: relight the home to match the lot's ${light}. Neutralize any`);
  w(`> sunlight direction, blue sky reflection, or colour cast carried over from`);
  w(`> the plates or the home photos.`);
  if (s.notes) {
    w(`>`);
    w(`> ${String(s.notes).split('\n').join('\n> ')}`);
  }
  w();

  // ---- follow-ups --------------------------------------------------------
  w(`## 6. Follow-up turns — one change per turn, never stacked`);
  w();
  w(`**Scale**`);
  w();
  w(`> Resize the home so its front wall spans ${x1} to ${x2} of the image width and`);
  w(`> ${ridgeLine}. Do not change the angle, the position on the lot, the home's`);
  w(`> design, or the site.`);
  w();
  w(`**Angle**`);
  w();
  w(`> Rotate the home {{N}} degrees {{clockwise|counter-clockwise}} so`);
  w(`> {{more|less}} of the gable end wall faces the camera. Keep its size, its`);
  w(`> position on ${pad}, the home's design, and the site identical.`);
  w();
  w(`**Proportion correction** — when the footprint ratio drifts`);
  w();
  w(`> The footprint is wrong. The home is ${fmtFt(d.widthFt)} × ${fmtFt(d.lengthFt)}, so the front wall`);
  w(`> must read about ${ratio}× as long as the gable end wall is wide. Stretch the`);
  w(`> front wall to that ratio without changing the roof height, the angle, the`);
  w(`> position, the home's design, or the site.`);
  w();
  w(`**Opening correction** — when a wall grows or loses openings`);
  w();
  w(`> The openings are wrong. Per the massing plates: front wall — ${wallSummary(home, 'front')};`);
  w(`> rear wall — ${wallSummary(home, 'back')}; left gable end — ${wallSummary(home, 'left')};`);
  w(`> right gable end — ${wallSummary(home, 'right')}. Correct the visible walls to match`);
  w(`> and change nothing else in the image.`);
  w();
  w(`**Position**`);
  w();
  w(`> Move the home {{left|right|further back|closer}} so that`);
  w(`> {{LANDMARK_RELATION}}. Keep its size, angle, design, and the site identical.`);
  w();
  w(`**Final realism pass** — last turn only`);
  w();
  w(`> Blend the home into the site: match the lot's colour temperature and`);
  w(`> contrast, add soft ambient occlusion where the skirting meets the ground,`);
  w(`> add a cast shadow consistent with the lot's ${light}, add faint dust or`);
  w(`> gravel scatter at the base, and soften the roof edge against the sky.`);
  w(`> Change nothing about the home's geometry, placement, or the site.`);
  w();

  if (framing) {
    w(`## 7. Where those framing numbers came from`);
    w();
    w(`Measured by projecting the model's bounding box through the ${framing.viewLabel || 'current'}`);
    w(`camera at export time:`);
    w();
    w(`- Home spans **${x1} to ${x2}** of the frame width (${pct(framing.right - framing.left)} of the image).`);
    w(`- Roof ridge sits at **${pct(framing.ridgeTop)}** of the frame height from the bottom.`);
    w(`- Nearest corner to the camera: **${framing.nearCorner}**.`);
    if (framing.visibleWalls?.length) {
      w(`- Walls the camera can see: ${framing.visibleWalls.join(', ')}.`);
    }
    w();
    w(`If you re-frame the plate in the app, regenerate this brief — these numbers`);
    w(`move with the camera.`);
  }

  return L.join('\n');
}
