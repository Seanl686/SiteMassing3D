// Parametric double-wide massing builder.
//
// World axes: +X runs along the home's LENGTH, +Z along its WIDTH, +Y is up.
// The long front wall faces -Z; the gable ends are the short walls at +/-X.
// Ground is y = 0, floor deck sits at y = floorHeightFt.

import * as THREE from 'three';

const WALL_THICK = 0.5;   // ft
const TRIM_W = 0.28;      // ft, casing width around openings
const TRIM_PROUD = 0.06;  // ft, how far casing stands off the siding
const GLASS_INSET = 0.16; // ft, how far glass/door slab sits back from the face
const ROOF_THICK = 0.45;  // ft
const FASCIA_H = 0.55;    // ft

/**
 * Wall frames, each expressed as an origin at the wall's bottom-left corner as
 * seen from OUTSIDE, a unit "right" vector along the wall, and an outward normal.
 * Opening offsets are measured along `right` from that corner, so they read the
 * same way you'd pace them off standing in front of the wall.
 */
export function wallFrames(dim) {
  const { widthFt: W, lengthFt: L, floorHeightFt: F } = dim;
  return {
    front: { origin: new THREE.Vector3( L / 2, F, -W / 2), right: new THREE.Vector3(-1, 0, 0), normal: new THREE.Vector3(0, 0, -1), span: L, gable: false },
    back:  { origin: new THREE.Vector3(-L / 2, F,  W / 2), right: new THREE.Vector3( 1, 0, 0), normal: new THREE.Vector3(0, 0,  1), span: L, gable: false },
    left:  { origin: new THREE.Vector3(-L / 2, F, -W / 2), right: new THREE.Vector3( 0, 0, 1), normal: new THREE.Vector3(-1, 0, 0), span: W, gable: true },
    right: { origin: new THREE.Vector3( L / 2, F,  W / 2), right: new THREE.Vector3( 0, 0,-1), normal: new THREE.Vector3( 1, 0, 0), span: W, gable: true },
  };
}

/** Matrix that maps wall-local (u, v, depth-inward) coordinates into world space. */
function frameMatrix(frame) {
  const x = frame.right.clone();
  const y = new THREE.Vector3(0, 1, 0);
  const z = frame.normal.clone().negate(); // extrude inward, exterior face on the plane
  return new THREE.Matrix4().makeBasis(x, y, z).setPosition(frame.origin);
}

// ---------------------------------------------------------------------------
// Roof profile: asymmetric slopes and per-section roofs
//
// The roof is described as a list of SECTIONS laid end to end along the length
// (+X). Each section owns its own cross-section: a front slope, a back slope, a
// ridge line that can sit off-center, and an optional vertical step at the ridge
// so one plane peaks higher than the other. A section can also carry its own
// eave (wall) heights, so one part of the home can sit taller than the next.
//
// With no sections declared and the asymmetric switch off, the whole thing
// collapses to the original symmetric gable: one pitch, ridge on center.
// ---------------------------------------------------------------------------

/** Read a numeric field, falling back when it is absent, blank or unparseable. */
export function num(v, fallback) {
  if (v === null || v === undefined || v === '') return fallback;
  const n = +v;
  return Number.isFinite(n) ? n : fallback;
}

export const ROOF_STYLES = ['gable', 'shed', 'shedFront', 'flat'];

export const ROOF_STYLE_LABEL = {
  gable: 'Gable (two slopes)',
  shed: 'Shed — high at back',
  shedFront: 'Shed — high at front',
  flat: 'Flat / low slope',
};

/** The whole-home roof values a section inherits when it does not override them. */
export function roofDefaults(dim) {
  const asym = !!dim.asymmetricRoof;
  const base = num(dim.roofPitch, 4);
  return {
    frontPitch: asym ? num(dim.frontPitch, base) : base,
    backPitch: asym ? num(dim.backPitch, base) : base,
    ridgeOffsetFt: asym ? num(dim.ridgeOffsetFt, 0) : 0,
    ridgeStepFt: asym ? num(dim.ridgeStepFt, 0) : 0,
    frontWallHeightFt: getWallHeight('front', dim),
    backWallHeightFt: getWallHeight('back', dim),
    roofStyle: ROOF_STYLES.includes(dim.roofStyle) ? dim.roofStyle : 'gable',
  };
}

/**
 * Solve one section's cross-section into world-space geometry.
 *
 * `frontEdgeZ`/`backEdgeZ` are the wall lines; `ridgeZ` is where the two planes
 * meet. `frontPeakY` and `backPeakY` are the top-of-deck heights each plane
 * reaches at the ridge — they differ whenever the pitches, the eave heights or
 * the ridge step differ, and that difference is the clerestory the user asked
 * for.
 */
function solveSection(spec, index, startFt, endFt, dim, inherit) {
  const L = num(dim.lengthFt, 56);
  const W = num(dim.widthFt, 27);
  const F = num(dim.floorHeightFt, 0);

  const roofStyle = ROOF_STYLES.includes(spec.roofStyle) ? spec.roofStyle : inherit.roofStyle;
  const secPitch = spec.pitch;
  const frontPitch = Math.max(0, num(spec.frontPitch, num(secPitch, inherit.frontPitch)));
  const backPitch = Math.max(0, num(spec.backPitch, num(secPitch, inherit.backPitch)));
  const ridgeStepFt = num(spec.ridgeStepFt, inherit.ridgeStepFt);
  const ridgeOffsetFt = num(spec.ridgeOffsetFt, inherit.ridgeOffsetFt);
  const frontWallHeightFt = Math.max(0.5, num(spec.frontWallHeightFt, inherit.frontWallHeightFt));
  const backWallHeightFt = Math.max(0.5, num(spec.backWallHeightFt, inherit.backWallHeightFt));

  const frontEdgeZ = -W / 2;
  const backEdgeZ = W / 2;
  let frontEaveY = F + frontWallHeightFt;
  let backEaveY = F + backWallHeightFt;
  let ridgeZ = 0;
  let frontPeakY;
  let backPeakY;

  if (roofStyle === 'flat') {
    // A flat deck cannot sit on two different wall heights; the taller wins and
    // the short wall grows up to meet it.
    const y = Math.max(frontEaveY, backEaveY);
    frontEaveY = backEaveY = y;
    frontPeakY = backPeakY = y;
  } else if (roofStyle === 'shed') {
    // One plane, high edge at the back wall — the back wall grows to meet it.
    ridgeZ = backEdgeZ;
    frontPeakY = frontEaveY + W * (frontPitch / 12);
    backEaveY = backPeakY = frontPeakY;
  } else if (roofStyle === 'shedFront') {
    ridgeZ = frontEdgeZ;
    backPeakY = backEaveY + W * (backPitch / 12);
    frontEaveY = frontPeakY = backPeakY;
  } else {
    // Gable. The ridge may be shifted off center, which alone makes one plane
    // longer than the other; the pitches then set how high each one climbs.
    const lim = Math.max(0, W / 2 - 0.5);
    ridgeZ = Math.max(-lim, Math.min(lim, ridgeOffsetFt));
    frontPeakY = frontEaveY + (ridgeZ - frontEdgeZ) * (frontPitch / 12);
    backPeakY = backEaveY + (backEdgeZ - ridgeZ) * (backPitch / 12) + ridgeStepFt;
    backPeakY = Math.max(backEaveY, backPeakY);
  }

  const frontRun = ridgeZ - frontEdgeZ;
  const backRun = backEdgeZ - ridgeZ;

  return {
    id: spec.id || `sec${index}`,
    index,
    label: spec.label || '',
    startFt,
    endFt,
    x0: -L / 2 + startFt,
    x1: -L / 2 + endFt,
    roofStyle,
    frontPitch,
    backPitch,
    ridgeOffsetFt,
    ridgeStepFt,
    frontWallHeightFt,
    backWallHeightFt,
    frontEdgeZ,
    backEdgeZ,
    ridgeZ,
    frontEaveY,
    backEaveY,
    frontPeakY,
    backPeakY,
    peakY: Math.max(frontPeakY, backPeakY),
    // Effective slopes — what the plane actually does once the ridge step and
    // the eave heights have had their say. These, not the typed pitch, drive
    // every piece of geometry below.
    frontSlope: frontRun > 0.01 ? (frontPeakY - frontEaveY) / frontRun : 0,
    backSlope: backRun > 0.01 ? (backPeakY - backEaveY) / backRun : 0,
    frontRun,
    backRun,
  };
}

