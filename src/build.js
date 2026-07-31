// Parametric double-wide massing builder.
//
// World axes: +X runs along the home's LENGTH, +Z along its WIDTH, +Y is up.
// The long front wall faces -Z; the gable ends are the short walls at +/-X.
// Ground is y = 0, floor deck sits at y = floorHeightFt.

import * as THREE from 'three';
import { createSidingMaterial } from './textures.js';
import {
  wallBands, bumpHeight, bumpFootprint, isRecess, isProjecting, clampBump,
} from './bumps.js';

const WALL_THICK = 0.5;   // ft
const TRIM_W = 0.28;      // ft, casing width around openings
const TRIM_PROUD = 0.06;  // ft, how far casing stands off the siding
const GLASS_INSET = 0.16; // ft, how far glass/door slab sits back from the face
const ROOF_THICK = 0.45;  // ft
const FASCIA_H = 0.55;    // ft, default face width of a fascia / rake board
const CORNER_PROUD = 0.08; // ft, how far a corner board stands off the siding

/** Face width of the fascia, rake and ridge boards. */
const fasciaWidth = (dim) => Math.max(0.1, num(dim?.fasciaWidthFt, FASCIA_H));

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

/**
 * Roof geometry, solved rather than assumed.
 *
 * A split-pitch roof — "4/12 Split Pitch" on the Redman sheet — is two planes
 * of different pitch rising off the two long walls, so the ridge is NOT over
 * the centreline and one side of the peak is longer and shallower than the
 * other. Per-wall eave heights do the same thing. Both cases are the same
 * question: where do the two planes meet?
 *
 *   front plane:  y = eaveYFront + slopeF * (z + W/2)
 *   back plane:   y = eaveYBack  + slopeB * (W/2 - z)
 *
 * Solve for z, and the ridge falls out. Equal pitches and equal wall heights
 * put it back at z = 0, which is what every earlier save expects.
 *
 * The returned `slopeFront`/`slopeBack` are the EFFECTIVE slopes measured back
 * from the solved ridge, so the planes are guaranteed to meet there even after
 * the ridge is clamped inside the footprint.
 */
/**
 * Solve one roof cross-section from explicit values, rather than reading them
 * off `dim` — which is what lets a roof section run its own pitches and eave
 * heights through exactly the same maths as the whole-home roof.
 */
function solveRoof(v, dim) {
  // The section's own wall lines. A section set in from the base rectangle is
  // narrower than the home, so its roof spans less and its ridge solves
  // somewhere else entirely.
  const zFront = v.zFront;
  const zBack = v.zBack;
  const W = zBack - zFront;
  const { eaveYFront, eaveYBack } = v;
  const pitchF = v.flat ? 0 : Math.max(0, v.pitchF || 0);
  const pitchB = v.flat ? 0 : Math.max(0, v.pitchB || 0);
  let slopeF = pitchF / 12;
  let slopeB = pitchB / 12;

  if (v.flat || slopeF + slopeB < 1e-6) {
    const eaveY = Math.max(eaveYFront, eaveYBack);
    const mid = (zFront + zBack) / 2;
    return {
      slope: 0, slopeFront: 0, slopeBack: 0,
      eaveY, eaveYFront, eaveYBack,
      ridgeY: eaveY, topY: eaveY, ridgeZ: mid,
      ridgePeakY: eaveY, frontPeakY: eaveY, backPeakY: eaveY,
      ridgeStepFt: 0, ridgeSail: 0, ridgeCutZ: mid,
      angle: 0, angleFront: 0, angleBack: 0, split: false, flat: true,
      zFront, zBack, widthFt: W,
    };
  }

  // Where the two planes meet:
  //   front:  y = eaveYFront + slopeF * (z - zFront)
  //   back:   y = eaveYBack  + slopeB * (zBack - z)
  // Solve for z. With the walls at -W/2 and +W/2 this is the old centreline
  // form; written against the actual wall lines it also holds for a section
  // that has been set in.
  let ridgeZ = (eaveYBack - eaveYFront + slopeB * zBack + slopeF * zFront) / (slopeF + slopeB);
  // A typed ridge offset nudges the solved ridge rather than replacing it, so
  // the split-pitch solve above still sets where it starts from.
  ridgeZ += v.ridgeOffsetFt || 0;
  ridgeZ = Math.min(zBack - 0.25, Math.max(zFront + 0.25, ridgeZ));
  let ridgeY = Math.max(
    eaveYFront + slopeF * (ridgeZ - zFront),
    eaveYBack + slopeB * (zBack - ridgeZ),
  );
  // Re-read the slopes off the solved ridge so both planes land on their eave.
  slopeF = (ridgeY - eaveYFront) / (ridgeZ - zFront);
  slopeB = (ridgeY - eaveYBack) / (zBack - ridgeZ);

  // Ridge step: the two planes no longer have to meet. Lifting the rear peak
  // opens a clerestory wall between them, and the rear plane steepens to reach
  // it — the one case the solve above cannot express, since it assumes a
  // single ridge line.
  let frontPeakY = ridgeY;
  let backPeakY = ridgeY;
  const stepFt = v.ridgeStepFt || 0;
  if (Math.abs(stepFt) > 1e-6) {
    if (stepFt > 0) backPeakY = ridgeY + stepFt;
    else frontPeakY = ridgeY - stepFt;
    frontPeakY = Math.max(eaveYFront, frontPeakY);
    backPeakY = Math.max(eaveYBack, backPeakY);
    slopeF = (frontPeakY - eaveYFront) / (ridgeZ - zFront);
    slopeB = (backPeakY - eaveYBack) / (zBack - ridgeZ);
    ridgeY = Math.max(frontPeakY, backPeakY);
  }

  // Ridge overhang: with the peaks at different heights there is no ridge for
  // the planes to meet at, so the taller one can carry on past it at its own
  // pitch and hang over the low roof instead of dying into the clerestory.
  let ridgeSail = 0;
  const sailAmt = Math.max(0, num(dim.ridgeOverhangFt, num(dim.eaveOverhangFt, 1)));
  if ((dim.ridgeOverhang ?? 'raised') !== 'none' && sailAmt > 0) {
    const diff = frontPeakY - backPeakY;
    // Only once the taller plane clears the shorter by more than the deck is
    // thick; below that the overhang would sit inside the roof it covers.
    if (diff > ROOF_THICK + 0.05) ridgeSail = Math.min(sailAmt, zBack - ridgeZ);
    else if (-diff > ROOF_THICK + 0.05) ridgeSail = -Math.min(sailAmt, ridgeZ - zFront);
  }
  const topY = Math.max(frontPeakY, backPeakY)
    + Math.abs(ridgeSail) * (ridgeSail > 0 ? slopeF : slopeB);

  return {
    slope: slopeF,            // legacy key: the front slope
    slopeFront: slopeF,
    slopeBack: slopeB,
    eaveY: Math.min(eaveYFront, eaveYBack),
    eaveYFront,
    eaveYBack,
    // The highest point of this roof, which is the sailing edge once one plane
    // reaches past the ridge. Framing and the camera read this.
    ridgeY: topY,
    topY,
    // Where the planes actually peak, and where they hand over.
    ridgePeakY: Math.max(frontPeakY, backPeakY),
    frontPeakY,
    backPeakY,
    ridgeStepFt: backPeakY - frontPeakY,
    ridgeSail,
    ridgeCutZ: ridgeZ + ridgeSail,
    ridgeZ,
    angle: Math.atan(slopeF),
    angleFront: Math.atan(slopeF),
    angleBack: Math.atan(slopeB),
    split: Math.abs(ridgeZ - (zFront + zBack) / 2) > 0.01 || Math.abs(slopeF - slopeB) > 1e-4,
    flat: false,
    zFront, zBack, widthFt: W,
  };
}

/** Top-of-deck height of a section's roof at world Z, overhangs included. */
export function roofTopAt(sec, z) {
  if (sec.flat) return sec.topY;
  // Both formulas are the plane's own line, so extending one past the ridge is
  // only a matter of moving where the two hand over.
  if (z <= sec.ridgeCutZ) return sec.eaveYFront + (z - sec.zFront) * sec.slopeFront;
  return sec.backPeakY - (z - sec.ridgeZ) * sec.slopeBack;
}

/**
 * Normalise `dim.roofSections` into an ordered, gap-free list covering the whole
 * length, each solved into its own cross-section.
 *
 * Sections are declared by their start offset from the left end; the first is
 * pinned to 0 and the last runs out to the far end. No sections declared means
 * one roof over the whole home, which is what every earlier save expects.
 */
