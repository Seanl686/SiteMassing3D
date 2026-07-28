// Selection outline and drag handles for the anchor opening, plus faint
// outlines for the rest of a multi-selection.
//
// Each outline lives on its own wall plane in wall-local (u, v) coordinates and
// is rebuilt whenever the opening changes, so it always tracks the geometry.

import * as THREE from 'three';
import { wallFrames } from './build.js';

const PROUD = 0.35;      // ft the gizmo floats off the siding, so it never z-fights
const HANDLE = 0.55;     // ft, handle cube edge
const SNAP = 1 / 12;     // 1 inch

export const snap = (v, free) => (free ? v : Math.round(v / SNAP) * SNAP);

export class Gizmo {
  constructor(parentGroup) {
    this.group = new THREE.Group();
    this.group.name = 'gizmo';
    this.group.renderOrder = 900;
    if (parentGroup) parentGroup.add(this.group);
    this.handles = [];
    this.opening = null;

    this.outlineMat = new THREE.LineBasicMaterial({ color: 0x6fb2ff, depthTest: false, transparent: true });
    // Companions in a multi-selection read as dimmer outlines with no handles.
    this.ghostMat = new THREE.LineBasicMaterial({ color: 0xffd479, depthTest: false, transparent: true, opacity: 0.75 });
    this.handleMat = new THREE.MeshBasicMaterial({ color: 0x6fb2ff, depthTest: false, transparent: true });
    this.handleHotMat = new THREE.MeshBasicMaterial({ color: 0xffd479, depthTest: false, transparent: true });
  }

  clear() {
    while (this.group.children.length) {
      const c = this.group.children.pop();
      c.traverse?.((n) => n.geometry?.dispose());
      c.geometry?.dispose();
    }
    this.handles = [];
    this.opening = null;
  }

  /** Sub-group parked on `wall`'s plane, holding one outline rectangle. */
  _addOutline(o, dim, mat) {
    const f = wallFrames(dim)[o.wall];
    if (!f) return null;

    const g = new THREE.Group();
    const m = new THREE.Matrix4().makeBasis(
      f.right.clone(),
      new THREE.Vector3(0, 1, 0),
      f.normal.clone(),
    ).setPosition(f.origin.clone().addScaledVector(f.normal, PROUD));
    g.matrix.copy(m);
    g.matrixAutoUpdate = false;

    const x0 = o.offsetFt, x1 = o.offsetFt + o.widthFt;
    const y0 = o.sillFt, y1 = o.sillFt + o.heightFt;
    const pts = [
      new THREE.Vector3(x0, y0, 0), new THREE.Vector3(x1, y0, 0),
      new THREE.Vector3(x1, y1, 0), new THREE.Vector3(x0, y1, 0),
      new THREE.Vector3(x0, y0, 0),
    ];
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat);
    line.renderOrder = 900;
    g.add(line);
    this.group.add(g);
    g.updateMatrixWorld(true);
    return g;
  }

  /**
   * Rebuild the gizmo for anchor `o`, optionally outlining the `others` that
   * share the current multi-selection. Only the anchor gets drag handles.
   */
  show(o, dim, others = []) {
    this.clear();
    if (!o) return;
    this.opening = o;

    this.group.matrix.identity();
    this.group.matrixAutoUpdate = false;
    this.group.updateMatrixWorld(true);

    for (const other of others) {
      if (other && other.id !== o.id) this._addOutline(other, dim, this.ghostMat);
    }

    const g = this._addOutline(o, dim, this.outlineMat);
    if (!g) return;

    const x0 = o.offsetFt, x1 = o.offsetFt + o.widthFt;
    const y0 = o.sillFt, y1 = o.sillFt + o.heightFt;
    const add = (mode, x, y) => {
      const h = new THREE.Mesh(new THREE.BoxGeometry(HANDLE, HANDLE, HANDLE), this.handleMat);
      h.position.set(x, y, 0);
      h.renderOrder = 901;
      h.userData.handle = mode;
      g.add(h);
      this.handles.push(h);
    };
    add('left',   x0, (y0 + y1) / 2);
    add('right',  x1, (y0 + y1) / 2);
    add('top',    (x0 + x1) / 2, y1);
    add('bottom', (x0 + x1) / 2, y0);
    g.updateMatrixWorld(true);
  }

  /** Handle mesh under the pointer, if any. */
  pick(raycaster) {
    if (!this.handles.length) return null;
    const hit = raycaster.intersectObjects(this.handles, false)[0];
    return hit ? hit.object.userData.handle : null;
  }

  highlight(mode) {
    for (const h of this.handles) {
      h.material = h.userData.handle === mode ? this.handleHotMat : this.handleMat;
    }
  }

  setVisible(v) { this.group.visible = v; }
}

/**
 * Intersect a ray with the plane of a wall and return the hit in wall-local
 * (u, v) feet. Returns null when the ray runs parallel to the wall.
 */
export function wallPlaneHit(raycaster, wall, dim, homeGroup) {
  const f = wallFrames(dim)[wall];
  if (!f) return null;

  const localRay = raycaster.ray.clone();
  if (homeGroup) {
    homeGroup.updateMatrixWorld(true);
    const invMat = homeGroup.matrixWorld.clone().invert();
    localRay.applyMatrix4(invMat);
  }

  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(f.normal, f.origin);
  const p = new THREE.Vector3();
  if (!localRay.intersectPlane(plane, p)) return null;
  const rel = p.clone().sub(f.origin);
  return { u: rel.dot(f.right), v: rel.y, span: f.span };
}

/**
 * Apply a drag. `start` is the opening's geometry when the drag began, `d` the
 * (du, dv) travel in feet. Doors stay pinned to the floor; windows float.
 */
export function applyDrag(o, mode, start, d, dim, free) {
  const isDoor = o.type !== 'window';
  const minW = 1.0, minH = 1.0;

  if (mode === 'move') {
    o.offsetFt = snap(start.offsetFt + d.du, free);
    if (!isDoor) o.sillFt = snap(Math.max(0, start.sillFt + d.dv), free);
  } else if (mode === 'right') {
    o.widthFt = Math.max(minW, snap(start.widthFt + d.du, free));
  } else if (mode === 'left') {
    const right = start.offsetFt + start.widthFt;
    o.offsetFt = Math.min(snap(start.offsetFt + d.du, free), right - minW);
    o.widthFt = right - o.offsetFt;
  } else if (mode === 'top') {
    o.heightFt = Math.max(minH, snap(start.heightFt + d.dv, free));
  } else if (mode === 'bottom') {
    if (isDoor) {
      // A door's head height is the meaningful dimension; keep the sill at the floor.
      o.heightFt = Math.max(minH, snap(start.heightFt - d.dv, free));
    } else {
      const head = start.sillFt + start.heightFt;
      o.sillFt = Math.max(0, Math.min(snap(start.sillFt + d.dv, free), head - minH));
      o.heightFt = head - o.sillFt;
    }
  }
  if (isDoor) o.sillFt = 0;
  return o;
}