/**
 * Normalise `dim.roofSections` into an ordered, gap-free list covering the whole
 * length. Sections are declared by their start offset from the left end; the
 * first is pinned to 0 and the last runs out to the far end.
 */
export function resolveRoofSections(dim) {
  const L = num(dim.lengthFt, 56);
  const inherit = roofDefaults(dim);
  const raw = (Array.isArray(dim.roofSections) ? dim.roofSections : [])
    .filter((s) => s && typeof s === 'object')
    .map((s) => ({ ...s, startFt: Math.max(0, Math.min(L, num(s.startFt, 0))) }))
    .sort((a, b) => a.startFt - b.startFt);

  const kept = [];
  for (const s of raw) {
    // Anything under a foot wide is a slip of the mouse, not a roof section.
    if (kept.length && s.startFt - kept[kept.length - 1].startFt < 1) continue;
    if (kept.length && L - s.startFt < 1) continue;
    kept.push(s);
  }
  if (!kept.length) kept.push({});
  kept[0] = { ...kept[0], startFt: 0 };

  return kept.map((s, i) =>
    solveSection(s, i, s.startFt, i + 1 < kept.length ? kept[i + 1].startFt : L, dim, inherit));
}

/** Top-of-deck height of a section's roof at world Z, overhangs included. */
export function roofTopAt(sec, z) {
  if (sec.roofStyle === 'flat') return sec.peakY;
  if (z <= sec.ridgeZ) return sec.frontEaveY + (z - sec.frontEdgeZ) * sec.frontSlope;
  return sec.backPeakY - (z - sec.ridgeZ) * sec.backSlope;
}

export function sectionAtX(sections, x) {
  return sections.find((s) => x >= s.x0 - 1e-6 && x <= s.x1 + 1e-6) || sections[0];
}

export function derived(dim) {
  const sections = resolveRoofSections(dim);
  const first = sections[0];
  // The legacy trio stays put: `slope`/`eaveY`/`angle` still describe the plain
  // symmetric roof, which is what the dormer and camera code grew up on.
  const slope = dim.roofStyle === 'flat' ? 0 : num(dim.roofPitch, 4) / 12;
  const eaveY = num(dim.floorHeightFt, 0) + num(dim.wallHeightFt, 8);
  const ridgeY = sections.reduce((m, s) => Math.max(m, s.peakY), -Infinity);
  const lowY = sections.reduce((m, s) => Math.min(m, s.frontEaveY, s.backEaveY), Infinity);
  return {
    slope,
    eaveY,
    ridgeY,
    angle: Math.atan(slope),
    sections,
    lowEaveY: lowY,
    frontEaveY: first.frontEaveY,
    backEaveY: first.backEaveY,
    frontPeakY: first.frontPeakY,
    backPeakY: first.backPeakY,
    frontSlope: first.frontSlope,
    backSlope: first.backSlope,
    ridgeZ: first.ridgeZ,
    asymmetric: sections.length > 1 || Math.abs(first.frontPeakY - first.backPeakY) > 0.02
      || Math.abs(first.frontSlope - first.backSlope) > 1e-4,
  };
}

function rectShape(w, h, x = 0, y = 0) {
  const s = new THREE.Shape();
  s.moveTo(x, y);
  s.lineTo(x + w, y);
  s.lineTo(x + w, y + h);
  s.lineTo(x, y + h);
  s.closePath();
  return s;
}

function rectPath(w, h, x, y) {
  const p = new THREE.Path();
  p.moveTo(x, y);
  p.lineTo(x + w, y);
  p.lineTo(x + w, y + h);
  p.lineTo(x, y + h);
  p.closePath();
  return p;
}

function extrude(shape, depth) {
  return new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 4 });
}

function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness: opts.roughness ?? 0.92,
    metalness: opts.metalness ?? 0.0,
    side: opts.side ?? THREE.FrontSide,
    transparent: opts.transparent ?? false,
    opacity: opts.opacity ?? 1,
    flatShading: false,
  });
}

/** The per-wall height override, or null when that wall just follows the base. */
function customWallHeight(name, dim) {
  if (!dim) return null;
  const v = dim[`${name}WallHeightFt`];
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

export function getWallHeight(name, dim) {
  if (!dim) return 8.0;
  return customWallHeight(name, dim) ?? (dim.wallHeightFt || 8.0);
}

/** Drop points that repeat their neighbour, which extrusion dislikes. */
function dedupeProfile(pts) {
  const out = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.u - p.u) < 1e-6 && Math.abs(last.h - p.h) < 1e-6) continue;
    out.push(p);
  }
  return out;
}

/**
 * The top edge of a wall, as `{u, h}` points running from `u = 0` to the far end
 * of the span, with `h` measured up from the floor deck.
 *
 * The long walls step wherever two roof sections meet at different eave heights.
 * The gable ends trace the roof cross-section itself, so an off-center ridge or
 * a stepped peak shows up in the end wall exactly as it does in the roof. Two
 * points sharing a `u` are a vertical step.
 */