export function resolveRoofSections(dim) {
  const L = num(dim.lengthFt, 56);
  const F = num(dim.floorHeightFt, 0);
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

  return kept.map((spec, i) => {
    const startFt = spec.startFt;
    const endFt = i + 1 < kept.length ? kept[i + 1].startFt : L;
    const pitchF = num(spec.pitch, num(dim.roofPitch, 4));
    const rawBack = num(spec.pitchBack, dim.roofPitchBack);
    // A section can be set IN from the base rectangle — a positive inset pulls
    // that wall line inward, so that part of the home is narrower and its roof
    // spans less. Negative pushes it out, making that part deeper than the rest.
    const halfW = num(dim.widthFt, 27) / 2;
    const frontInsetFt = num(spec.frontInsetFt, 0);
    const backInsetFt = num(spec.backInsetFt, 0);
    const zFront = Math.min(halfW - 1, -halfW + frontInsetFt);
    const zBack = Math.max(zFront + 1, halfW - backInsetFt);
    const solved = solveRoof({
      flat: (spec.roofStyle || dim.roofStyle) === 'flat',
      zFront,
      zBack,
      eaveYFront: F + num(spec.frontWallHeightFt, getWallHeight('front', dim)),
      eaveYBack: F + num(spec.backWallHeightFt, getWallHeight('back', dim)),
      pitchF,
      pitchB: Number.isFinite(rawBack) && rawBack > 0 ? rawBack : pitchF,
      ridgeOffsetFt: num(spec.ridgeOffsetFt, num(dim.ridgeOffsetFt, 0)),
      ridgeStepFt: num(spec.ridgeStepFt, num(dim.ridgeStepFt, 0)),
    }, dim);
    return {
      ...solved,
      id: spec.id || `sec${i}`,
      index: i,
      label: spec.label || '',
      startFt,
      endFt,
      x0: -L / 2 + startFt,
      x1: -L / 2 + endFt,
      halfW,
      frontInsetFt,
      backInsetFt,
      inset: Math.abs(frontInsetFt) > 1e-6 || Math.abs(backInsetFt) > 1e-6,
      pitchFront: pitchF,
      pitchBack: Number.isFinite(rawBack) && rawBack > 0 ? rawBack : pitchF,
    };
  });
}

/**
 * How far a long wall is set in at a point along it, in that wall's own inward
 * direction. Gable ends do not step along their length, so they are never set
 * in this way.
 */
export function wallInsetAt(name, u, dim) {
  if (name !== 'front' && name !== 'back') return 0;
  const L = num(dim.lengthFt, 56);
  const x = name === 'front' ? L / 2 - u : u - L / 2;
  const sec = sectionAtX(resolveRoofSections(dim), x);
  return name === 'front' ? sec.frontInsetFt : sec.backInsetFt;
}

export function sectionAtX(sections, x) {
  return sections.find((s) => x >= s.x0 - 1e-6 && x <= s.x1 + 1e-6) || sections[0];
}

/**
 * Roof geometry, solved rather than assumed.
 *
 * A split-pitch roof — "4/12 Split Pitch" on the Redman sheet — is two planes
 * of different pitch rising off the two long walls, so the ridge is NOT over
 * the centreline and one side of the peak is longer and shallower than the
 * other. Per-wall eave heights do the same thing.
 *
 * The legacy keys describe the FIRST roof section, which for a home without
 * sections is the whole roof — so everything that read this before sections
 * existed still reads what it expects. `ridgeY` is the highest point anywhere
 * on the roof, so framing still frames the tallest section.
 */
export function derived(dim) {
  const sections = resolveRoofSections(dim);
  return {
    ...sections[0],
    sections,
    sectioned: sections.length > 1,
    ridgeY: sections.reduce((m, s) => Math.max(m, s.topY), -Infinity),
  };
}

