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

/** Clamp an opening so it always fits inside its wall and under the eave. */
export function clampOpening(o, dim) {
  const frames = wallFrames(dim);
  const f = frames[o.wall] || frames.front;
  const maxW = Math.max(0.5, f.span - 2 * TRIM_W);
  o.widthFt = Math.min(Math.max(0.5, o.widthFt), maxW);
  o.heightFt = Math.min(Math.max(0.5, o.heightFt), dim.wallHeightFt - 0.4);
  if (o.type === 'door' || o.type === 'slider') {
    o.sillFt = 0;
  } else {
    o.sillFt = Math.min(Math.max(0, o.sillFt), dim.wallHeightFt - o.heightFt - 0.2);
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
  const H = dim.wallHeightFt;
  const span = frame.span;

  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(span, 0);
  shape.lineTo(span, H);
  if (frame.gable && dim.roofStyle !== 'flat') {
    shape.lineTo(span / 2, H + (span / 2) * slope);
  }
  shape.lineTo(0, H);
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
    const fascia = new THREE.Mesh(
      new THREE.BoxGeometry(L + 2 * rake, FASCIA_H, 0.16),
      materials.trim,
    );
    fascia.position.set(0, eaveY - ov * slope - FASCIA_H / 2 + 0.05, sign * run);
    fascia.castShadow = true;
    g.add(fascia);
  }

  const dormers = buildDormers(dim, materials);
  if (dormers) g.add(dormers);

  return g;
}

function buildDormers(dim, materials) {
  const count = parseInt(dim.dormerCount, 10) || 0;
  if (count <= 0 || dim.roofStyle === 'flat') return null;

  const g = new THREE.Group();
  g.name = 'dormers';

  const dW = dim.dormerWidthFt ?? 10.0;
  const dH = dim.dormerHeightFt ?? 4.5;
  const { slope, eaveY } = derived(dim);
  const frontZ = -dim.widthFt / 2;
  const ov = dim.eaveOverhangFt ?? 1.0;
  const dormerFrontZ = frontZ - ov * 0.4;

  const xPositions = count === 1 ? [0] : [-dim.lengthFt * 0.25, dim.lengthFt * 0.25];

  for (const posX of xPositions) {
    const dormerGroup = new THREE.Group();

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
    dormerGroup.add(frontGable);

    // 2. False Eave Return Band (if enabled)
    if (dim.dormerFalseEave !== false) {
      const falseEaveW = dW + 1.2;
      const falseEave = new THREE.Mesh(
        new THREE.BoxGeometry(falseEaveW, 0.55, 0.45),
        materials.trim
      );
      falseEave.position.set(posX, eaveY - 0.28, dormerFrontZ + 0.1);
      falseEave.castShadow = true;
      dormerGroup.add(falseEave);
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
    dormerGroup.add(leftRoof);

    // Right slope
    const rightRoof = new THREE.Mesh(
      new THREE.BoxGeometry(dSlopeLen, 0.35, dormerDepth),
      materials.roof
    );
    rightRoof.position.set(posX + dW / 4, eaveY + dH / 2, dormerFrontZ + dormerDepth / 2);
    rightRoof.rotation.z = -dPitchAngle;
    rightRoof.castShadow = true;
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
      dormerGroup.add(glass);

      const frame = new THREE.Mesh(
        new THREE.BoxGeometry(winW + 0.4, winH + 0.4, 0.08),
        materials.trim
      );
      frame.position.set(posX, eaveY + dH * 0.35, dormerFrontZ - 0.03);
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