export function wallTopProfile(name, dim) {
  const F = num(dim.floorHeightFt, 0);
  const L = num(dim.lengthFt, 56);
  const W = num(dim.widthFt, 27);
  const sections = resolveRoofSections(dim);

  if (name === 'front' || name === 'back') {
    const key = name === 'front' ? 'frontEaveY' : 'backEaveY';
    const segs = sections
      .map((s) => ({
        // The front wall is walked right-to-left in world X, so its u axis runs
        // opposite the section order.
        u0: name === 'front' ? L / 2 - s.x1 : s.x0 + L / 2,
        u1: name === 'front' ? L / 2 - s.x0 : s.x1 + L / 2,
        h: s[key] - F,
      }))
      .sort((a, b) => a.u0 - b.u0);
    const pts = [];
    for (const s of segs) {
      pts.push({ u: s.u0, h: s.h });
      pts.push({ u: s.u1, h: s.h });
    }
    pts[0].u = 0;
    pts[pts.length - 1].u = L;
    return dedupeProfile(pts);
  }

  const sec = name === 'left' ? sections[0] : sections[sections.length - 1];
  // An explicit end-wall height overrides both corners, exactly as it did before
  // this file learned about asymmetry; the gable above it keeps the roof's shape.
  const override = customWallHeight(name, dim);
  const baseFront = override ?? sec.frontEaveY - F;
  const baseBack = override ?? sec.backEaveY - F;

  if (sec.roofStyle === 'flat') {
    const flat = [{ u: 0, h: baseFront }, { u: W, h: baseBack }];
    return name === 'left' ? flat : [{ u: 0, h: baseBack }, { u: W, h: baseFront }];
  }

  // Left wall u runs front -> back; the ridge lands at u = ridgeZ + W/2.
  const uRidge = Math.max(0, Math.min(W, sec.ridgeZ + W / 2));
  const leftPts = [
    { u: 0, h: baseFront },
    { u: uRidge, h: baseFront + (sec.frontPeakY - sec.frontEaveY) },
    { u: uRidge, h: baseBack + (sec.backPeakY - sec.backEaveY) },
    { u: W, h: baseBack },
  ];
  if (name === 'left') return dedupeProfile(leftPts);
  return dedupeProfile(leftPts.map((p) => ({ u: W - p.u, h: p.h })).reverse());
}

/** Wall height at a single point along the span, taking the low side of a step. */
function profileHeightAt(pts, u) {
  if (u <= pts[0].u) return pts[0].h;
  const last = pts[pts.length - 1];
  if (u >= last.u) return last.h;
  let h = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (u < a.u || u > b.u) continue;
    h = Math.min(h, Math.abs(b.u - a.u) < 1e-6 ? Math.min(a.h, b.h)
      : a.h + ((u - a.u) / (b.u - a.u)) * (b.h - a.h));
  }
  return Number.isFinite(h) ? h : last.h;
}

/** Lowest headroom the wall offers anywhere between two points along the span. */
export function wallHeightAt(name, dim, u0 = -Infinity, u1 = Infinity) {
  const pts = wallTopProfile(name, dim);
  let h = Math.min(profileHeightAt(pts, u0), profileHeightAt(pts, u1));
  for (const p of pts) {
    if (p.u > u0 && p.u < u1) h = Math.min(h, p.h);
  }
  return h;
}

/** Clamp an opening so it always fits inside its wall and under the eave. */
export function clampOpening(o, dim) {
  const frames = wallFrames(dim);
  const f = frames[o.wall] || frames.front;
  const maxW = Math.max(0.5, f.span - 2 * TRIM_W);
  o.widthFt = Math.min(Math.max(0.5, o.widthFt), maxW);
  o.offsetFt = Math.min(Math.max(TRIM_W, o.offsetFt), f.span - o.widthFt - TRIM_W);
  // Measure the roof line over the span this opening actually covers, so a low
  // section elsewhere on the wall does not shrink a window standing under a
  // tall one.
  const wallH = wallHeightAt(o.wall, dim, o.offsetFt, o.offsetFt + o.widthFt);
  o.heightFt = Math.min(Math.max(0.5, o.heightFt), Math.max(0.5, wallH - 0.4));
  if (o.type === 'door' || o.type === 'slider') {
    o.sillFt = 0;
  } else {
    o.sillFt = Math.min(Math.max(0, o.sillFt), Math.max(0, wallH - o.heightFt - 0.2));
  }
  return o;
}

// ---------------------------------------------------------------------------
// Walls
// ---------------------------------------------------------------------------

function buildWall(name, frame, home, materials) {
  const dim = home.dimensions;
  const span = frame.span;
  const top = wallTopProfile(name, dim);

  // Bottom edge left to right, then the roof line walked back the other way —
  // steps, gables and off-center ridges all arrive as points in that profile.
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(span, 0);
  for (let i = top.length - 1; i >= 0; i--) shape.lineTo(top[i].u, top[i].h);
  shape.closePath();

  const openings = home.openings.filter((o) => o.wall === name);
  for (const o of openings) {
    shape.holes.push(rectPath(o.widthFt, o.heightFt, o.offsetFt, o.sillFt));
  }

  const group = new THREE.Group();
  group.name = `wall:${name}`;

  const wall = new THREE.Mesh(extrude(shape, WALL_THICK), materials.siding);
  wall.castShadow = true;
  wall.receiveShadow = true;
  wall.userData.wall = name;
  group.add(wall);

  for (const o of openings) {
    const og = buildOpening(o, materials);
    // Tag every child so a click anywhere on the assembly selects the opening.
    og.traverse((c) => { c.userData.opening = o.id; c.userData.wall = c.userData.wall || name; });
    group.add(og);
  }

  group.applyMatrix4(frameMatrix(frame));
  return group;
}

function buildOpening(o, materials) {
  const g = new THREE.Group();
  g.name = `opening:${o.id}`;

  // Casing: a ring around the hole, standing proud of the siding.
  const outer = rectShape(o.widthFt + 2 * TRIM_W, o.heightFt + 2 * TRIM_W, o.offsetFt - TRIM_W, o.sillFt - TRIM_W);
  outer.holes.push(rectPath(o.widthFt, o.heightFt, o.offsetFt, o.sillFt));
  const casing = new THREE.Mesh(extrude(outer, TRIM_PROUD), materials.trim);
  casing.position.z = -TRIM_PROUD; // proud of the exterior face
  casing.castShadow = true;
  g.add(casing);

  // Panel: door slab or glazing, recessed into the reveal.
  const isDoor = o.type === 'door';
  const panelMat = isDoor ? materials.door : materials.glass;
  const panel = new THREE.Mesh(
    extrude(rectShape(o.widthFt, o.heightFt, o.offsetFt, o.sillFt), 0.08),
    panelMat,
  );
  panel.position.z = GLASS_INSET;
  panel.userData.opening = o.id;
  g.add(panel);

  if (o.type === 'slider') {
    // Glazing plus the meeting stile, so a slider reads differently from a door.
    panel.material = materials.glass;
    const bar = new THREE.Mesh(
      extrude(rectShape(0.22, o.heightFt, o.offsetFt + o.widthFt / 2 - 0.11, o.sillFt), 0.1),
      materials.trim,
    );
    bar.position.z = GLASS_INSET - 0.05;
    g.add(bar);
  }

  if (isDoor) {
    // Simple raised-panel read: a thin inset rectangle on the slab.
    const inset = new THREE.Mesh(
      extrude(rectShape(o.widthFt - 0.6, o.heightFt - 0.9, o.offsetFt + 0.3, o.sillFt + 0.45), 0.03),
      materials.trim,
    );
    inset.position.z = GLASS_INSET - 0.03;
    g.add(inset);
  }

  return g;
}

