// Floor-plan reference plate: a spec-sheet image laid flat on the ground so
// door and window positions can be traced off it in plan.

import * as THREE from 'three';
import { wallFrames } from './build.js';

export function updatePlanPlate(stage, plan) {
  const g = stage.planGroup;
  while (g.children.length) {
    const c = g.children.pop();
    c.geometry?.dispose();
    c.material?.map?.dispose();
    c.material?.dispose();
  }
  if (!plan.src || !plan.show) return null;

  const tex = new THREE.TextureLoader().load(plan.src, () => stage.render());
  tex.colorSpace = THREE.SRGBColorSpace;

  // Aspect comes from the decoded image; until it loads, assume 4:3 and correct
  // on the load callback below.
  const img = new Image();
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: plan.opacity, depthWrite: false }),
  );
  mesh.name = 'planPlate';
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = -1;
  g.add(mesh);

  const place = (aspect) => {
    const w = plan.widthFt;
    const h = w / aspect;
    mesh.geometry.dispose();
    mesh.geometry = new THREE.PlaneGeometry(w, h);
    mesh.position.set(plan.offsetX, 0.01, plan.offsetZ);
    mesh.rotation.set(-Math.PI / 2, 0, THREE.MathUtils.degToRad(plan.rotation));
    mesh.userData.plate = { w, h };
  };

  img.onload = () => { place(img.width / img.height); stage.render(); };
  img.src = plan.src;
  place(4 / 3);

  return mesh;
}

/**
 * Given a world-space point picked on the plan plate, find the wall whose plane
 * is nearest and return {wall, offsetFt} — the input for a new opening.
 */
export function nearestWallHit(point, dim) {
  const frames = wallFrames(dim);
  let best = null;
  for (const [name, f] of Object.entries(frames)) {
    const rel = new THREE.Vector3(point.x - f.origin.x, 0, point.z - f.origin.z);
    const along = rel.dot(f.right);
    const perp = Math.abs(rel.dot(f.normal));
    // Penalize picks that fall outside the wall's own run.
    const outside = along < 0 ? -along : (along > f.span ? along - f.span : 0);
    const score = perp + outside * 1.6;
    if (!best || score < best.score) {
      best = { wall: name, offsetFt: THREE.MathUtils.clamp(along, 0, f.span), score };
    }
  }
  return best;
}
