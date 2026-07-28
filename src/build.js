// Parametric double-wide massing builder.
//
// World axes: +X runs along the home's LENGTH, +Z along its WIDTH, +Y is up.
// The long front wall faces -Z; the gable ends are the short walls at +/-X.
// Ground is y = 0, floor deck sits at y = floorHeightFt.

import * as THREE from 'three';
import { createSidingMaterial } from './textures.js';

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

export function derived(dim) {
  const slope = dim.roofStyle === 'flat' ? 0 : dim.roofPitch / 12;
  const eaveY = dim.floorHeightFt + dim.wallHeightFt;
  const ridgeY = eaveY + (dim.widthFt / 2) * slope;
  return { slope, eaveY, ridgeY, angle: Math.atan(slope) };
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

export function getWallHeight(name, dim) {
  if (!dim) return 8.0;
  const customKey = `${name}WallHeightFt`;
  if (typeof dim[customKey] === 'number' && !Number.isNaN(dim[customKey]) && dim[customKey] > 0) {
    return dim[customKey];
  }
  return dim.wallHeightFt || 8.0;
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

function buildWall(name, frame, home, materials) {
  const dim = home.dimensions;
  const { slope } = derived(dim);
  const H = getWallHeight(name, dim);
  const span = frame.span;
  const openings = home.openings.filter((o) => o.wall === name);

  const group = new THREE.Group();
  group.name = `wall:${name}`;

  const hasGableAccent = frame.gable && dim.roofStyle !== 'flat' && (
    (dim.gableSidingTexture && dim.gableSidingTexture !== dim.sidingTexture) ||
    (home.colors.gableSiding && home.colors.gableSiding !== home.colors.siding)
  );

  if (hasGableAccent) {
    // 1. Rectangular wall body (0 to H) with main siding material
    const rectShape = new THREE.Shape();
    rectShape.moveTo(0, 0);
    rectShape.lineTo(span, 0);
    rectShape.lineTo(span, H);
    rectShape.lineTo(0, H);
    rectShape.closePath();
    for (const o of openings) {
      rectShape.holes.push(rectPath(o.widthFt, o.heightFt, o.offsetFt, o.sillFt));
    }
    const wallBody = new THREE.Mesh(extrude(rectShape, WALL_THICK), materials.siding);
    wallBody.castShadow = true;
    wallBody.receiveShadow = true;
    wallBody.userData.wall = name;
    group.add(wallBody);

    // 2. Triangular gable peak (above H) with gable accent siding material
    const peakShape = new THREE.Shape();
    peakShape.moveTo(0, H);
    peakShape.lineTo(span, H);
    peakShape.lineTo(span / 2, H + (span / 2) * slope);
    peakShape.closePath();
    const gablePeak = new THREE.Mesh(extrude(peakShape, WALL_THICK), materials.gableSiding || materials.siding);
    gablePeak.castShadow = true;
    gablePeak.receiveShadow = true;
    gablePeak.userData.wall = name;
    gablePeak.name = 'gablePeak';
    group.add(gablePeak);
  } else {
    // Single extruded shape for wall + gable peak
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(span, 0);
    shape.lineTo(span, H);
    if (frame.gable && dim.roofStyle !== 'flat') {
      shape.lineTo(span / 2, H + (span / 2) * slope);
    }
    shape.lineTo(0, H);
    shape.closePath();

    for (const o of openings) {
      shape.holes.push(rectPath(o.widthFt, o.heightFt, o.offsetFt, o.sillFt));
    }

    const wall = new THREE.Mesh(extrude(shape, WALL_THICK), materials.siding);
    wall.castShadow = true;
    wall.receiveShadow = true;
    wall.userData.wall = name;
    group.add(wall);
  }

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

function buildFascia(dim, materials, sign, run) {
  const { lengthFt: L, rakeOverhangFt: rake, eaveOverhangFt: ov } = dim;
  const { slope, eaveY } = derived(dim);
  const totalSpan = L + 2 * rake;
  const minX = -totalSpan / 2;
  const maxX = totalSpan / 2;
  const posY = eaveY - ov * slope - FASCIA_H / 2 + 0.05;
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
          new THREE.BoxGeometry(segW, FASCIA_H, 0.16),
          materials.trim
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
        new THREE.BoxGeometry(segW, FASCIA_H, 0.16),
        materials.trim
      );
      seg.position.set(segCenterX, posY, posZ);
      seg.castShadow = true;
      g.add(seg);
    }

    return g;
  }

  // Uninterrupted full-length fascia
  const fascia = new THREE.Mesh(
    new THREE.BoxGeometry(totalSpan, FASCIA_H, 0.16),
    materials.trim
  );
  fascia.position.set(0, posY, posZ);
  fascia.castShadow = true;
  return fascia;
}