// ---------------------------------------------------------------------------
// Roof, skirting, steps
// ---------------------------------------------------------------------------

/**
 * One sloping roof plane, given the two points its top surface passes through in
 * the (Z, Y) cross-section, extruded `len` feet along X about `cx`.
 */
function slopePlane(cx, len, z0, y0, z1, y1, material) {
  const angle = Math.atan2(y1 - y0, z1 - z0);
  const runLen = Math.hypot(z1 - z0, y1 - y0);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(len, ROOF_THICK, runLen), material);
  const n = new THREE.Vector3(0, Math.cos(angle), -Math.sin(angle)); // plane up-normal
  mesh.rotation.x = -angle;
  mesh.position.set(
    cx,
    (y0 + y1) / 2 - n.y * ROOF_THICK / 2,
    (z0 + z1) / 2 - n.z * ROOF_THICK / 2,
  );
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function fasciaBoard(cx, len, z, dripY, material) {
  const fascia = new THREE.Mesh(new THREE.BoxGeometry(len, FASCIA_H, 0.16), material);
  fascia.position.set(cx, dripY - FASCIA_H / 2 + 0.05, z);
  fascia.castShadow = true;
  return fascia;
}

/** One roof section: its planes, its fascia, and the clerestory at its ridge. */
function buildRoofSection(sec, xa, xb, dim, materials) {
  const ov = num(dim.eaveOverhangFt, 1);
  const W = num(dim.widthFt, 27);
  const g = new THREE.Group();
  g.name = `roofSection:${sec.index}`;
  g.userData.roofSection = sec.index;

  const len = Math.max(0.05, xb - xa);
  const cx = (xa + xb) / 2;

  if (sec.roofStyle === 'flat') {
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(len, ROOF_THICK, W + 2 * ov),
      materials.roof,
    );
    slab.position.set(cx, sec.peakY + ROOF_THICK / 2, 0);
    slab.castShadow = true;
    slab.receiveShadow = true;
    g.add(slab);
    return g;
  }

  const frontDripZ = sec.frontEdgeZ - ov;
  const backDripZ = sec.backEdgeZ + ov;

  if (sec.ridgeZ - frontDripZ > 0.02) {
    const dripY = sec.frontEaveY - ov * sec.frontSlope;
    g.add(slopePlane(cx, len, frontDripZ, dripY, sec.ridgeZ, sec.frontPeakY, materials.roof));
    g.add(fasciaBoard(cx, len, frontDripZ, dripY, materials.trim));
  }
  if (backDripZ - sec.ridgeZ > 0.02) {
    const dripY = sec.backEaveY - ov * sec.backSlope;
    g.add(slopePlane(cx, len, sec.ridgeZ, sec.backPeakY, backDripZ, dripY, materials.roof));
    g.add(fasciaBoard(cx, len, backDripZ, dripY, materials.trim));
  }

  // When the two planes peak at different heights they cannot meet: the gap
  // between them is a clerestory wall standing on the lower plane.
  const lowY = Math.min(sec.frontPeakY, sec.backPeakY);
  const highY = Math.max(sec.frontPeakY, sec.backPeakY);
  if (highY - lowY > 0.02) {
    const bottom = lowY - ROOF_THICK - 0.1;
    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(len, highY - bottom, 0.36),
      materials.siding,
    );
    wall.position.set(cx, (highY + bottom) / 2, sec.ridgeZ);
    wall.castShadow = true;
    wall.receiveShadow = true;
    wall.name = 'ridgeStep';
    g.add(wall);

    const cap = new THREE.Mesh(new THREE.BoxGeometry(len, 0.42, 0.6), materials.trim);
    cap.position.set(cx, highY - 0.16, sec.ridgeZ);
    cap.castShadow = true;
    g.add(cap);
  }

  return g;
}

/**
 * The wall that closes the gap where two neighbouring sections' roofs disagree.
 *
 * Both roofs are functions of Z, so the gap is simply the band between the upper
 * and lower envelope. Sampling at the knots (each ridge, each wall line) plus
 * any crossing between them keeps the outline exact rather than faceted.
 */
function buildSectionTransition(a, b, dim, materials) {
  const ov = num(dim.eaveOverhangFt, 1);
  const W = num(dim.widthFt, 27);
  const zMin = -W / 2 - ov;
  const zMax = W / 2 + ov;
  const eps = 1e-4;

  const knots = [zMin, zMax, -W / 2, W / 2];
  for (const s of [a, b]) knots.push(s.ridgeZ - eps, s.ridgeZ + eps);
  let zs = [...new Set(knots)]
    .filter((z) => z >= zMin - eps && z <= zMax + eps)
    .sort((p, q) => p - q);

  // Add the point where the two roof lines cross inside any interval.
  const crossings = [];
  for (let i = 0; i + 1 < zs.length; i++) {
    const z0 = zs[i];
    const z1 = zs[i + 1];
    if (z1 - z0 < 1e-3) continue;
    const d0 = roofTopAt(a, z0) - roofTopAt(b, z0);
    const d1 = roofTopAt(a, z1) - roofTopAt(b, z1);
    if (d0 === d1 || (d0 > 0) === (d1 > 0)) continue;
    crossings.push(z0 + (d0 / (d0 - d1)) * (z1 - z0));
  }
  zs = [...zs, ...crossings].sort((p, q) => p - q);

  let maxGap = 0;
  const top = [];
  const bottom = [];
  for (const z of zs) {
    const ya = roofTopAt(a, z);
    const yb = roofTopAt(b, z);
    maxGap = Math.max(maxGap, Math.abs(ya - yb));
    top.push([z, Math.max(ya, yb)]);
    bottom.push([z, Math.min(ya, yb) - 0.02]);
  }
  if (maxGap < 0.05) return null; // the two roofs line up; nothing to close

  const shape = new THREE.Shape();
  shape.moveTo(top[0][0], top[0][1]);
  for (let i = 1; i < top.length; i++) shape.lineTo(top[i][0], top[i][1]);
  for (let i = bottom.length - 1; i >= 0; i--) shape.lineTo(bottom[i][0], bottom[i][1]);
  shape.closePath();

  const thick = 0.4;
  const mesh = new THREE.Mesh(extrude(shape, thick), materials.siding);
  // The shape is drawn in (Z, Y); stand it up across the section boundary.
  mesh.applyMatrix4(new THREE.Matrix4()
    .makeBasis(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0), new THREE.Vector3(-1, 0, 0))
    .setPosition(a.x1 + thick / 2, 0, 0));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = `roofTransition:${a.index}`;
  return mesh;
}