/** Read a numeric field, falling back when it is absent, blank or unparseable. */
export function num(v, fallback) {
  if (v === null || v === undefined || v === '') return fallback;
  const n = +v;
  return Number.isFinite(n) ? n : fallback;
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

/** The per-wall override, or null when that wall just follows `wallHeightFt`. */
export function customWallHeight(name, dim) {
  if (!dim) return null;
  const v = dim[`${name}WallHeightFt`];
  return typeof v === 'number' && !Number.isNaN(v) && v > 0 ? v : null;
}

export function getWallHeight(name, dim) {
  if (!dim) return 8.0;
  return customWallHeight(name, dim) ?? (dim.wallHeightFt || 8.0);
}

/**
 * Head alignment: park every opening's head a fixed drop below the top of its
 * wall, with separate drops for windows and for doors/sliders. A door's sill is
 * pinned at the floor, so its drop drives the door HEIGHT; a window keeps its
 * height and rides up or down on its SILL. Openings flagged `headFree` are left
 * where the user put them. Mutates and returns `home`.
 */
export function applyHeadAlign(home) {
  const dim = home.dimensions;
  if (!dim || !dim.headAlign) return home;
  const winDrop = Number.isFinite(+dim.windowHeadDropFt) ? +dim.windowHeadDropFt : 1.0;
  const doorDrop = Number.isFinite(+dim.doorHeadDropFt) ? +dim.doorHeadDropFt : 1.33;

  for (const o of home.openings || []) {
    if (o.headFree) continue;
    const wallH = getWallHeight(o.wall, dim);
    if (o.type === 'door' || o.type === 'slider') {
      o.sillFt = 0;
      o.heightFt = Math.max(0.5, wallH - doorDrop);
    } else {
      o.sillFt = Math.max(0, wallH - winDrop - o.heightFt);
    }
  }
  return home;
}

/** Clamp an opening so it always fits inside its wall and under the eave. */
export function clampOpening(o, dim) {
  const frames = wallFrames(dim);
  const f = frames[o.wall] || frames.front;
  const maxW = Math.max(0.5, f.span - 2 * TRIM_W);
  const wallH = getWallHeight(o.wall, dim);
  o.widthFt = Math.min(Math.max(0.5, o.widthFt), maxW);
  o.heightFt = Math.min(Math.max(0.5, o.heightFt), wallH - 0.4);
  if (o.type === 'door' || o.type === 'slider') {
    o.sillFt = 0;
  } else {
    o.sillFt = Math.min(Math.max(0, o.sillFt), wallH - o.heightFt - 0.2);
  }
  o.offsetFt = Math.min(Math.max(TRIM_W, o.offsetFt), f.span - o.widthFt - TRIM_W);
  return o;
}

// ---------------------------------------------------------------------------
// Walls
// ---------------------------------------------------------------------------

/**
 * The top edge of a wall, in wall-local v, at its two corners — and for a gable
 * end, where the peak sits along the wall.
 *
 * A gable end's two top corners are the eaves of the walls it meets, so a
 * split-pitch roof or a taller front wall tilts that top edge and slides the
 * peak off centre. A per-wall height override still wins: someone who typed a
 * left-wall height meant it.
 */
function wallTopEdge(name, frame, dim, dv) {
  const F = dim.floorHeightFt;
  const custom = customWallHeight(name, dim);
  if (!frame.gable || dim.roofStyle === 'flat') {
    const H = custom ?? (dim.wallHeightFt || 8);
    return { h0: H, h1: H, bodyTop: H, peakU: frame.span / 2, peakV: H, peakV0: H, peakV1: H };
  }
  // A gable end is capped by whichever roof section reaches that end of the
  // home, not by the first one.
  const sections = dv.sections || [dv];
  dv = name === 'left' ? sections[0] : sections[sections.length - 1];
  // 'left' runs front->back along +Z; 'right' runs back->front along -Z.
  const frontH = custom ?? (dv.eaveYFront - F);
  const backH = custom ?? (dv.eaveYBack - F);
  const h0 = name === 'left' ? frontH : backH;
  const h1 = name === 'left' ? backH : frontH;
  const peakU = name === 'left' ? dv.ridgeZ + dim.widthFt / 2 : dim.widthFt / 2 - dv.ridgeZ;
  // The two planes can peak at different heights, so the gable end carries a
  // vertical step at the ridge rather than a single apex. `peakV0` belongs to
  // the h0 corner's plane, `peakV1` to h1's.
  const frontPeak = dv.frontPeakY - F;
  const backPeak = dv.backPeakY - F;
  return {
    h0, h1, bodyTop: Math.min(h0, h1), peakU,
    peakV: dv.ridgePeakY - F,
    peakV0: name === 'left' ? frontPeak : backPeak,
    peakV1: name === 'left' ? backPeak : frontPeak,
  };
}

function buildWall(name, frame, home, materials) {
  const dim = home.dimensions;
  const dv = derived(dim);
  const span = frame.span;
  const openings = home.openings.filter((o) => o.wall === name);
  const { h0, h1, bodyTop, peakU, peakV0, peakV1 } = wallTopEdge(name, frame, dim, dv);
  const H = getWallHeight(name, dim);

  const group = new THREE.Group();
  group.name = `wall:${name}`;

  // Bumps cut the wall into bands rather than punching holes in it: a recess
  // opens the wall from the deck to the top of the recess, and an enclosed
  // bump-out moves that stretch of wall outward. A porch standing in front of
  // the wall leaves it alone — see bumps.js.
  const bands = wallBands(home.bumps, name, dim, bodyTop);

  // A gable end belongs to the section at that end of the home. If that section
  // is set in, the end wall is narrower and sits inboard of the base rectangle,
  // so the whole wall — body and gable — is built over that stretch of u.
  let gu0 = 0;
  let gu1 = span;
  if (frame.gable && dv.sections) {
    const endSec = name === 'left' ? dv.sections[0] : dv.sections[dv.sections.length - 1];
    gu0 = name === 'left' ? endSec.zFront + span / 2 : span / 2 - endSec.zBack;
    gu1 = name === 'left' ? endSec.zBack + span / 2 : span / 2 - endSec.zFront;
  }

  /**
   * Roof sections cut the long walls a second time, horizontally: where two
   * sections meet at different eave heights the wall steps. So every stretch
   * of siding is split again at the section boundaries and each piece takes
   * its own top, on top of whatever the bumps already did to it.
   */
  const eaveCuts = [];
  if (!frame.gable && dv.sections && (dv.sections.length > 1 || dv.sections[0].inset)) {
    const key = name === 'front' ? 'eaveYFront' : 'eaveYBack';
    const insetKey = name === 'front' ? 'frontInsetFt' : 'backInsetFt';
    for (const sec of dv.sections) {
      // The front wall is walked right-to-left in world X, so its u axis runs
      // opposite the section order.
      const a = name === 'front' ? span / 2 - sec.x1 : sec.x0 + span / 2;
      const b = name === 'front' ? span / 2 - sec.x0 : sec.x1 + span / 2;
      eaveCuts.push({
        u0: Math.min(a, b),
        u1: Math.max(a, b),
        top: sec[key] - dim.floorHeightFt,
        // Local +z runs INTO the home, so a set-in section is a positive depth.
        depth: sec[insetKey],
        sec,
      });
    }
    eaveCuts.sort((p, q) => p.u0 - q.u0);
  }
  /**
   * Split `x0`..`x1` at the section boundaries, handing each piece its own top
   * and its own depth — a set-in section moves that run of wall inward exactly
   * the way a bump-out moves its own stretch.
   */
  const eachTop = (x0, x1, fn) => {
    if (!eaveCuts.length) return fn(x0, x1, bodyTop, 0);
    for (const c of eaveCuts) {
      const a = Math.max(x0, c.u0);
      const b = Math.min(x1, c.u1);
      if (b - a > 0.01) fn(a, b, c.top, c.depth);
    }
  };
  /** How far this wall is set in at a point along it. */
  const insetAt = (u) => {
    const c = eaveCuts.find((k) => u >= k.u0 - 1e-6 && u <= k.u1 + 1e-6);
    return c ? c.depth : 0;
  };

  /**
   * One piece of siding, `y0`..`y1` over `x0`..`x1`, carrying its openings.
   * `depth` moves the piece along the wall's inward axis, which is how a
   * bump-out's face and a recess's back wall get built: they are still walls,
   * so their doors and windows have to be real voids in them and not decals
   * pasted on a box.
   */
  const addBand = (x0, x1, y0, y1, material, depth = 0) => {
    if (x1 - x0 < 0.01 || y1 - y0 < 0.01) return;
    const shape = rectShape(x1 - x0, y1 - y0, x0, y0);
    for (const o of openings) {
      if (bandOf(o) !== depth) continue;
      const oy1 = o.sillFt + o.heightFt;
      const inside = o.offsetFt >= x0 - 1e-6 && o.offsetFt + o.widthFt <= x1 + 1e-6
        && o.sillFt >= y0 - 1e-6 && oy1 <= y1 + 1e-6;
      if (inside) shape.holes.push(rectPath(o.widthFt, o.heightFt, o.offsetFt, o.sillFt));
    }
    const mesh = new THREE.Mesh(extrude(shape, WALL_THICK), material);
    mesh.position.z = depth;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.wall = name;
    group.add(mesh);
  };

  // Local +z runs INTO the home, so a bump-out's face sits at -depth and a
  // recess's back wall at +|depth|. Both are `-depthFt`.
  const bandDepth = (band) => -band.bump.depthFt;
  /** Which plane an opening lives on: the wall itself, or a moved face. */
  const bandOf = (o) => {
    const u = o.offsetFt + o.widthFt / 2;
    const band = bands.find((s) => o.offsetFt >= s.x0 - 1e-6 && o.offsetFt + o.widthFt <= s.x1 + 1e-6);
    // A bump's depth is measured from the wall it sits on, which may itself
    // have been set in — so the two stack.
    return insetAt(u) + (band ? bandDepth(band) : 0);
  };

  // Solid siding between the bands, the moved face of each bump, and the
  // header of siding left above it.
  let cursor = gu0;
  for (const band of bands) {
    eachTop(cursor, band.x0, (a, b, top, d) => addBand(a, b, 0, top, materials.siding, d));
    // A bump's own depth is measured from the wall where it sits, so it stacks
    // on top of however far that stretch has been set in.
    const bumpBase = insetAt((band.x0 + band.x1) / 2);
    addBand(band.x0, band.x1, 0, band.top, materials.siding, bumpBase + bandDepth(band));
    eachTop(band.x0, band.x1, (a, b, top, d) => addBand(a, b, band.top, top, materials.siding, d));
    cursor = band.x1;
  }
  eachTop(cursor, gu1, (a, b, top, d) => addBand(a, b, 0, top, materials.siding, d));

  // Where two neighbouring sections sit at different depths the wall turns a
  // corner: a return running from the outer plane back to the inner one, which
  // is what makes a set-in half read as set in rather than as a floating wall.
  for (let i = 0; i + 1 < eaveCuts.length; i++) {
    const outer = Math.min(eaveCuts[i].depth, eaveCuts[i + 1].depth);
    const inner = Math.max(eaveCuts[i].depth, eaveCuts[i + 1].depth);
    if (inner - outer < 0.01) continue;
    const u = eaveCuts[i].u1;
    const top = Math.min(eaveCuts[i].top, eaveCuts[i + 1].top);
    const ret = new THREE.Mesh(
      extrude(rectShape(inner - outer, top, 0, 0), WALL_THICK),
      materials.siding,
    );
    // Stand the return across the wall: its local x runs along the wall's
    // inward axis instead of along the wall.
    ret.rotation.y = -Math.PI / 2;
    ret.position.set(u, 0, outer);
    ret.castShadow = true;
    ret.receiveShadow = true;
    ret.userData.wall = name;
    ret.name = 'sectionReturn';
    group.add(ret);
  }

  if (frame.gable && dim.roofStyle !== 'flat') {
    const hasGableAccent = (dim.gableSidingTexture && dim.gableSidingTexture !== dim.sidingTexture)
      || (home.colors.gableSiding && home.colors.gableSiding !== home.colors.siding);
    const peakShape = new THREE.Shape();
    peakShape.moveTo(gu0, bodyTop);
    peakShape.lineTo(gu1, bodyTop);
    peakShape.lineTo(gu1, h1);
    // Walking span -> peak -> 0, so the h1 side's peak comes first. When the
    // two planes peak at different heights these are two points at the same u
    // and the edge between them is the clerestory.
    peakShape.lineTo(peakU, peakV1);
    if (Math.abs(peakV1 - peakV0) > 1e-6) peakShape.lineTo(peakU, peakV0);
    peakShape.lineTo(gu0, h0);
    peakShape.closePath();
    for (const o of openings) {
      // A gable-end window that reaches above the eave line lives up here.
      if (o.sillFt >= bodyTop - 1e-6) {
        peakShape.holes.push(rectPath(o.widthFt, o.heightFt, o.offsetFt, o.sillFt));
      }
    }
    const gablePeak = new THREE.Mesh(
      extrude(peakShape, WALL_THICK),
      hasGableAccent ? (materials.gableSiding || materials.siding) : materials.siding,
    );
    gablePeak.castShadow = true;
    gablePeak.receiveShadow = true;
    gablePeak.userData.wall = name;
    gablePeak.name = 'gablePeak';
    group.add(gablePeak);
  }

  for (const o of openings) {
    const og = buildOpening(o, materials);
    // A door in a recessed porch or on the face of a bump-out travels with the
    // wall it is in, casing and all.
    og.position.z = bandOf(o);
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

function getDormerXSpans(dim) {
  const count = parseInt(dim.dormerCount, 10) || 0;
  if (count <= 0 || dim.roofStyle === 'flat') return [];

  const customPos = Array.isArray(dim.dormerPositions) && dim.dormerPositions.length === count
    ? dim.dormerPositions
    : null;
  const xPositions = customPos
    || (count === 1 ? [0] : [-dim.lengthFt * 0.25, dim.lengthFt * 0.25]);

  if (count === 2 && dim.dormerConnected) {
    const sizeL = dormerSize(dim, 0);
    const sizeR = dormerSize(dim, 1);
    const capLeft  = Math.min(xPositions[0] - sizeL.dW / 2, xPositions[1] - sizeR.dW / 2);
    const capRight = Math.max(xPositions[0] + sizeL.dW / 2, xPositions[1] + sizeR.dW / 2);
    return [{ left: capLeft, right: capRight }];
  }

  const spans = [];
  for (let i = 0; i < count; i++) {
    const { dW } = dormerSize(dim, i);
    const posX = xPositions[i] ?? 0;
    spans.push({ left: posX - dW / 2, right: posX + dW / 2 });
  }
  spans.sort((a, b) => a.left - b.left);
  return spans;
}

function buildFascia(dim, materials, sign, run, eaveY, slope, xa, xb) {
  const { lengthFt: L, rakeOverhangFt: rake, eaveOverhangFt: ov } = dim;
  // Without a range this boards the whole length, which is what a home with a
  // single roof section wants; a sectioned roof passes its own stretch.
  const minX = Number.isFinite(xa) ? xa : -(L + 2 * rake) / 2;
  const maxX = Number.isFinite(xb) ? xb : (L + 2 * rake) / 2;
  const totalSpan = maxX - minX;
  const FW = fasciaWidth(dim);
  const posY = eaveY - ov * slope - FW / 2 + 0.05;
  const posZ = sign * run;

  // Cut out the front fascia board (sign === -1) under dormers when dormerContinuousWall is active
  if (sign === -1 && dim.dormerCount > 0 && dim.dormerContinuousWall) {
    const g = new THREE.Group();
    g.name = 'fasciaFront';
    const dormerSpans = getDormerXSpans(dim);
    let curX = minX;

    for (const span of dormerSpans) {
      if (span.left > curX + 0.01) {
        const segW = span.left - curX;
        const segCenterX = curX + segW / 2;
        const seg = new THREE.Mesh(
          new THREE.BoxGeometry(segW, FW, 0.16),
          materials.fascia
        );
        seg.position.set(segCenterX, posY, posZ);
        seg.castShadow = true;
        g.add(seg);
      }
      curX = Math.max(curX, span.right);
    }

    if (curX < maxX - 0.01) {
      const segW = maxX - curX;
      const segCenterX = curX + segW / 2;
      const seg = new THREE.Mesh(
        new THREE.BoxGeometry(segW, FW, 0.16),
        materials.fascia
      );
      seg.position.set(segCenterX, posY, posZ);
      seg.castShadow = true;
      g.add(seg);
    }

    return g;
  }

  // Uninterrupted full-length fascia
  const fascia = new THREE.Mesh(
    new THREE.BoxGeometry(totalSpan, FW, 0.16),
    materials.fascia
  );
  fascia.name = 'eaveFascia';
  fascia.position.set((minX + maxX) / 2, posY, posZ);
  fascia.castShadow = true;
  return fascia;
}

/**
 * How far a section's roof reaches past a boundary with its neighbour.
 *
 * A section standing above the next one has nothing to butt against, so its
 * roof wants an overhang there just as it does at a gable end — otherwise the
 * raised roof reads as a slab sheared off flush with the wall below it.
 */
function stepOverhang(sec, neighbour, which, dim) {
  const mode = dim.stepOverhang || 'raised';
  if (!neighbour || mode === 'none') return 0;
  const amt = Math.max(0, num(dim.stepOverhangFt, num(dim.rakeOverhangFt, 0.75)));
  if (amt <= 0) return 0;
  if (mode === 'both') return amt;
  // Sample the plane halfway along its own run and overhang only when this
  // section clears the neighbour's roof by more than the deck is thick —
  // anything tighter would bury the overhang inside the roof it hangs over.
  const z = which === 'front' ? (-sec.halfW + sec.ridgeZ) / 2 : (sec.ridgeZ + sec.halfW) / 2;
  return roofTopAt(sec, z) - roofTopAt(neighbour, z) > ROOF_THICK + 0.05 ? amt : 0;
}

/**
 * The wall closing the gap where two neighbouring sections' roofs disagree.
 *
 * Both roofs are functions of Z, so the gap is the band between the upper and
 * lower envelope. Sampling at the knots — each ridge, each wall line — plus any
 * crossing between them keeps the outline exact rather than faceted.
 */
function buildSectionTransition(a, b, dim, materials) {
  const ov = num(dim.eaveOverhangFt, 1);
  const zMin = Math.min(a.zFront, b.zFront) - ov;
  const zMax = Math.max(a.zBack, b.zBack) + ov;
  const eps = 1e-4;

  const knots = [zMin, zMax, a.zFront, a.zBack, b.zFront, b.zBack];
  for (const sec of [a, b]) knots.push(sec.ridgeCutZ - eps, sec.ridgeCutZ + eps);
  let zs = [...new Set(knots)].filter((z) => z >= zMin - eps && z <= zMax + eps).sort((p, q) => p - q);

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

/** One roof section: its two planes, their fascia, and its clerestory. */
function buildRoofSection(sec, span, dim, materials, sections) {
  const { widthFt: W, eaveOverhangFt: ov } = dim;
  const g = new THREE.Group();
  g.name = `roofSection:${sec.index}`;
  g.userData.roofSection = sec.index;
  const FW = fasciaWidth(dim);

  const bodyLen = Math.max(0.05, span.body[1] - span.body[0]);
  const bodyCx = (span.body[0] + span.body[1]) / 2;

  if (sec.flat) {
    const len = Math.max(0.05, span.front[1] - span.front[0]);
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(len, ROOF_THICK, sec.widthFt + 2 * ov), materials.roof);
    slab.position.set((span.front[0] + span.front[1]) / 2, sec.topY + ROOF_THICK / 2,
      (sec.zFront + sec.zBack) / 2);
    slab.castShadow = true;
    slab.receiveShadow = true;
    slab.name = 'roofPlane:flat';
    g.add(slab);
    return g;
  }

  const sides = [
    {
      which: 'front', sign: -1, edgeZ: sec.zFront - ov, eave: sec.eaveYFront,
      angle: sec.angleFront, slope: sec.slopeFront, peakY: sec.frontPeakY,
      peakZ: sec.ridgeZ + Math.max(0, sec.ridgeSail), sail: sec.ridgeSail > 0,
    },
    {
      which: 'back', sign: 1, edgeZ: sec.zBack + ov, eave: sec.eaveYBack,
      angle: sec.angleBack, slope: sec.slopeBack, peakY: sec.backPeakY,
      peakZ: sec.ridgeZ + Math.min(0, sec.ridgeSail), sail: sec.ridgeSail < 0,
    },
  ];

  for (const s of sides) {
    const [xa, xb] = span[s.which];
    const len = Math.max(0.05, xb - xa);
    const cx = (xa + xb) / 2;
    // A sailing plane keeps climbing past the ridge, so its top corner is
    // higher than its peak by however far it reached.
    const topY = s.peakY + Math.abs(s.peakZ - sec.ridgeZ) * s.slope;
    const run = Math.abs(s.edgeZ - s.peakZ);
    if (run < 0.02) continue;
    const slopeLen = run / Math.cos(s.angle);
    const dripY = s.eave - ov * s.slope;
    const midZ = (s.peakZ + s.edgeZ) / 2;
    const midY = (topY + dripY) / 2;
    const n = new THREE.Vector3(0, Math.cos(s.angle), s.sign * Math.sin(s.angle));
    const half = new THREE.Mesh(new THREE.BoxGeometry(len, ROOF_THICK, slopeLen), materials.roof);
    half.position.set(cx, midY - n.y * ROOF_THICK / 2, midZ - n.z * ROOF_THICK / 2);
    half.rotation.x = s.sign * s.angle;
    half.castShadow = true;
    half.receiveShadow = true;
    half.name = `roofPlane:${s.which}`;
    g.add(half);

    const fascia = buildFascia(dim, materials, s.sign,
      s.sign < 0 ? -sec.zFront + ov : sec.zBack + ov, s.eave, s.slope, xa, xb);
    if (fascia) g.add(fascia);

    // The sailing edge is a free drip edge, so it gets boarded like an eave.
    if (s.sail) {
      const board = new THREE.Mesh(new THREE.BoxGeometry(len, FW, 0.16), materials.fascia);
      board.position.set(cx, topY - FW / 2 + 0.05, s.peakZ);
      board.castShadow = true;
      board.name = 'ridgeFascia';
      g.add(board);
    }

    // A board goes on a raked end only where the roof hangs past something —
    // a butted interior joint has no exposed edge to trim.
    if (dim.stepRakeFascia !== false) {
      for (const [i, x] of [[0, xa + 0.09], [1, xb - 0.09]]) {
        if (!span.rake[s.which][i]) continue;
        const z0 = s.peakZ;
        const y0 = topY;
        const z1 = s.edgeZ;
        const y1 = dripY;
        const ang = Math.atan2(y1 - y0, z1 - z0);
        const board = new THREE.Mesh(
          new THREE.BoxGeometry(0.18, FW, Math.hypot(z1 - z0, y1 - y0)),
          materials.fascia,
        );
        const nb = new THREE.Vector3(0, Math.cos(ang), -Math.sin(ang));
        board.rotation.x = -ang;
        board.position.set(x, (y0 + y1) / 2 - nb.y * (FW / 2 - 0.05), (z0 + z1) / 2 - nb.z * (FW / 2 - 0.05));
        board.castShadow = true;
        board.name = 'rakeBoard';
        g.add(board);
      }
    }
  }

  // Where the peaks disagree, the gap between the two planes is a clerestory
  // wall standing on the lower one.
  const lowY = Math.min(sec.frontPeakY, sec.backPeakY);
  const highY = Math.max(sec.frontPeakY, sec.backPeakY);
  if (highY - lowY > 0.02) {
    const bottom = lowY - ROOF_THICK - 0.1;
    const wall = new THREE.Mesh(new THREE.BoxGeometry(bodyLen, highY - bottom, 0.36), materials.siding);
    wall.position.set(bodyCx, (highY + bottom) / 2, sec.ridgeZ);
    wall.castShadow = true;
    wall.receiveShadow = true;
    wall.name = 'ridgeStep';
    g.add(wall);

    const cap = new THREE.Mesh(new THREE.BoxGeometry(bodyLen, 0.42, 0.6), materials.fascia);
    cap.position.set(bodyCx, highY - 0.16, sec.ridgeZ);
    cap.castShadow = true;
    g.add(cap);
  }

  return g;
}

function buildRoof(dim, materials) {
  const rake = num(dim.rakeOverhangFt, 0.75);
  const g = new THREE.Group();
  g.name = 'roof';

  const sections = resolveRoofSections(dim);
  const endRake = dim.endRakeFascia === true && rake > 0;

  for (let i = 0; i < sections.length; i++) {
    const sec = sections[i];
    const prev = sections[i - 1];
    const next = sections[i + 1];
    const first = i === 0;
    const last = i === sections.length - 1;

    // Each end of each plane reaches out on its own: the gable ends by the rake
    // overhang, an interior boundary by the step overhang when this section's
    // roof stands above its neighbour's.
    const reach = (which) => [
      first ? rake : stepOverhang(sec, prev, which, dim),
      last ? rake : stepOverhang(sec, next, which, dim),
    ];
    const extent = (out) => [sec.x0 - out[0], sec.x1 + out[1]];
    const trim = (out) => [
      (first ? endRake : dim.stepRakeFascia !== false) && out[0] > 0.01,
      (last ? endRake : dim.stepRakeFascia !== false) && out[1] > 0.01,
    ];
    const frontOut = reach('front');
    const backOut = reach('back');

    const built = buildRoofSection(sec, {
      body: [sec.x0 - (first ? rake : 0), sec.x1 + (last ? rake : 0)],
      front: extent(frontOut),
      back: extent(backOut),
      rake: { front: trim(frontOut), back: trim(backOut) },
    }, dim, materials, sections);
    if (sections.length === 1) {
      // Unsectioned roofs keep the tree they have always had, so anything that
      // looks up a roof part by name still finds it where it was.
      for (const child of [...built.children]) g.add(child);
    } else {
      g.add(built);
    }
  }

  for (let i = 0; i + 1 < sections.length; i++) {
    const wall = buildSectionTransition(sections[i], sections[i + 1], dim, materials);
    if (wall) g.add(wall);
  }

  const dormers = buildDormers(dim, materials);
  if (dormers) g.add(dormers);

  return g;
}

/** Effective size of dormer `i`. Per-dormer overrides win when sizes are
 *  unlinked; otherwise every dormer uses the global width/height. */
export function dormerSize(dim, i) {
  const globalW = dim.dormerWidthFt ?? 10.0;
  const globalH = dim.dormerHeightFt ?? 4.5;
  if (dim.dormerLinkSizes === false && Array.isArray(dim.dormerSizes)) {
    const s = dim.dormerSizes[i];
    if (s) {
      return {
        dW: Number.isFinite(+s.widthFt) && +s.widthFt > 0 ? +s.widthFt : globalW,
        dH: Number.isFinite(+s.heightFt) && +s.heightFt > 0 ? +s.heightFt : globalH,
      };
    }
  }
  return { dW: globalW, dH: globalH };
}

function buildDormers(dim, materials) {
  const count = parseInt(dim.dormerCount, 10) || 0;
  if (count <= 0 || dim.roofStyle === 'flat') return null;

  const g = new THREE.Group();
  g.name = 'dormers';

  const isContinuous = dim.dormerContinuousWall === true;
  const isDripEdgeOn = dim.dormerDripEdge !== false && !isContinuous;
  const dormerMat = isContinuous ? materials.siding : (materials.dormerSiding || materials.siding);

  // Dormers ride the front slope, so they follow the FRONT eave and the front
  // pitch — on a split-pitch roof those are not the averages, and on a
  // sectioned roof they belong to whichever section the dormer stands over.
  const roofSections = resolveRoofSections(dim);
  const footing = (x) => {
    const sec = sectionAtX(roofSections, x);
    return { slope: sec.slopeFront, eaveY: sec.eaveYFront };
  };
  const { slopeFront: slope, eaveYFront: eaveY } = roofSections[0];
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

    // Order the two dormers left-to-right so each end of the cap uses its own
    // width, and let the taller of the pair set the cap height.
    const order = xPositions[0] <= xPositions[1] ? [0, 1] : [1, 0];
    const sizeL = dormerSize(dim, order[0]);
    const sizeR = dormerSize(dim, order[1]);
    const dH = Math.max(sizeL.dH, sizeR.dH);
    const capLeft  = xPositions[order[0]] - sizeL.dW / 2;
    const capRight = xPositions[order[1]] + sizeR.dW / 2;
    const capWidth = capRight - capLeft;
    const capCenterX = (capLeft + capRight) / 2;
    // The cap sits on whichever section it spans the middle of.
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
      dormerMat
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
        dormerMat
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

    // 4. Eave returns — false eave trim on each outer side (omitted when isContinuous is true for a 100% seamless wall).
    if (dim.dormerFalseEave !== false && !isContinuous) {
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

      // Bottom trim across the eave line (drip edge).
      if (isDripEdgeOn) {
        const bottomTrim = new THREE.Mesh(
          new THREE.BoxGeometry(capWidth + 2.4, 0.35, 0.18),
          materials.trim
        );
        bottomTrim.position.set(capCenterX, eaveY - 0.18, dormerFrontZ + 0.05);
        bottomTrim.castShadow = true;
        bottomTrim.userData.dormerIndex = 0;
        capGroup.add(bottomTrim);
      }
    }

    // 5. Accent windows — one in each dormer position.
    if (dim.dormerWindow !== false) {
      for (let i = 0; i < xPositions.length; i++) {
        const posX = xPositions[i];
        const size = dormerSize(dim, i);
        const winW = Math.min(3.2, size.dW * 0.4);
        const winH = Math.min(2.5, size.dH * 0.5);

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

  // ── Nested dormers (gable-inside-gable) ──────────────────────────────
  // Dormer 0 is the wide outer gable; dormer 1 is a smaller gable that sits
  // inside it, projecting forward of the outer face. Sizes are independent —
  // the inner gable is clamped to stay inside the outer one.
  if (count === 2 && dim.dormerNested) {
    const outer = dormerSize(dim, 0);
    const inner = dormerSize(dim, 1);
    const nestOffset = +dim.dormerNestOffsetFt || 0;
    const innerW = Math.min(inner.dW, outer.dW - 1.5);
    const innerH = Math.min(inner.dH, outer.dH - 0.5);
    // Keep the inner gable's footprint inside the outer gable's front face.
    const maxOffset = Math.max(0, (outer.dW - innerW) / 2 - 0.5);
    const innerX = xPositions[0] + Math.max(-maxOffset, Math.min(maxOffset, nestOffset));

    const nestFoot = footing(xPositions[0]);
    g.add(gableDormer(dim, materials, {
      index: 0, posX: xPositions[0], dW: outer.dW, dH: outer.dH,
      frontZ: dormerFrontZ, ...nestFoot, ov,
    }));
    g.add(gableDormer(dim, materials, {
      index: 1, posX: innerX, dW: innerW, dH: innerH,
      // Project forward of the outer face so the inner gable reads as nested.
      frontZ: dormerFrontZ - 0.7, ...nestFoot, ov,
      // The inner gable stops at the outer gable's slope, not the main ridge.
      depth: (innerH / (nestFoot.slope || 0.33)) * 0.6 + 0.7,
    }));
    return g;
  }

  // ── Individual (separate) dormers ────────────────────────────────────
  for (let i = 0; i < xPositions.length; i++) {
    const { dW, dH } = dormerSize(dim, i);
    g.add(gableDormer(dim, materials, {
      index: i, posX: xPositions[i], dW, dH, frontZ: dormerFrontZ,
      ...footing(xPositions[i]), ov,
    }));
  }

  return g;
}

/** One gable dormer assembly: front gable, false eave returns, roof slopes and
 *  accent window. `frontZ` and `depth` let a nested dormer sit forward of, and
 *  shallower than, the outer gable it is tucked into. */
function gableDormer(dim, materials, opts) {
  const { index: i, posX, dW, dH, frontZ: dormerFrontZ, eaveY, slope, ov } = opts;
  const isContinuous = dim.dormerContinuousWall === true;
  const isDripEdgeOn = dim.dormerDripEdge !== false && !isContinuous;
  const dormerMat = isContinuous ? materials.siding : (materials.dormerSiding || materials.siding);
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
  const frontGable = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, extrudeOpts), dormerMat);
  frontGable.position.set(posX, eaveY, dormerFrontZ);
  frontGable.castShadow = true;
  frontGable.userData.dormerIndex = i;
  dormerGroup.add(frontGable);

  // 2. False Eave Return Band — outer (if enabled and drip edge on)
  if (dim.dormerFalseEave !== false && isDripEdgeOn) {
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
  const dormerDepth = opts.depth ?? ((dH / (slope || 0.33)) + ov * 0.5);

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

  return dormerGroup;
}

// ---------------------------------------------------------------------------
// Bump-outs, recesses and covered porches
// ---------------------------------------------------------------------------

/**
 * One bump attached to one wall.
 *
 * Everything is laid out in the wall's own frame: `u` runs left→right as seen
 * from outside, `v` is height above the floor deck, `w` is distance OUTWARD
 * from the wall plane. A box rotated by `q` has its local +X on `u`, +Y on `v`
 * and +Z on `w`, so a piece can be described the way it would be paced off on
 * site and dropped into world space unchanged.
 */
function buildBump(b, frame, home, materials) {
  const dim = home.dimensions;
  const F = dim.floorHeightFt;
  const wallH = getWallHeight(b.wall, dim);
  const h = bumpHeight(b, wallH);
  const out = isProjecting(b);
  const d = Math.abs(b.depthFt);
  const u0 = b.offsetFt;
  const u1 = b.offsetFt + b.lengthFt;
  const uc = (u0 + u1) / 2;
  const len = b.lengthFt;
  const porch = b.kind === 'porch';

  const g = new THREE.Group();
  g.name = `bump:${b.id}`;
  g.userData.bump = b.id;

  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), frame.right);
  const sign = out ? 1 : -1;   // which way `w` runs from the wall plane
  // A bump hangs off the wall it is on, and that stretch of wall may have been
  // set in with its section — so a porch on a set-in half stands against the
  // moved wall rather than out at the base rectangle.
  const setIn = wallInsetAt(b.wall, b.offsetFt + b.lengthFt / 2, dim);
  const at = (u, v, w) => {
    const p = frame.origin.clone()
      .addScaledVector(frame.right, u)
      .addScaledVector(frame.normal, sign * w - setIn);
    p.y = F + v;
    return p;
  };
  const box = (sizeU, sizeV, sizeW, u, v, w, material, opts = {}) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sizeU, sizeV, sizeW), material);
    m.position.copy(at(u, v, w));
    m.quaternion.copy(q);
    m.castShadow = opts.shadow !== false;
    m.receiveShadow = opts.shadow !== false;
    m.userData.bump = b.id;
    g.add(m);
    return m;
  };

  const T = WALL_THICK;

  // The moved face itself — the front of a bump-out, the back of a recess — is
  // built by the wall builder, so it carries its openings as real voids. What
  // is left here is everything that closes the sides of the box.
  if (out && !porch) {
    // Enclosed bump-out: the siding wraps the returns and the underside.
    box(T, h, d, u0 + T / 2, h / 2, d / 2, materials.siding);         // left return
    box(T, h, d, u1 - T / 2, h / 2, d / 2, materials.siding);         // right return
    if (F > 0.01) box(len, F, d, uc, -F / 2, d / 2, materials.skirting);
    if (b.window) {
      const ww = Math.min(b.windowWidthFt, len - 1);
      const wh = Math.min(b.windowHeightFt, h - 1.5);
      const sill = Math.max(0.5, h - 1.0 - wh);
      box(ww + 0.5, wh + 0.5, 0.1, uc, sill + wh / 2, d + 0.02, materials.trim);
      box(ww, wh, 0.1, uc, sill + wh / 2, d + 0.04, materials.glass);
    }
  } else if (!out) {
    // Recess: the wall steps back into the footprint. The header of siding above
    // it and the wall at the back of it both come from the wall builder; this is
    // the inside of the notch.
    box(T, h, d, u0 + T / 2, h / 2, d / 2, materials.siding);         // left reveal
    box(T, h, d, u1 - T / 2, h / 2, d / 2, materials.siding);         // right reveal
    box(len, 0.25, d, uc, h + 0.125, d / 2, materials.trim);          // ceiling
    if (porch) box(len, 0.4, d, uc, -0.2, d / 2, materials.deck);     // porch floor
  } else {
    // Projecting porch: a deck standing in front of a wall that is still there.
    if (b.deck !== false) {
      box(len, 0.5, d, uc, -0.25, d / 2, materials.deck);
      if (F > 0.5) box(len - 0.3, F - 0.5, d - 0.3, uc, -0.5 - (F - 0.5) / 2, d / 2, materials.skirting);
    }
  }

  // ── Posts and railing — what makes a porch read as a porch ──────────────
  if (porch) {
    const railMat = materials.rail_white;
    const postH = h - 0.1;
    const postW = 0.45;
    const nPosts = Math.max(2, b.posts || 2);
    const postU = [];
    for (let i = 0; i < nPosts; i++) {
      postU.push(u0 + postW / 2 + (len - postW) * (i / (nPosts - 1)));
    }
    // Posts stand on the OUTER edge of the deck — which for a recessed porch is
    // the wall line the notch was cut back from, not the far end of the notch.
    const postEdgeW = out ? d - postW / 2 : postW;
    for (const u of postU) box(postW, postH, postW, u, postH / 2, postEdgeW, materials.trim);

    if (b.railing !== false) {
      const railH = 3.0;
      const rail = (sizeU, sizeW, u, w) => {
        box(sizeU, 0.12, sizeW, u, railH, w, railMat);          // top rail
        box(sizeU, 0.12, sizeW, u, 0.35, w, railMat);           // bottom rail
        // Balusters between them.
        const along = Math.max(sizeU, sizeW);
        const n = Math.max(1, Math.floor(along / 0.4));
        for (let i = 1; i <= n; i++) {
          const t = i / (n + 1) - 0.5;
          box(0.09, railH - 0.35, 0.09,
            sizeU > sizeW ? u + t * sizeU : u,
            0.35 + (railH - 0.35) / 2,
            sizeW > sizeU ? w + t * sizeW : w,
            railMat, { shadow: false });
        }
      };
      // The railing follows the posts on the outer edge, and returns to the
      // wall down each end of the porch.
      const edgeW = postEdgeW;
      const sideRun = Math.max(0.5, d - postW);
      const sideMid = out ? d - sideRun / 2 : sideRun / 2;
      rail(len, 0.12, uc, edgeW);
      rail(0.12, sideRun, u0 + 0.1, sideMid);
      rail(0.12, sideRun, u1 - 0.1, sideMid);
    }
  }

  // ── Roof cap ────────────────────────────────────────────────────────────
  // 'none' is the right answer for a recessed porch: the main roof already
  // covers it, which is exactly why a recess exists on a spec sheet.
  const capPitch = (b.roofPitchFt ?? 2) / 12;
  if (out && b.roof === 'flat') {
    box(len + 0.8, 0.35, d + 0.4, uc, h + 0.175, d / 2 + 0.2, materials.roof);
  } else if (out && b.roof === 'shed') {
    const drop = d * capPitch;
    const ang = Math.atan2(drop, d);
    const slabLen = Math.hypot(d + 0.4, drop);
    const m = new THREE.Mesh(new THREE.BoxGeometry(len + 0.8, 0.35, slabLen), materials.roof);
    m.position.copy(at(uc, h - drop / 2 + 0.175, d / 2 + 0.2));
    m.quaternion.copy(q);
    m.rotateX(-ang);
    m.castShadow = true;
    m.userData.bump = b.id;
    g.add(m);
    box(len + 0.8, fasciaWidth(dim), 0.16, uc, h - drop - fasciaWidth(dim) / 2, d + 0.4, materials.fascia);
  } else if (out && b.roof === 'gable') {
    // Ridge parallel to the wall at mid-depth, gable faces on the two ends —
    // the porch profile on the dealer-lot photo.
    const drop = (d / 2) * capPitch;
    const ang = Math.atan2(drop, d / 2);
    const slabLen = Math.hypot(d / 2 + 0.3, drop);
    for (const s of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(len + 0.8, 0.35, slabLen), materials.roof);
      m.position.copy(at(uc, h - drop / 2 + 0.175, d / 2 + s * (d / 4 + 0.15)));
      m.quaternion.copy(q);
      m.rotateX(s * ang);
      m.castShadow = true;
      m.userData.bump = b.id;
      g.add(m);
    }
    for (const u of [u0, u1]) {
      const face = new THREE.Shape();
      face.moveTo(-d / 2, 0);
      face.lineTo(d / 2, 0);
      face.lineTo(0, drop);
      face.closePath();
      const m = new THREE.Mesh(extrude(face, 0.15), materials.gableSiding || materials.siding);
      m.position.copy(at(u, h - drop, d / 2));
      m.quaternion.copy(q);
      m.rotateY(Math.PI / 2);
      m.castShadow = true;
      m.userData.bump = b.id;
      g.add(m);
    }
    box(len + 0.8, fasciaWidth(dim), 0.16, uc, h - drop - fasciaWidth(dim) / 2, d + 0.35, materials.fascia);
  }

  return g;
}