function buildRoof(dim, materials) {
  const { widthFt: W, lengthFt: L, eaveOverhangFt: ov, rakeOverhangFt: rake } = dim;
  const { slope, eaveY, angle } = derived(dim);
  const g = new THREE.Group();
  g.name = 'roof';

  if (dim.roofStyle === 'flat') {
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(L + 2 * rake, ROOF_THICK, W + 2 * ov),
      materials.roof,
    );
    slab.position.set(0, eaveY + ROOF_THICK / 2, 0);
    slab.castShadow = true;
    g.add(slab);
    return g;
  }

  const run = W / 2 + ov;               // horizontal run from ridge to eave edge
  const slopeLen = run / Math.cos(angle);

  // Half-plane covering the -Z side. Its underside passes through the eave line
  // at z = -W/2, y = eaveY, and continues out (and down) to the drip edge.
  const half = new THREE.Mesh(
    new THREE.BoxGeometry(L + 2 * rake, ROOF_THICK, slopeLen),
    materials.roof,
  );
  const midZ = -run / 2;
  const midY = eaveY + (W / 2) * slope - (run / 2) * slope;
  const n = new THREE.Vector3(0, Math.cos(angle), -Math.sin(angle)); // plane up-normal
  half.position.set(0, midY - n.y * ROOF_THICK / 2, midZ - n.z * ROOF_THICK / 2);
  half.rotation.x = -angle;
  half.castShadow = true;
  half.receiveShadow = true;
  g.add(half);

  const other = half.clone();
  other.position.z *= -1;
  other.rotation.x = angle;
  g.add(other);

  // Fascia boards at each drip edge.
  for (const sign of [-1, 1]) {
    const fascia = buildFascia(dim, materials, sign, run);
    if (fascia) g.add(fascia);
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

  const { slope, eaveY } = derived(dim);
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

    g.add(gableDormer(dim, materials, {
      index: 0, posX: xPositions[0], dW: outer.dW, dH: outer.dH,
      frontZ: dormerFrontZ, eaveY, slope, ov,
    }));
    g.add(gableDormer(dim, materials, {
      index: 1, posX: innerX, dW: innerW, dH: innerH,
      // Project forward of the outer face so the inner gable reads as nested.
      frontZ: dormerFrontZ - 0.7, eaveY, slope, ov,
      // The inner gable stops at the outer gable's slope, not the main ridge.
      depth: (innerH / (slope || 0.33)) * 0.6 + 0.7,
    }));
    return g;
  }

  // ── Individual (separate) dormers ────────────────────────────────────
  for (let i = 0; i < xPositions.length; i++) {
    const { dW, dH } = dormerSize(dim, i);
    g.add(gableDormer(dim, materials, {
      index: i, posX: xPositions[i], dW, dH, frontZ: dormerFrontZ, eaveY, slope, ov,
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

function buildCornerTrim(dim, materials) {
  if (dim.cornerTrim === false) return null;
  const g = new THREE.Group();
  g.name = 'cornerTrim';

  const w = dim.cornerTrimWidthFt || 0.5;
  const t = 0.12;
  const L = dim.lengthFt;
  const W = dim.widthFt;
  const H = dim.wallHeightFt;
  const minY = dim.floorHeightFt;

  const halfL = L / 2;
  const halfW = W / 2;

  const corners = [
    { x: -halfL, z: -halfW, signX: -1, signZ: -1 },
    { x:  halfL, z: -halfW, signX:  1, signZ: -1 },
    { x:  halfL, z:  halfW, signX:  1, signZ:  1 },
    { x: -halfL, z:  halfW, signX: -1, signZ:  1 },
  ];

  for (const c of corners) {
    const boardX = new THREE.Mesh(new THREE.BoxGeometry(w, H, t), materials.trim);
    boardX.position.set(c.x + c.signX * (w / 2), minY + H / 2, c.z + c.signZ * (t / 2));
    boardX.castShadow = true;
    g.add(boardX);

    const boardZ = new THREE.Mesh(new THREE.BoxGeometry(t, H, w), materials.trim);
    boardZ.position.set(c.x + c.signX * (t / 2), minY + H / 2, c.z + c.signZ * (w / 2));
    boardZ.castShadow = true;
    g.add(boardZ);
  }

  return g;
}

export function buildHome(home, sceneOpts) {
  applyHeadAlign(home);
  const dim = home.dimensions;
  const materials = {
    siding: createSidingMaterial(home.colors.siding, dim.sidingTexture || 'horizontal_lap'),
    belowDormerSiding: createSidingMaterial(home.colors.belowDormerSiding || home.colors.siding, dim.sidingTexture || 'horizontal_lap'),
    dormerSiding: createSidingMaterial(home.colors.dormerSiding || home.colors.siding, dim.dormerSidingTexture || dim.sidingTexture || 'horizontal_lap'),
    gableSiding: createSidingMaterial(home.colors.gableSiding || home.colors.siding, dim.gableSidingTexture || dim.sidingTexture || 'horizontal_lap'),
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
  const corners = buildCornerTrim(dim, materials);
  if (corners) root.add(corners);
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