function buildRoof(dim, materials) {
  const rake = num(dim.rakeOverhangFt, 0.75);
  const g = new THREE.Group();
  g.name = 'roof';

  const sections = resolveRoofSections(dim);
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    // Only the outer ends carry a rake overhang; interior sections butt.
    const xa = s.x0 - (i === 0 ? rake : 0);
    const xb = s.x1 + (i === sections.length - 1 ? rake : 0);
    g.add(buildRoofSection(s, xa, xb, dim, materials));
  }
  for (let i = 0; i + 1 < sections.length; i++) {
    const wall = buildSectionTransition(sections[i], sections[i + 1], dim, materials);
    if (wall) g.add(wall);
  }

  const dormers = buildDormers(dim, materials, sections);
  if (dormers) g.add(dormers);

  return g;
}

function buildDormers(dim, materials, sections = resolveRoofSections(dim)) {
  const count = parseInt(dim.dormerCount, 10) || 0;
  if (count <= 0 || dim.roofStyle === 'flat') return null;

  const g = new THREE.Group();
  g.name = 'dormers';

  const dW = dim.dormerWidthFt ?? 10.0;
  const dH = dim.dormerHeightFt ?? 4.5;
  // A dormer rides whichever roof section it sits over, so it keeps its footing
  // when that part of the roof has its own pitch or eave height.
  const footing = (x) => {
    const sec = sectionAtX(sections, x);
    return { eaveY: sec.frontEaveY, slope: sec.frontSlope || 0.33 };
  };
  const frontZ = -dim.widthFt / 2;
  const ov = dim.eaveOverhangFt ?? 1.0;
  const dormerFrontZ = frontZ - ov * 0.4;

  // Use custom positions when available and length matches, otherwise auto-place.
  const customPos = Array.isArray(dim.dormerPositions) && dim.dormerPositions.length === count
    ? dim.dormerPositions
    : null;
  const xPositions = customPos
    || (count === 1 ? [0] : [-dim.lengthFt * 0.25, dim.lengthFt * 0.25]);

  // ── Connected dormer cap mode (double-wide) ──────────────────────────
  // Merges two dormers into one continuous raised section with a shed roof,
  // continuous siding front wall, eave returns on each outer edge, and
  // accent windows — the classic double-wide manufactured home profile.
  if (count === 2 && dim.dormerConnected) {
    const capGroup = new THREE.Group();
    capGroup.name = 'dormer:connected';
    capGroup.userData.dormerIndex = 0;

    const leftX  = Math.min(xPositions[0], xPositions[1]);
    const rightX = Math.max(xPositions[0], xPositions[1]);
    const capLeft  = leftX  - dW / 2;
    const capRight = rightX + dW / 2;
    const capWidth = capRight - capLeft;
    const capCenterX = (capLeft + capRight) / 2;
    const { eaveY, slope } = footing(capCenterX);

    // Dormer depth: how far back toward the ridge the cap extends.
    const dormerDepth = (dH / (slope || 0.33)) + ov * 0.5;

    // 1. Front wall — continuous siding rectangle across the cap width.
    const wallShape = new THREE.Shape();
    wallShape.moveTo(-capWidth / 2, 0);
    wallShape.lineTo(capWidth / 2, 0);
    wallShape.lineTo(capWidth / 2, dH);
    wallShape.lineTo(-capWidth / 2, dH);
    wallShape.closePath();

    const wallMesh = new THREE.Mesh(
      new THREE.ExtrudeGeometry(wallShape, { depth: 0.2, bevelEnabled: false }),
      materials.siding
    );
    wallMesh.position.set(capCenterX, eaveY, dormerFrontZ);
    wallMesh.castShadow = true;
    wallMesh.userData.dormerIndex = 0;
    capGroup.add(wallMesh);

    // 2. Shed roof — single slope from the cap top back toward the main ridge.
    const shedAngle = Math.atan2(dH, dormerDepth);
    const shedLen = Math.sqrt(dH * dH + dormerDepth * dormerDepth);
    const shedRoof = new THREE.Mesh(
      new THREE.BoxGeometry(capWidth + 1.0, 0.35, shedLen),
      materials.roof
    );
    shedRoof.position.set(
      capCenterX,
      eaveY + dH / 2,
      dormerFrontZ + dormerDepth / 2
    );
    shedRoof.rotation.x = shedAngle;
    shedRoof.castShadow = true;
    shedRoof.userData.dormerIndex = 0;
    capGroup.add(shedRoof);

    // 3. Side walls — triangular gable cheeks on each end.
    for (const side of [-1, 1]) {
      const sideShape = new THREE.Shape();
      sideShape.moveTo(0, 0);
      sideShape.lineTo(dormerDepth, 0);
      sideShape.lineTo(0, dH);
      sideShape.closePath();

      const sideMesh = new THREE.Mesh(
        new THREE.ExtrudeGeometry(sideShape, { depth: 0.15, bevelEnabled: false }),
        materials.siding
      );
      const sideX = side === -1 ? capLeft : capRight;
      sideMesh.position.set(sideX + side * 0.08, eaveY, dormerFrontZ);
      sideMesh.rotation.y = -Math.PI / 2;
      if (side === 1) {
        sideMesh.rotation.y = Math.PI / 2;
        sideMesh.position.z = dormerFrontZ + dormerDepth;
      }
      sideMesh.castShadow = true;
      sideMesh.userData.dormerIndex = 0;
      capGroup.add(sideMesh);
    }

    // 4. Eave returns — false eave trim on each outer side.
    if (dim.dormerFalseEave !== false) {
      for (const side of [-1, 1]) {
        const returnX = side === -1 ? capLeft - 0.6 : capRight + 0.6;
        const eaveReturn = new THREE.Mesh(
          new THREE.BoxGeometry(1.6, 0.55, 0.45),
          materials.trim
        );
        eaveReturn.position.set(returnX, eaveY - 0.28, dormerFrontZ + 0.1);
        eaveReturn.castShadow = true;
        eaveReturn.userData.dormerIndex = 0;
        capGroup.add(eaveReturn);

        // Inner eave return (double-wide stepped profile)
        if (dim.dormerInnerFalseEave !== false) {
          const innerReturn = new THREE.Mesh(
            new THREE.BoxGeometry(1.2, 0.45, 0.35),
            materials.trim
          );
          innerReturn.position.set(returnX, eaveY + 0.18, dormerFrontZ + 0.25);
          innerReturn.castShadow = true;
          innerReturn.userData.dormerIndex = 0;
          innerReturn.name = 'innerFalseEave';
          capGroup.add(innerReturn);
        }
      }

      // Continuous fascia trim across the top of the front wall.
      const fascia = new THREE.Mesh(
        new THREE.BoxGeometry(capWidth + 2.4, 0.5, 0.2),
        materials.trim
      );
      fascia.position.set(capCenterX, eaveY + dH + 0.1, dormerFrontZ - 0.05);
      fascia.castShadow = true;
      fascia.userData.dormerIndex = 0;
      capGroup.add(fascia);

      // Bottom trim across the eave line.
      const bottomTrim = new THREE.Mesh(
        new THREE.BoxGeometry(capWidth + 2.4, 0.35, 0.18),
        materials.trim
      );
      bottomTrim.position.set(capCenterX, eaveY - 0.18, dormerFrontZ + 0.05);
      bottomTrim.castShadow = true;
      bottomTrim.userData.dormerIndex = 0;
      capGroup.add(bottomTrim);
    }

    // 5. Accent windows — one in each dormer position.
    if (dim.dormerWindow !== false) {
      for (const posX of xPositions) {
        const winW = Math.min(3.2, dW * 0.4);
        const winH = Math.min(2.5, dH * 0.5);

        const glass = new THREE.Mesh(
          new THREE.BoxGeometry(winW, winH, 0.1),
          materials.glass
        );
        glass.position.set(posX, eaveY + dH * 0.35, dormerFrontZ - 0.05);
        glass.userData.dormerIndex = 0;
        capGroup.add(glass);

        const frame = new THREE.Mesh(
          new THREE.BoxGeometry(winW + 0.4, winH + 0.4, 0.08),
          materials.trim
        );
        frame.position.set(posX, eaveY + dH * 0.35, dormerFrontZ - 0.03);
        frame.userData.dormerIndex = 0;
        capGroup.add(frame);
      }
    }

    g.add(capGroup);
    return g;
  }

  // ── Individual (separate) dormers ────────────────────────────────────
  for (let i = 0; i < xPositions.length; i++) {
    const posX = xPositions[i];
    const { eaveY, slope } = footing(posX);
    const dormerGroup = new THREE.Group();
    dormerGroup.name = `dormer:${i}`;
    dormerGroup.userData.dormerIndex = i;

    // 1. Dormer Gable Front Wall / Triangle
    const shape = new THREE.Shape();
    shape.moveTo(-dW / 2, 0);
    shape.lineTo(dW / 2, 0);
    shape.lineTo(0, dH);
    shape.closePath();

    const extrudeOpts = { depth: 0.2, bevelEnabled: false };
    const frontGable = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, extrudeOpts), materials.siding);
    frontGable.position.set(posX, eaveY, dormerFrontZ);
    frontGable.castShadow = true;
    frontGable.userData.dormerIndex = i;
    dormerGroup.add(frontGable);

    // 2. False Eave Return Band — outer (if enabled)
    if (dim.dormerFalseEave !== false) {
      const falseEaveW = dW + 1.2;
      const falseEave = new THREE.Mesh(
        new THREE.BoxGeometry(falseEaveW, 0.55, 0.45),
        materials.trim
      );
      falseEave.position.set(posX, eaveY - 0.28, dormerFrontZ + 0.1);
      falseEave.castShadow = true;
      falseEave.userData.dormerIndex = i;
      dormerGroup.add(falseEave);

      // 2b. Inner false eave — nested return band (double-wide stepped profile)
      if (dim.dormerInnerFalseEave !== false) {
        const innerW = falseEaveW - 1.6;
        const innerEave = new THREE.Mesh(
          new THREE.BoxGeometry(innerW, 0.45, 0.35),
          materials.trim
        );
        innerEave.position.set(posX, eaveY + 0.18, dormerFrontZ + 0.25);
        innerEave.castShadow = true;
        innerEave.userData.dormerIndex = i;
        innerEave.name = 'innerFalseEave';
        dormerGroup.add(innerEave);
      }
    }

    // 3. Dormer Roof Pitch Slopes
    const dSlopeLen = Math.sqrt((dW / 2) * (dW / 2) + dH * dH);
    const dPitchAngle = Math.atan2(dH, dW / 2);
    const dormerDepth = (dH / (slope || 0.33)) + ov * 0.5;

    // Left slope
    const leftRoof = new THREE.Mesh(
      new THREE.BoxGeometry(dSlopeLen, 0.35, dormerDepth),
      materials.roof
    );
    leftRoof.position.set(posX - dW / 4, eaveY + dH / 2, dormerFrontZ + dormerDepth / 2);
    leftRoof.rotation.z = dPitchAngle;
    leftRoof.castShadow = true;
    leftRoof.userData.dormerIndex = i;
    dormerGroup.add(leftRoof);

    // Right slope
    const rightRoof = new THREE.Mesh(
      new THREE.BoxGeometry(dSlopeLen, 0.35, dormerDepth),
      materials.roof
    );
    rightRoof.position.set(posX + dW / 4, eaveY + dH / 2, dormerFrontZ + dormerDepth / 2);
    rightRoof.rotation.z = -dPitchAngle;
    rightRoof.castShadow = true;
    rightRoof.userData.dormerIndex = i;
    dormerGroup.add(rightRoof);

    // 4. Accent Dormer Window (if enabled)
    if (dim.dormerWindow !== false) {
      const winW = Math.min(3.2, dW * 0.4);
      const winH = Math.min(2.5, dH * 0.5);

      const glass = new THREE.Mesh(
        new THREE.BoxGeometry(winW, winH, 0.1),
        materials.glass
      );
      glass.position.set(posX, eaveY + dH * 0.35, dormerFrontZ - 0.05);
      glass.userData.dormerIndex = i;
      dormerGroup.add(glass);

      const frame = new THREE.Mesh(
        new THREE.BoxGeometry(winW + 0.4, winH + 0.4, 0.08),
        materials.trim
      );
      frame.position.set(posX, eaveY + dH * 0.35, dormerFrontZ - 0.03);
      frame.userData.dormerIndex = i;
      dormerGroup.add(frame);
    }

    g.add(dormerGroup);
  }

  return g;
}