function buildBumps(home, materials) {
  const bumps = home.bumps || [];
  if (!bumps.length) return null;
  const frames = wallFrames(home.dimensions);
  const g = new THREE.Group();
  g.name = 'bumps';
  for (const b of bumps) {
    const f = frames[b.wall];
    if (!f) continue;
    g.add(buildBump(b, f, home, materials));
  }
  return g;
}

function buildSkirting(dim, materials) {
  if (dim.floorHeightFt <= 0.01) return null;
  const inset = 0.06;
  const g = new THREE.Group();
  g.name = 'skirting';
  // One block per section, each as wide as that section's own footprint, so a
  // set-in half is skirted where its walls are rather than out at the base
  // rectangle.
  for (const sec of resolveRoofSections(dim)) {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(
        Math.max(0.05, sec.x1 - sec.x0 - inset),
        dim.floorHeightFt,
        Math.max(0.05, sec.widthFt - inset),
      ),
      materials.skirting,
    );
    m.position.set((sec.x0 + sec.x1) / 2, dim.floorHeightFt / 2, (sec.zFront + sec.zBack) / 2);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  }
  return g;
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

      const showLeft = railings === 'left' || railings === 'both' || railings === 'all';
      const showRight = railings === 'right' || railings === 'both' || railings === 'all';
      const showOuter = railings === 'outer' || railings === 'both' || railings === 'all';

      const balusterW = 0.06;
      const balusterH = railH - 0.25;

      const addPost = (xRel, zRel, yBase, pHeight = railH) => {
        const post = new THREE.Mesh(new THREE.BoxGeometry(postW, pHeight, postW), railMat);
        const pos = f.origin.clone()
          .addScaledVector(f.right, uCenter + xRel)
          .addScaledVector(f.normal, zRel);
        pos.y = yBase + pHeight / 2;
        post.position.copy(pos);
        post.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), f.right);
        post.castShadow = true;
        stepGroup.add(post);
      };

      const addHorizRail = (xRel, zRel, lenX, lenZ, yPos) => {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(lenX, 0.12, lenZ), railMat);
        const pos = f.origin.clone()
          .addScaledVector(f.right, uCenter + xRel)
          .addScaledVector(f.normal, zRel);
        pos.y = yPos;
        rail.position.copy(pos);
        rail.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), f.right);
        rail.castShadow = true;
        stepGroup.add(rail);
      };

      const addSlopedRail = (pStartRel, pEndRel) => {
        const start = f.origin.clone()
          .addScaledVector(f.right, uCenter + pStartRel.x)
          .addScaledVector(f.normal, pStartRel.z);
        start.y = pStartRel.y;

        const end = f.origin.clone()
          .addScaledVector(f.right, uCenter + pEndRel.x)
          .addScaledVector(f.normal, pEndRel.z);
        end.y = pEndRel.y;

        const vec = end.clone().sub(start);
        const len = vec.length();
        const mid = start.clone().add(end).multiplyScalar(0.5);

        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, len), railMat);
        rail.position.copy(mid);
        rail.lookAt(end);
        rail.castShadow = true;
        stepGroup.add(rail);
      };

      const addHorizBalusters = (xStart, zStart, xEnd, zEnd, yBase) => {
        if (balusterStyle === 'open') return;
        const dx = xEnd - xStart;
        const dz = zEnd - zStart;
        const len = Math.hypot(dx, dz);
        const spacing = 0.35;
        const num = Math.max(1, Math.floor((len - postW * 2) / spacing));
        const stepDist = (len - postW * 2) / (num + 1);

        for (let k = 1; k <= num; k++) {
          const frac = (postW + k * stepDist) / len;
          const bx = xStart + dx * frac;
          const bz = zStart + dz * frac;

          if (balusterStyle === 'balusters') {
            const b = new THREE.Mesh(new THREE.BoxGeometry(balusterW, balusterH, balusterW), railMat);
            const pos = f.origin.clone()
              .addScaledVector(f.right, uCenter + bx)
              .addScaledVector(f.normal, bz);
            pos.y = yBase + balusterH / 2 + 0.1;
            b.position.copy(pos);
            b.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), f.right);
            b.castShadow = true;
            stepGroup.add(b);
          } else if (balusterStyle === 'horizontal_cables') {
            for (const hPct of [0.25, 0.50, 0.75]) {
              const cable = new THREE.Mesh(
                new THREE.BoxGeometry(Math.abs(dx) > Math.abs(dz) ? len : balusterW, 0.04, Math.abs(dz) > Math.abs(dx) ? len : balusterW),
                railMat
              );
              const pos = f.origin.clone()
                .addScaledVector(f.right, uCenter + (xStart + xEnd) / 2)
                .addScaledVector(f.normal, (zStart + zEnd) / 2);
              pos.y = yBase + railH * hPct;
              cable.position.copy(pos);
              cable.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), f.right);
              stepGroup.add(cable);
            }
            break;
          }
        }
      };

      // 1. Landing Side End Railings (Left & Right)
      if (showLeft) {
        addPost(-wide / 2 + postW / 2, postW / 2, top);
        addPost(-wide / 2 + postW / 2, landingDepth - postW / 2, top);
        addHorizRail(-wide / 2 + postW / 2, landingDepth / 2, postW, landingDepth, top + railH);
        addHorizBalusters(-wide / 2 + postW / 2, postW, -wide / 2 + postW / 2, landingDepth - postW, top);
      }
      if (showRight) {
        addPost(wide / 2 - postW / 2, postW / 2, top);
        addPost(wide / 2 - postW / 2, landingDepth - postW / 2, top);
        addHorizRail(wide / 2 - postW / 2, landingDepth / 2, postW, landingDepth, top + railH);
        addHorizBalusters(wide / 2 - postW / 2, postW, wide / 2 - postW / 2, landingDepth - postW, top);
      }

      // 2. Side Away From House (Landing Front Outer Edge)
      if (showOuter && egress !== 'front') {
        addPost(-wide / 2 + postW / 2, landingDepth - postW / 2, top);
        addPost(wide / 2 - postW / 2, landingDepth - postW / 2, top);
        addHorizRail(0, landingDepth - postW / 2, wide, postW, top + railH);
        addHorizBalusters(-wide / 2 + postW, landingDepth - postW / 2, wide / 2 - postW, landingDepth - postW / 2, top);
      }

      // 3. Descending Stair Flights Railings
      const totalRun = count * tread;
      const sideDirs = [];
      if (egress === 'left' || egress === 'split') sideDirs.push(-1);
      if (egress === 'right' || egress === 'split') sideDirs.push(1);

      if (egress === 'front') {
        const sides = [];
        if (showLeft) sides.push(-wide / 2 + postW / 2);
        if (showRight) sides.push(wide / 2 - postW / 2);

        for (const sx of sides) {
          addPost(sx, landingDepth + totalRun - postW / 2, 0);
          addSlopedRail(
            { x: sx, z: landingDepth - postW / 2, y: top + railH },
            { x: sx, z: landingDepth + totalRun - postW / 2, y: railH }
          );

          if (balusterStyle === 'balusters') {
            for (let i = 0; i < count; i++) {
              const stepY = i * rise;
              const stepZ = landingDepth + tread * (count - i - 0.5);
              const b = new THREE.Mesh(new THREE.BoxGeometry(balusterW, balusterH, balusterW), railMat);
              const pos = f.origin.clone()
                .addScaledVector(f.right, uCenter + sx)
                .addScaledVector(f.normal, stepZ);
              pos.y = stepY + balusterH / 2 + 0.1;
              b.position.copy(pos);
              b.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), f.right);
              b.castShadow = true;
              stepGroup.add(b);
            }
          }
        }
      } else {
        for (const dir of sideDirs) {
          const endX = dir * (wide / 2 + totalRun - postW / 2);
          const startX = dir * (wide / 2);
          const zOuter = landingDepth - postW / 2;

          if (showOuter || (dir === -1 && showLeft) || (dir === 1 && showRight)) {
            addPost(endX, zOuter, 0);
            addSlopedRail(
              { x: startX, z: zOuter, y: top + railH },
              { x: endX, z: zOuter, y: railH }
            );

            if (balusterStyle === 'balusters') {
              for (let i = 0; i < count; i++) {
                const stepY = i * rise;
                const stepX = dir * (wide / 2 + tread * (count - i - 0.5));
                const b = new THREE.Mesh(new THREE.BoxGeometry(balusterW, balusterH, balusterW), railMat);
                const pos = f.origin.clone()
                  .addScaledVector(f.right, uCenter + stepX)
                  .addScaledVector(f.normal, zOuter);
                pos.y = stepY + balusterH / 2 + 0.1;
                b.position.copy(pos);
                b.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), f.right);
                b.castShadow = true;
                stepGroup.add(b);
              }
            }
          }

          if (showLeft && dir === -1) {
            addPost(endX, postW / 2, 0);
            addHorizRail(endX, landingDepth / 2, postW, landingDepth, railH);
          }
          if (showRight && dir === 1) {
            addPost(endX, postW / 2, 0);
            addHorizRail(endX, landingDepth / 2, postW, landingDepth, railH);
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

function buildFootprintOutline(dim, bumps = []) {
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

  // Bumps get their own outline, so tracing the plan plate shows where the
  // rectangle stops being the truth.
  for (const b of bumps) {
    const f = bumpFootprint(b, dim);
    const y = 0.03;
    const box = [
      new THREE.Vector3(f.minX, y, f.minZ),
      new THREE.Vector3(f.maxX, y, f.minZ),
      new THREE.Vector3(f.maxX, y, f.maxZ),
      new THREE.Vector3(f.minX, y, f.maxZ),
      new THREE.Vector3(f.minX, y, f.minZ),
    ];
    g.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(box),
      new THREE.LineBasicMaterial({ color: isRecess(b) ? 0xffb861 : 0x6fb2ff }),
    ));
  }

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

