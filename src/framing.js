// Measure where the home actually sits in the current frame.
//
// Image models cannot act on "bigger" or "further left" — they can act on
// "spans 30% to 80% of the image width" and "the ridge sits at 62% of the frame
// height". Those numbers were the hand-guessed blanks in the old prompt
// template; here they are read straight off the camera the user framed, so the
// brief describes the picture already on screen.

import * as THREE from 'three';
import { derived } from './build.js';
import { footprintExtents } from './bumps.js';

const CORNER_LABEL = (x, z) =>
  `${z < 0 ? 'front' : 'rear'}-${x < 0 ? 'left' : 'right'} corner`;

const WALL_NORMALS = [
  ['front wall', new THREE.Vector3(0, 0, -1)],
  ['rear wall', new THREE.Vector3(0, 0, 1)],
  ['left gable end', new THREE.Vector3(-1, 0, 0)],
  ['right gable end', new THREE.Vector3(1, 0, 0)],
];

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/**
 * Project the home's bounding box through the live camera and report where it
 * lands, in fractions of the frame (0 = left/bottom edge, 1 = right/top).
 *
 * Returns null when the model projects to nothing usable — behind the camera,
 * or a degenerate frustum — so callers can fall back to hand-filled blanks
 * rather than print a nonsense percentage.
 */
export function measureFraming(stage, home, viewLabel) {
  if (!stage?.camera || !home?.dimensions) return null;
  const dim = home.dimensions;
  const d = derived(dim);

  // Measured off the real footprint, porches and bump-outs included — the
  // brief's percentages have to describe the thing actually in the frame.
  const e = footprintExtents(dim, home.bumps || []);

  const group = stage.homeGroup;
  group.updateMatrixWorld(true);
  stage.camera.updateMatrixWorld(true);

  const v = new THREE.Vector3();
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  let anyBehind = false;

  for (const x of [e.minX, e.maxX]) {
    for (const y of [0, d.ridgeY]) {
      for (const z of [e.minZ, e.maxZ]) {
        v.set(x, y, z).applyMatrix4(group.matrixWorld).project(stage.camera);
        if (!Number.isFinite(v.x) || !Number.isFinite(v.y)) return null;
        if (v.z > 1) anyBehind = true;
        minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
        minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
      }
    }
  }
  if (anyBehind || maxX <= minX) return null;

  // Ridge line specifically — the top of the box is the ridge on a gable roof,
  // but on a flat roof it is the parapet, and either way it is the height
  // reference the prompt anchors on.
  let ridgeNdcY = -Infinity;
  for (const x of [e.minX, e.maxX]) {
    v.set(x, d.ridgeY, d.ridgeZ || 0).applyMatrix4(group.matrixWorld).project(stage.camera);
    ridgeNdcY = Math.max(ridgeNdcY, v.y);
  }

  // Which corner is nearest, and which walls the camera can see, are both
  // questions about the home's own axes — so ask them in the group's space.
  const camLocal = stage.camera.getWorldPosition(new THREE.Vector3());
  group.worldToLocal(camLocal);

  let nearCorner = CORNER_LABEL(e.maxX, e.minZ), nearD = Infinity;
  let nearCornerX = 0.5, nearCornerY = 0.5;
  for (const x of [e.minX, e.maxX]) {
    for (const z of [e.minZ, e.maxZ]) {
      const dist = (camLocal.x - x) ** 2 + (camLocal.z - z) ** 2;
      if (dist < nearD) {
        nearD = dist;
        nearCorner = CORNER_LABEL(x, z);
        v.set(x, 0, z).applyMatrix4(group.matrixWorld).project(stage.camera);
        nearCornerX = clamp01((v.x + 1) / 2);
        nearCornerY = clamp01((v.y + 1) / 2);
      }
    }
  }

  const visibleWalls = WALL_NORMALS
    .filter(([, n]) => camLocal.x * n.x + camLocal.z * n.z > 0)
    .map(([label]) => label);

  return {
    left: clamp01((minX + 1) / 2),
    right: clamp01((maxX + 1) / 2),
    bottom: clamp01((minY + 1) / 2),
    top: clamp01((maxY + 1) / 2),
    ridgeTop: clamp01((ridgeNdcY + 1) / 2),
    nearCorner,
    nearCornerX,
    nearCornerY,
    visibleWalls,
    viewLabel: viewLabel || stage._lastView || 'current',
    projection: stage.camera === stage.ortho ? 'orthographic' : 'perspective',
  };
}