function buildSkirting(dim, materials) {
  if (dim.floorHeightFt <= 0.01) return null;
  const inset = 0.06;
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(dim.lengthFt - inset, dim.floorHeightFt, dim.widthFt - inset),
    materials.skirting,
  );
  m.position.y = dim.floorHeightFt / 2;
  m.castShadow = true;
  m.receiveShadow = true;
  m.name = 'skirting';
  return m;
}

function buildSteps(home, materials, sceneOpts = {}) {
  const dim = home.dimensions;
  const g = new THREE.Group();
  g.name = 'steps';
  const frames = wallFrames(dim);
  const doors = home.openings.filter((o) => (o.type === 'door' || o.type === 'slider') && o.sillFt < 0.75);
  if (!doors.length || sceneOpts.steps === false) return g;

  const railH = 3.0; // 36" railing height
  const postW = 0.12; // post thickness

  for (const o of doors) {
    const f = frames[o.wall];
    if (!f) continue;
    const top = dim.floorHeightFt + o.sillFt;
    if (top < 0.4) continue;

    const doorMatType = o.stepMat || sceneOpts.stepMat || 'concrete';
    const egress = o.stepEgress || sceneOpts.stepEgress || 'front';
    const hasLanding = (o.stepLanding ?? sceneOpts.stepLanding) !== false;
    const landingDepth = hasLanding ? Math.max(2.0, o.landingDepthFt ?? sceneOpts.landingDepthFt ?? 3.5) : 1.0;
    const railings = o.stepRailings ?? sceneOpts.stepRailings ?? 'both';

    let stepMat = materials.concrete;
    if (doorMatType === 'pressure_treated') stepMat = materials.pressure_treated;
    else if (doorMatType === 'dark_composite') stepMat = materials.dark_composite;

    const count = Math.max(1, Math.round(top / 0.62));
    const rise = top / count;
    const tread = 0.95;
    const wide = o.widthFt + 1.2;
    const uCenter = o.offsetFt + o.widthFt / 2;

    const stepGroup = new THREE.Group();

    // 1. Top Landing Platform
    const landing = new THREE.Mesh(
      new THREE.BoxGeometry(wide, rise, landingDepth),
      stepMat
    );
    const pLand = f.origin.clone()
      .addScaledVector(f.right, uCenter)
      .addScaledVector(f.normal, landingDepth / 2);
    pLand.y = top - rise / 2;
    landing.position.copy(pLand);
    landing.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), f.right);
    landing.castShadow = true;
    landing.receiveShadow = true;
    stepGroup.add(landing);

    // 2. Descending Tiers based on Egress Direction
    if (egress === 'front') {
      for (let i = 0; i < count; i++) {
        const depthFromWall = landingDepth + tread * (count - i);
        const step = new THREE.Mesh(
          new THREE.BoxGeometry(wide, rise, depthFromWall),
          stepMat
        );
        const p = f.origin.clone()
          .addScaledVector(f.right, uCenter)
          .addScaledVector(f.normal, depthFromWall / 2);
        p.y = i * rise + rise / 2;
        step.position.copy(p);
        step.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), f.right);
        step.castShadow = true;
        step.receiveShadow = true;
        stepGroup.add(step);
      }
    } else {
      // Side Egress (left, right, or split)
      const dirs = [];
      if (egress === 'left' || egress === 'split') dirs.push(-1);
      if (egress === 'right' || egress === 'split') dirs.push(1);

      for (const dir of dirs) {
        for (let i = 0; i < count; i++) {
          const runLength = wide / 2 + tread * (count - i);
          const step = new THREE.Mesh(
            new THREE.BoxGeometry(runLength, rise, landingDepth),
            stepMat
          );
          const p = f.origin.clone()
            .addScaledVector(f.right, uCenter + dir * (runLength / 2))
            .addScaledVector(f.normal, landingDepth / 2);
          p.y = i * rise + rise / 2;
          step.position.copy(p);
          step.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), f.right);
          step.castShadow = true;
          step.receiveShadow = true;
          stepGroup.add(step);
        }
      }
    }

    // 3. Railings
    if (railings !== 'none') {
      const doorRailMatType = o.railMat || sceneOpts.railMat || 'pressure_treated';
      const balusterStyle = o.balusterStyle || sceneOpts.balusterStyle || 'balusters';

      let railMat = materials.rail_pressure_treated;
      if (doorRailMatType === 'white_trim') railMat = materials.rail_white;
      else if (doorRailMatType === 'black_metal') railMat = materials.rail_black;
      else if (doorRailMatType === 'matching_trim') railMat = materials.trim;
      else if (doorRailMatType === 'pressure_treated') railMat = materials.rail_pressure_treated;

      const activeSides = [];
      if (railings === 'left' || railings === 'both') activeSides.push(-wide / 2 + postW / 2);
      if (railings === 'right' || railings === 'both') activeSides.push(wide / 2 - postW / 2);

      const balusterW = 0.06;
      const balusterH = railH - 0.25;

      for (const sideX of activeSides) {
        // Post at wall
        const pWall = new THREE.Mesh(new THREE.BoxGeometry(postW, railH, postW), railMat);
        const pWallPos = f.origin.clone()
          .addScaledVector(f.right, uCenter + sideX)
          .addScaledVector(f.normal, postW / 2);
        pWallPos.y = top + railH / 2;
        pWall.position.copy(pWallPos);
        pWall.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), f.right);
        stepGroup.add(pWall);

        // Landing outer corner post
        const pLandCorner = new THREE.Mesh(new THREE.BoxGeometry(postW, railH, postW), railMat);
        const pLandCornerPos = f.origin.clone()
          .addScaledVector(f.right, uCenter + sideX)
          .addScaledVector(f.normal, landingDepth - postW / 2);
        pLandCornerPos.y = top + railH / 2;
        pLandCorner.position.copy(pLandCornerPos);
        pLandCorner.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), f.right);
        stepGroup.add(pLandCorner);

        // Landing outer rail
        const landRail = new THREE.Mesh(new THREE.BoxGeometry(postW, 0.12, landingDepth), railMat);
        const pLandRail = f.origin.clone()
          .addScaledVector(f.right, uCenter + sideX)
          .addScaledVector(f.normal, landingDepth / 2);
        pLandRail.y = top + railH;
        landRail.position.copy(pLandRail);
        landRail.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), f.right);
        stepGroup.add(landRail);

        // Infill / Balusters along side landing rail
        if (balusterStyle === 'balusters') {
          const spacing = 0.35; // 4" spacing
          const numSpindles = Math.max(1, Math.floor((landingDepth - postW * 2) / spacing));
          const stepDist = (landingDepth - postW * 2) / (numSpindles + 1);

          for (const k of Array.from({length: numSpindles}, (_, i) => i + 1)) {
            const dist = postW + k * stepDist;
            const b = new THREE.Mesh(new THREE.BoxGeometry(balusterW, balusterH, balusterW), railMat);
            const bPos = f.origin.clone()
              .addScaledVector(f.right, uCenter + sideX)
              .addScaledVector(f.normal, dist);
            bPos.y = top + balusterH / 2 + 0.1;
            b.position.copy(bPos);
            b.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), f.right);
            b.castShadow = true;
            stepGroup.add(b);
          }
        } else if (balusterStyle === 'horizontal_cables') {
          for (const hPct of [0.25, 0.50, 0.75]) {
            const cable = new THREE.Mesh(new THREE.BoxGeometry(balusterW, 0.04, landingDepth), railMat);
            const cPos = f.origin.clone()
              .addScaledVector(f.right, uCenter + sideX)
              .addScaledVector(f.normal, landingDepth / 2);
            cPos.y = top + railH * hPct;
            cable.position.copy(cPos);
            cable.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), f.right);
            stepGroup.add(cable);
          }
        }
      }

      if (egress !== 'front') {
        const frontRail = new THREE.Mesh(new THREE.BoxGeometry(wide, 0.12, postW), railMat);
        const pFrontRail = f.origin.clone()
          .addScaledVector(f.right, uCenter)
          .addScaledVector(f.normal, landingDepth - postW / 2);
        pFrontRail.y = top + railH;
        frontRail.position.copy(pFrontRail);
        frontRail.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), f.right);
        stepGroup.add(frontRail);

        if (balusterStyle === 'balusters') {
          const spacing = 0.35;
          const numSpindles = Math.max(1, Math.floor((wide - postW * 2) / spacing));
          const stepDist = (wide - postW * 2) / (numSpindles + 1);

          for (const k of Array.from({length: numSpindles}, (_, i) => i + 1)) {
            const uOffset = -wide / 2 + postW + k * stepDist;
            const b = new THREE.Mesh(new THREE.BoxGeometry(balusterW, balusterH, balusterW), railMat);
            const bPos = f.origin.clone()
              .addScaledVector(f.right, uCenter + uOffset)
              .addScaledVector(f.normal, landingDepth - postW / 2);
            bPos.y = top + balusterH / 2 + 0.1;
            b.position.copy(bPos);
            b.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), f.right);
            b.castShadow = true;
            stepGroup.add(b);
          }
        } else if (balusterStyle === 'horizontal_cables') {
          for (const hPct of [0.25, 0.50, 0.75]) {
            const cable = new THREE.Mesh(new THREE.BoxGeometry(wide, 0.04, balusterW), railMat);
            const cPos = f.origin.clone()
              .addScaledVector(f.right, uCenter)
              .addScaledVector(f.normal, landingDepth - postW / 2);
            cPos.y = top + railH * hPct;
            cable.position.copy(cPos);
            cable.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), f.right);
            stepGroup.add(cable);
          }
        }
      }
    }

    g.add(stepGroup);
  }
  return g;
}