function buildCornerTrim(dim, materials) {
  if (dim.cornerTrim === false) return null;
  const g = new THREE.Group();
  g.name = 'cornerTrim';

  const w = Math.max(0.05, num(dim.cornerTrimWidthFt, 0.5));
  const t = 0.12;
  const dv = derived(dim);
  const minY = dim.floorHeightFt;

  const halfL = dim.lengthFt / 2;
  const halfW = dim.widthFt / 2;
  if (w * 2 >= dim.lengthFt || w * 2 >= dim.widthFt) return g;

  const corners = [
    { x: -halfL, z: -halfW, signX: -1, signZ: -1 },
    { x:  halfL, z: -halfW, signX:  1, signZ: -1 },
    { x:  halfL, z:  halfW, signX:  1, signZ:  1 },
    { x: -halfL, z:  halfW, signX: -1, signZ:  1 },
  ];

  for (const c of corners) {
    // Each board lies flat ON its own wall, running INWARD from the corner —
    // measuring outward from it hangs the board off the end of the wall in mid
    // air, which is what the pair used to do. `signX`/`signZ` point out of the
    // footprint, so the face a board is proud of is the +sign direction and the
    // wall it covers runs back the -sign way.
    const onFront = c.signZ < 0;
    // A board dies into the eave of the wall it is on. On a split pitch the
    // front and back eaves sit at different heights, so the pair at one corner
    // is not the same length as the pair at the far one.
    const endSec = c.signX < 0 ? dv.sections[0] : dv.sections[dv.sections.length - 1];
    const eaveY = onFront ? endSec.eaveYFront : endSec.eaveYBack;
    // Follow that section's wall line, so a corner of a set-in half is trimmed
    // where its walls actually are.
    const cz = onFront ? endSec.zFront : endSec.zBack;
    const longH = eaveY - minY;
    // The gable end takes its corner height from the long wall it meets, unless
    // someone typed a height for that end, in which case they meant it.
    const endName = c.signX < 0 ? 'left' : 'right';
    const endH = customWallHeight(endName, dim) ?? longH;
    if (longH <= 0.1 || endH <= 0.1) continue;

    // Long wall: `w` across the wall, thin in Z, standing proud of its face.
    // It laps `t` past the corner to cover the end board's edge.
    const boardLong = new THREE.Mesh(new THREE.BoxGeometry(w + t, longH, t), materials.corner);
    boardLong.position.set(
      c.x + c.signX * (t - w) / 2,
      minY + longH / 2,
      cz + c.signZ * (t / 2),
    );
    boardLong.castShadow = true;
    boardLong.name = 'cornerBoard';
    g.add(boardLong);

    // Gable end: thin in X, `w` across the wall, proud of the end face.
    const boardEnd = new THREE.Mesh(new THREE.BoxGeometry(t, endH, w), materials.corner);
    boardEnd.position.set(
      c.x + c.signX * (t / 2),
      minY + endH / 2,
      cz - c.signZ * (w / 2),
    );
    boardEnd.castShadow = true;
    boardEnd.name = 'cornerBoard';
    g.add(boardEnd);
  }

  return g;
}

