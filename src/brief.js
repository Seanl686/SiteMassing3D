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
import { filledHomePhotos, unphotographedWalls } from './homephotos.js';

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
export function buildBrief({ home, scene, framing, site, manifest, savedAt, passName, passShoot } = {}) {
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
    if (passShoot) {
      w();
      w(`Where the photograph was taken from: ${passShoot}`);
    }
  }
  w();

  // ---- what this document is for -----------------------------------------
  // Stated in full at the top of every brief. Someone opens this file weeks
  // later, or hands it to a colleague, with none of the context that was in the
  // room when it was exported.
  w(`---`);
  w();
  w(`## What you are making`);
  w();
  w(`**One photorealistic image of ${home.name || 'this home'} standing on this specific lot** —`);
  w(`a picture you could show a buyer and say "this is what your house would look`);
  w(`like here". Not a drawing, not a floor plan, not a catalogue photo: a`);
  w(`photograph of this exact home package, at its real size, on their real land.`);
  w();
  w(`You are not designing anything. The design is already fixed — it is the home`);
  w(`in section 2, whose every dimension and opening was measured off a 3D model`);
  w(`built to the spec sheet. The site is already fixed too; it is the lot photo.`);
  w(`The whole job is to combine two things that already exist, faithfully.`);
  w();
  w(`**This is a repeatable pattern, not a one-off.** The same package structure and`);
  w(`the same wording work for any home on any lot — swap the model, swap the lot`);
  w(`photo, export again. That is the point: a sales conversation about "what would`);
  w(`it look like on my land" should take minutes and give the same quality answer`);
  w(`every time, for every home in the range.`);
  w();

  // ---- the procedure, stated as an order ---------------------------------
  w(`## How to run it — the order matters`);
  w();
  w(`| Step | What you do | Section |`);
  w(`|---|---|---|`);
  w(`| 1 | Attach the files listed below to the image model | 1 |`);
  w(`| 2 | Understand which attachment is the authority on what | 2 |`);
  w(`| 3 | Paste **Turn 1** and let it place the home on the lot | 6 |`);
  w(`| 4 | Check the result against the acceptance list — do not skip this | 7 |`);
  w(`| 5 | Fix what is wrong, **one correction per turn**, re-checking each time | 8 |`);
  w(`| 6 | Only when everything checks out, run **the polish pass** — once, last | 9 |`);
  w();
  w(`**Step 6 is the one people get wrong.** The polish pass is what turns a`);
  w(`correct-but-obviously-composited image into a photograph: it matches colour`);
  w(`temperature, beds the skirting into the ground with contact shadow, softens the`);
  w(`roofline against the sky. It is cosmetic, and it is deliberately LAST.`);
  w(`Polishing an image whose proportions or openings are still wrong just bakes the`);
  w(`error in under a convincing finish — and a convincing wrong picture is worse`);
  w(`than an obviously wrong one, because nobody catches it.`);
  w();
  w(`Never stack changes. One instruction per turn, every turn, including the`);
  w(`polish. Stacked instructions are the reason these models drift.`);
  w();
  w(`---`);
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

  // ---- the two-source rule ------------------------------------------------
  // The single most load-bearing paragraph in the document. Everything else is
  // detail; this is the instruction that decides whether the output is a
  // faithful composite or a redesign.
  w(`## 2. Which attachment is the authority on what`);
  w();
  w(`Three kinds of image are attached and they are **not interchangeable**. Read`);
  w(`each one for the thing it is the authority on, and for nothing else.`);
  w();
  w(`| Image | Authority on | NOT authority on |`);
  w(`|---|---|---|`);
  w(`| **Lot photo** | The site: ground, planting, backdrop, light, camera position | The home |`);
  w(`| **Massing plates** (untextured 3D) | Geometry: size, proportion, roof pitch, where every door and window sits | Colour, material, texture |`);
  w(`| **Home photographs** | Finish: how the real siding, windows, trim and roof LOOK | Size, proportion, placement |`);
  w();
  w(`The plates and the home photographs describe **the same home** and are meant to`);
  w(`be used together, one over the other — the plate is the measured drawing`);
  w(`underneath, the photograph is the finish laid on top. Never choose between`);
  w(`them, and never let one override the other outside its column above.`);

  const photos = home.homePhotos || {};
  const shot = filledHomePhotos(photos);
  const blindWalls = unphotographedWalls(photos);

  if (shot.length) {
    w();
    w(`### Pair each photograph with its plate`);
    w();
    w(`| Photograph of the real home | Shows | Its matching plate |`);
    w(`|---|---|---|`);
    for (const s of shot) {
      w(`| \`40-home-${s.key}.*\` — ${s.name} | ${s.wall ? `the ${WALL_LABEL[s.wall].toLowerCase()}` : 'overall character and colour'} | \`${s.plate}\` |`);
    }
    w();
    w(`For each pair: take the wall's **dimensions and opening positions** from the`);
    w(`plate, and its **appearance** from the photograph. If the photograph seems to`);
    w(`show a window somewhere the plate does not, the plate is right — a photograph`);
    w(`is taken at an angle and foreshortens; the plate is measured.`);
  }

  if (blindWalls.length) {
    w();
    w(`### Walls with no photograph`);
    w();
    const names = blindWalls.map((x) => WALL_LABEL[x].toLowerCase());
    const list = names.length > 1
      ? `${names.slice(0, -1).join(', the ')} or the ${names[names.length - 1]}`
      : names[0];
    w(`There is no photograph of the ${list}. This is normal — a dealer`);
    w(`lot only lets you photograph two or three sides of a home.`);
    w();
    w(`For those walls, the plates and the schedule in section 5 are the complete`);
    w(`and only description, and they are complete on purpose. Extend the same`);
    w(`siding and trim plainly across them, place exactly the openings the schedule`);
    w(`lists, and **invent nothing** — no extra windows, no doors, no features.`);
    w(`Hallucinating a window wall onto an unphotographed gable end is the classic`);
    w(`failure this package is built to prevent.`);
  } else if (!shot.length) {
    w();
    w(`### No photographs of the home are attached`);
    w();
    w(`Then the plates plus the written specification in sections 3 and 4 are the`);
    w(`complete description of this home. Follow them exactly and invent nothing.`);
  }
  w();

  // ---- run it on any model -----------------------------------------------
  w(`### Running this on any image model`);
  w();
  w(`The wording above is deliberately model-agnostic — it names roles, not tools —`);
  w(`so the same package works across generators. Adapt only the mechanics:`);
  w();
  w(`- **Many-image chat models** (Gemini / Nano Banana, ChatGPT, Claude): attach`);
  w(`  everything in section 1 and paste the turns as written. Best fidelity.`);
  w(`- **Two- or three-image editors** (Firefly, most inpainting tools): attach the`);
  w(`  lot photo, the hero massing plate, and the single most useful home`);
  w(`  photograph${shot.length ? ` — the ${shot[0].name.toLowerCase()}` : ''}. Paste the same turns; the tables in`);
  w(`  sections 3 to 5 carry in text what the dropped images would have carried.`);
  w(`- **Prompt-and-reference models** (Midjourney): use the lot photo and the hero`);
  w(`  plate as image references, and compress Turn 1 to the siting, scale and`);
  w(`  finish sentences. Expect more correction turns.`);
  w();
  w(`Whatever the tool, the order in "How to run it" does not change, and the`);
  w(`polish pass stays last.`);
  w();

  // ---- geometry of record ------------------------------------------------
  w(`## 3. The home, as measured`);
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

  w(`## 4. Materials and colours`);
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
  w(`## 5. Opening schedule — including the walls no photo shows`);
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
  w(`## 6. Turn 1 — paste this`);
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
  if (shot.length) {
    w(`> **Use the attached photographs of the real home as the source of truth for`);
    w(`> finish.** Each is named for the wall it shows; reproduce its siding profile`);
    w(`> and colour, window proportions and spacing, trim and roof exactly as`);
    w(`> photographed, on the wall it belongs to. They confirm the written`);
    w(`> specification: ${sidingLabel(d.sidingTexture)} in ${describeColor(c.siding)},`);
    w(`> ${describeColor(c.trim)} trim and window surrounds, ${describeColor(c.roof)} roof,`);
    w(`> ${describeColor(c.door)} doors. Where the two disagree, follow the photograph`);
    w(`> for appearance and the plate for position. Do not redesign or add features.`);
  } else {
    w(`> **No photographs of the home are attached, so this specification is the`);
    w(`> complete description of its finish:** ${sidingLabel(d.sidingTexture)} in`);
    w(`> ${describeColor(c.siding)}, ${describeColor(c.trim)} trim and window surrounds,`);
    w(`> ${describeColor(c.roof)} roof, ${describeColor(c.door)} doors. Follow it exactly`);
    w(`> and do not redesign, restyle, or add features.`);
  }
  if (blindWalls.length) {
    w(`>`);
    w(`> No photograph covers the ${blindWalls.map((x) => WALL_LABEL[x].toLowerCase()).join(' or the ')}.`);
    w(`> Extend the same siding and trim across ${blindWalls.length > 1 ? 'those walls' : 'that wall'} plainly, place exactly the`);
    w(`> openings the schedule lists there, and add nothing that is not in it.`);
  }
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

  // ---- acceptance --------------------------------------------------------
  // The gate before polishing. Written as things to LOOK at, in the order they
  // are cheapest to check, so it can be run in twenty seconds.
  w(`## 7. Check the result before you go any further`);
  w();
  w(`Run this list every time an image comes back. Each failure has a matching`);
  w(`correction in section 8 — fix it there, then check again.`);
  w();
  w(`| # | Look at | It passes when | Fix in 8 |`);
  w(`|---|---|---|---|`);
  w(`| 1 | The echoed dimensions | It said back **${fmtFt(d.widthFt)} × ${fmtFt(d.lengthFt)}** before rendering | re-paste Turn 1 |`);
  w(`| 2 | The footprint | The front wall reads about **${ratio}× as long** as the gable end is wide, clearly not square | Proportion |`);
  w(`| 3 | The walls in view | Openings match the schedule in section 5 — right count, right spacing, none invented | Openings |`);
  w(`| 4 | The roof | ${d.roofStyle === 'flat' ? 'Flat / low slope' : `A ${d.roofPitch}/12 gable with the ridge along the length`}, ${dormers} | Proportion |`);
  w(`| 5 | Where it sits | On ${pad}, nearest corner the ${nearCorner} | Position |`);
  w(`| 6 | How big it reads | Spans about **${x1} to ${x2}** of the image width | Scale |`);
  w(`| 7 | The site | ${keep} unchanged from the lot photo — nothing re-drawn, re-framed or invented | re-paste Turn 1 |`);
  w();
  w(`**All seven pass → go to section 9, the polish pass.** Any one fails → fix`);
  w(`that one thing in section 8, then run this list again. Do not polish first:`);
  w(`the polish makes a wrong image look believable, which is the failure you`);
  w(`cannot recover from because nobody notices it.`);
  w();

  // ---- follow-ups --------------------------------------------------------
  w(`## 8. Corrections — one change per turn, never stacked`);
  w();
  w(`Paste one of these, look at what comes back, run the section 6 list again.`);
  w(`Repeat until it passes. Two corrections in one message is how the model`);
  w(`starts redrawing things you did not ask it to touch.`);
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
  w(`**Fidelity** — when the finish drifts from the specification`);
  w();
  w(`> The home no longer matches its specification. It must be`);
  w(`> ${sidingLabel(d.sidingTexture)} in ${describeColor(c.siding)}, with`);
  w(`> ${describeColor(c.trim)} trim and window surrounds, a ${describeColor(c.roof)} roof`);
  w(`> and ${describeColor(c.door)} doors. Correct the finish and change nothing else`);
  w(`> in the image.`);
  w();

  // ---- the polish pass ---------------------------------------------------
  // Its own section, not a bullet among corrections. It is a different KIND of
  // instruction — cosmetic, once, last — and burying it in a list is what makes
  // people run it early or run it repeatedly.
  w(`## 9. The polish pass — run this ONCE, and only last`);
  w();
  w(`### What it is`);
  w();
  w(`Every step before this one was about being *correct*: right size, right`);
  w(`proportions, right openings, right place on the lot. None of that makes the`);
  w(`picture look real. A correct image still reads as a cut-out — the home carries`);
  w(`its own lighting, sits on the ground instead of in it, and has a hard edge`);
  w(`against the sky.`);
  w();
  w(`The polish pass fixes exactly that and nothing else. It is the difference`);
  w(`between an image that demonstrates a layout and one you can put in front of a`);
  w(`buyer. It changes no geometry, no placement, no site — only how the light,`);
  w(`the contact with the ground and the edges behave.`);
  w();
  w(`### When to run it`);
  w();
  w(`When all seven checks in section 7 pass. Not before.`);
  w();
  w(`Polishing early is the one mistake that cannot be undone by another turn: a`);
  w(`badly proportioned home rendered with convincing light and shadow stops looking`);
  w(`wrong, so the error survives into the picture you show a client. Correctness`);
  w(`first, always. If a check still fails, go back to section 8.`);
  w();
  w(`### Run it once`);
  w();
  w(`One polish turn, then stop. Running it repeatedly compounds the effect — the`);
  w(`shadows deepen, the contrast climbs, and the image drifts away from the lot`);
  w(`photo's real lighting into something that looks retouched.`);
  w();
  w(`### Paste this`);
  w();
  w(`> Final realism pass. Blend the home into the site so the result reads as a`);
  w(`> single photograph rather than a composite:`);
  w(`>`);
  w(`> - Match the home's colour temperature, exposure and contrast to the lot's`);
  w(`>   ${light}.`);
  w(`> - Add soft ambient occlusion and a tight contact shadow where the skirting`);
  w(`>   meets the ground, so the home sits IN the ground rather than on it.`);
  w(`> - Add a cast shadow consistent with that same lighting, falling on the`);
  w(`>   ground the lot photo already shows.`);
  w(`> - Add faint dust, grass or gravel scatter where the base meets the ground,`);
  w(`>   breaking up the hard line.`);
  w(`> - Soften the roof edge against the sky and add the slight atmospheric haze`);
  w(`>   the rest of the photograph has at that distance.`);
  w(`> - Match the photograph's own grain, sharpness and depth of field.`);
  w(`>`);
  w(`> Change nothing about the home's geometry, proportions, openings, colours,`);
  w(`> placement, angle or size, and change nothing about the site. This is a`);
  w(`> lighting and integration pass only.`);
  w();
  w(`### If the polish drifts`);
  w();
  w(`If it moved, resized or redesigned anything, do not polish again on top —`);
  w(`go back to the last good image, correct that one thing in section 8, and run`);
  w(`the polish once more from there.`);
  w();
  w(`> That pass changed more than the lighting. Restore the home's previous`);
  w(`> geometry, proportions, openings, placement and size exactly, and reapply only`);
  w(`> the lighting, contact shadow and edge blending.`);
  w();
  w(`### Done`);
  w();
  w(`That image is the deliverable: ${home.name || 'this home'} at ${fmtFt(d.widthFt)} × ${fmtFt(d.lengthFt)}, on this lot,`);
  w(`at a size and angle measured rather than guessed. Same package, same wording,`);
  w(`next home or next lot — the process does not change.`);
  w();

  if (framing) {
    w(`## 10. Where those framing numbers came from`);
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