// ---------------------------------------------------------------------------
// Annotations
// ---------------------------------------------------------------------------

function labelSprite(text) {
  const pad = 16, fs = 40;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  ctx.font = `600 ${fs}px ui-sans-serif, system-ui, sans-serif`;
  const w = Math.ceil(ctx.measureText(text).width) + pad * 2;
  c.width = w; c.height = fs + pad * 2;
  const c2 = c.getContext('2d');
  c2.fillStyle = 'rgba(20,22,26,0.88)';
  c2.roundRect ? (c2.beginPath(), c2.roundRect(0, 0, c.width, c.height, 12), c2.fill())
               : c2.fillRect(0, 0, c.width, c.height);
  c2.font = `600 ${fs}px ui-sans-serif, system-ui, sans-serif`;
  c2.fillStyle = '#ffffff';
  c2.textBaseline = 'middle';
  c2.fillText(text, pad, c.height / 2);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  const scale = 3.2;
  spr.scale.set((c.width / c.height) * scale, scale, 1);
  spr.renderOrder = 999;
  return spr;
}

function buildCallouts(home) {
  const dim = home.dimensions;
  const g = new THREE.Group();
  g.name = 'callouts';
  const frames = wallFrames(dim);
  for (const o of home.openings) {
    if (o.type === 'window') continue;
    const f = frames[o.wall];
    if (!f) continue;
    const p = f.origin.clone()
      .addScaledVector(f.right, o.offsetFt + o.widthFt / 2)
      .addScaledVector(f.normal, 1.2);
    p.y = dim.floorHeightFt + o.sillFt + o.heightFt + 2.2;
    const s = labelSprite(o.label || 'Door');
    s.position.copy(p);
    g.add(s);
  }
  return g;
}