export function buildHome(home, sceneOpts = {}) {
  applyHeadAlign(home);
  const dim = home.dimensions;
  for (const b of home.bumps || []) clampBump(b, dim);
  const materials = {
    siding: createSidingMaterial(home.colors.siding, dim.sidingTexture || 'horizontal_lap'),
    belowDormerSiding: createSidingMaterial(home.colors.belowDormerSiding || home.colors.siding, dim.sidingTexture || 'horizontal_lap'),
    dormerSiding: createSidingMaterial(home.colors.dormerSiding || home.colors.siding, dim.dormerSidingTexture || dim.sidingTexture || 'horizontal_lap'),
    gableSiding: createSidingMaterial(home.colors.gableSiding || home.colors.siding, dim.gableSidingTexture || dim.sidingTexture || 'horizontal_lap'),
    trim: mat(home.colors.trim, { roughness: 0.75 }),
    fascia: mat(home.colors.fascia ?? home.colors.trim, { roughness: 0.75 }),
    corner: mat(home.colors.corner ?? home.colors.trim, { roughness: 0.78 }),
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
  // Porch decks follow whatever the stairs are built from, so a deck and the
  // steps down off it are the same material without a second control.
  materials.deck = materials[sceneOpts?.stepMat] || materials.pressure_treated;

  const root = new THREE.Group();
  root.name = 'home';

  const frames = wallFrames(dim);
  for (const [name, f] of Object.entries(frames)) {
    root.add(buildWall(name, f, home, materials));
  }

  root.add(buildRoof(dim, materials));
  const bumps = buildBumps(home, materials);
  if (bumps) root.add(bumps);
  const corners = buildCornerTrim(dim, materials);
  if (corners) root.add(corners);
  const skirt = buildSkirting(dim, materials);
  if (skirt) root.add(skirt);
  if (sceneOpts.steps) root.add(buildSteps(home, materials, sceneOpts));
  if (sceneOpts.labels) root.add(buildCallouts(home));
  if (sceneOpts.dims) root.add(buildFootprintOutline(dim, home.bumps || []));

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