function buildFootprintOutline(dim) {
  const { widthFt: W, lengthFt: L } = dim;
  const pts = [
    new THREE.Vector3(-L / 2, 0.02, -W / 2),
    new THREE.Vector3( L / 2, 0.02, -W / 2),
    new THREE.Vector3( L / 2, 0.02,  W / 2),
    new THREE.Vector3(-L / 2, 0.02,  W / 2),
    new THREE.Vector3(-L / 2, 0.02, -W / 2),
  ];
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({ color: 0x6fb2ff }),
  );
  line.name = 'footprint';

  const g = new THREE.Group();
  g.add(line);

  const lw = labelSprite(`${fmtFt(L)} long`);
  lw.position.set(0, 0.6, -W / 2 - 4);
  g.add(lw);

  const ww = labelSprite(`${fmtFt(W)} wide`);
  ww.position.set(L / 2 + 6, 0.6, 0);
  g.add(ww);

  return g;
}

export function fmtFt(v) {
  const ft = Math.floor(v + 1e-6);
  const inch = Math.round((v - ft) * 12);
  if (inch === 0) return `${ft}'`;
  if (inch === 12) return `${ft + 1}'`;
  return `${ft}'-${inch}"`;
}

export function fmtAllUnits(vFt) {
  const v = vFt ?? 0;
  const ft = Math.floor(v + 1e-6);
  const inchTotal = Math.round(v * 12);
  const inch = Math.round((v - ft) * 12);
  const meters = (v * 0.3048).toFixed(2);
  const ftInchStr = inch === 0 ? `${ft}'` : (inch === 12 ? `${ft + 1}'` : `${ft}'-${inch}"`);
  return `${ftInchStr} (${inchTotal}" / ${meters}m)`;
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

export function buildHome(home, sceneOpts) {
  const dim = home.dimensions;
  const materials = {
    siding: mat(home.colors.siding),
    trim: mat(home.colors.trim, { roughness: 0.75 }),
    roof: mat(home.colors.roof, { roughness: 0.85 }),
    skirting: mat(home.colors.skirting, { roughness: 0.95 }),
    concrete: mat('#b4bcc6', { roughness: 0.95 }),
    pressure_treated: mat('#a87442', { roughness: 0.78 }),
    dark_composite: mat('#383c42', { roughness: 0.70 }),
    rail_pressure_treated: mat('#a87442', { roughness: 0.80 }),
    rail_white: mat('#f5f7fa', { roughness: 0.65 }),
    rail_black: mat('#22252a', { metalness: 0.75, roughness: 0.35 }),
    door: mat(home.colors.door, { roughness: 0.7 }),
    glass: mat(home.colors.glass, { roughness: 0.18, metalness: 0.15 }),
  };

  const root = new THREE.Group();
  root.name = 'home';

  const frames = wallFrames(dim);
  for (const [name, f] of Object.entries(frames)) {
    root.add(buildWall(name, f, home, materials));
  }

  root.add(buildRoof(dim, materials));
  const skirt = buildSkirting(dim, materials);
  if (skirt) root.add(skirt);
  if (sceneOpts.steps) root.add(buildSteps(home, materials, sceneOpts));
  if (sceneOpts.labels) root.add(buildCallouts(home));
  if (sceneOpts.dims) root.add(buildFootprintOutline(dim));

  root.userData.materials = materials;
  root.userData.derived = derived(dim);
  return root;
}

export function disposeTree(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const list = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of list) {
        if (m.map) m.map.dispose();
        m.dispose();
      }
    }
  });
}
