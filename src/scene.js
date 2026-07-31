// Renderer, lights, cameras and the view presets.

import * as THREE from 'three';
import { OrbitControls } from '../vendor/OrbitControls.js';
import { derived } from './build.js';
import { footprintExtents } from './bumps.js';

// 35mm-equivalent focal length -> vertical FOV, assuming a 36x24mm frame.
export const focalToFov = (mm) => 2 * Math.atan(24 / (2 * mm)) * 180 / Math.PI;

/**
 * The eight corners of the home's overall bounding box, overhangs included —
 * and any porch or bump-out that projects past the rectangle, or a 6' front
 * porch frames straight out of the picture.
 */
function boxCorners(dim, d, bumps = []) {
  const e = footprintExtents(dim, bumps);
  const out = [];
  for (const x of [e.minX, e.maxX]) {
    for (const y of [0, d.ridgeY]) {
      for (const z of [e.minZ, e.maxZ]) out.push(new THREE.Vector3(x, y, z));
    }
  }
  return out;
}

export class Stage {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene = new THREE.Scene();

    this.persp = new THREE.PerspectiveCamera(50, 1, 0.5, 4000);
    this.ortho = new THREE.OrthographicCamera(-50, 50, 30, -30, -2000, 4000);
    this.camera = this.persp;

    this.controls = new OrbitControls(this.persp, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.09;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.005; // never go below grade

    this.orthoControls = new OrbitControls(this.ortho, canvas);
    this.orthoControls.enableDamping = true;
    this.orthoControls.enabled = false;

    // Once the user drags the camera themselves, presets stop re-fitting the
    // frame on export — their framing is the intent, not the preset's.
    this.userMoved = false;
    const touched = () => { this.userMoved = true; };
    this.controls.addEventListener('start', touched);
    this.orthoControls.addEventListener('start', touched);

    this.buildEnvironment();
  }

  buildEnvironment() {
    this.hemi = new THREE.HemisphereLight(0xcfd8e3, 0x6a6357, 1.0);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xfff4e6, 1.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    this.sun.shadow.bias = -0.0004;
    // World units are feet, so the normal bias has to be generous or the eave
    // and gable-end grazing angles show shadow acne.
    this.sun.shadow.normalBias = 0.3;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.fill = new THREE.DirectionalLight(0xdfe7f2, 0.35);
    this.fill.position.set(-40, 30, -60);
    this.scene.add(this.fill);

    // True-colour mode's only light.
    //
    // The intensity is pi, not 1: an ambient light contributes its colour times
    // its intensity as irradiance, and the Lambert BRDF then divides by pi, so
    // an intensity of 1 renders every albedo at 1/pi — a uniform 40% too dark,
    // which is exactly the kind of near-miss that looks like a colour bug.
    // Multiplying it back out makes a surface read as precisely its own hex.
    this.trueColorLight = new THREE.AmbientLight(0xffffff, Math.PI);
    this.trueColorLight.visible = false;
    this.scene.add(this.trueColorLight);

    const groundMat = new THREE.ShadowMaterial({ opacity: 0.26 });
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), groundMat);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

    this._groundBaselineY = 0;
    this.rebuildGround(150);

    this.planGroup = new THREE.Group();
    this.scene.add(this.planGroup);

    // The 360 panorama lives here: an inverted sphere centred on the site, not
    // a scene background. A background sits at infinity and never moves against
    // the model, so the home would slide across it as the camera orbits. A
    // sphere of a stated radius is centred on the pad the photo was shot from,
    // which is what makes orbiting the home read as walking around the lot.
    this.panoGroup = new THREE.Group();
    this.scene.add(this.panoGroup);

    // Set by rebuild(): what projects past the rectangle, for framing.
    this.bumps = [];
    this.homeGroup = new THREE.Group();
    this.scene.add(this.homeGroup);
  }

  /**
   * Ground plane, grid and boundary ring, all sized to how far the lot should
   * read before stopping — an unbounded grid reads as scenery, not a measured
   * site. The grid's geometry is baked in at construction, so a size change
   * rebuilds it rather than resizing it; the boundary ring is a bright outline
   * at the edge so the cutoff itself is visible, not just present.
   */
  rebuildGround(extentFt) {
    this.groundExtentFt = extentFt;
    this.ground.geometry.dispose();
    this.ground.geometry = new THREE.PlaneGeometry(extentFt, extentFt);

    this.grid?.geometry.dispose();
    if (this.grid) this.scene.remove(this.grid);
    const divisions = Math.max(4, Math.round(extentFt / 5));
    this.grid = new THREE.GridHelper(extentFt, divisions, 0x4a525d, 0x30363e);
    this.grid.position.y = -0.005 + (this._groundBaselineY || 0);
    this.scene.add(this.grid);

    this._groundEdge?.geometry.dispose();
    this._groundEdge?.material.dispose();
    if (this._groundEdge) this.scene.remove(this._groundEdge);
    const half = extentFt / 2;
    const pts = [
      new THREE.Vector3(-half, 0, -half), new THREE.Vector3(half, 0, -half),
      new THREE.Vector3(half, 0, half), new THREE.Vector3(-half, 0, half),
    ];
    this._groundEdge = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: 0xffb400 }),
    );
    this._groundEdge.position.y = (this._groundBaselineY || 0) + 0.002;
    this.scene.add(this._groundEdge);
  }

  applySceneOpts(o, dim) {
    const az = THREE.MathUtils.degToRad(o.sunAz);
    const el = THREE.MathUtils.degToRad(o.sunEl);
    const r = Math.max(dim.lengthFt, dim.widthFt) * 2.2 + 40;
    this.sun.position.set(
      Math.cos(el) * Math.sin(az) * r,
      Math.sin(el) * r,
      Math.cos(el) * Math.cos(az) * r,
    );
    this.sun.target.position.set(0, dim.floorHeightFt, 0);

    // Overcast mix: trade the hard sun for ambient sky.
    this.sun.intensity = THREE.MathUtils.lerp(2.6, 0.55, o.flat);
    this.hemi.intensity = THREE.MathUtils.lerp(0.55, 1.85, o.flat);
    this.fill.intensity = THREE.MathUtils.lerp(0.2, 0.5, o.flat);
    this.ground.material.opacity = THREE.MathUtils.lerp(0.34, 0.08, o.flat);
    this.sun.castShadow = o.shadow;

    // Keep the shadow frustum tight to the home; a frustum sized to the light's
    // distance wastes texels and shows acne along the eave.
    const s = this.sun.shadow.camera;
    const half = Math.max(dim.lengthFt, dim.widthFt) * 0.8 + 8;
    s.left = -half; s.right = half; s.top = half; s.bottom = -half;
    s.near = 1; s.far = r * 3;
    s.updateProjectionMatrix();

    const extentFt = Math.max(20, +o.groundExtentFt || 150);
    if (extentFt !== this.groundExtentFt) this.rebuildGround(extentFt);

    const blockLandscape = !!o.blockLandscape;
    this.ground.visible = o.grid && !blockLandscape;
    this.grid.visible = o.grid && !blockLandscape;
    this._groundEdge.visible = o.grid && !blockLandscape;
    // `plateBackdrop` is set while the lot photo is showing behind the canvas.
    // Painting a background then hides the photo, and this runs on EVERY scene
    // change — wireframe, grid, sun, background colour — so without the guard a
    // toggle that has nothing to do with the backdrop wipes the loaded photo.
    this.refreshBackground(o);
    this.persp.fov = focalToFov(o.focal);
    this.persp.updateProjectionMatrix();
    this.setTrueColor(o.trueColor);
    this.setWireframe(o.wireframe);
  }

  /**
   * Scene background and the canvas clear alpha, which have to move together.
   *
   * A null background means something behind the canvas is meant to show
   * through — the lot photo plate — and that only works while the buffer is
   * cleared transparent. An export leaves the clear alpha at 1, so setting the
   * background alone used to hand back an opaque black canvas the next time a
   * photo was loaded.
   */
  /**
   * The one place that decides what the canvas is cleared to. Two things need a
   * transparent buffer instead of the background colour, and both used to be
   * settled ad hoc in different files, which is how a scene toggle ended up
   * wiping a loaded backdrop:
   *
   *  - the lot photo, a plate BEHIND the canvas, which only shows through a
   *    transparent one (`plateBackdrop`, set by whoever owns the plate);
   *  - a panorama under wireframe, composited destination-over into whatever
   *    the drawing has not claimed — an opaque clear claims everything.
   */
  refreshBackground(o) {
    if (this.plateBackdrop) return this.setBackground(null);
    const panoUnderWireframe = !!o?.wireframe && !!this.panoMesh?.visible;
    const bare = o?.bgVisible === false || panoUnderWireframe;
    return this.setBackground(bare ? null : new THREE.Color(o?.bg ?? 0x20242a));
  }

  setBackground(color) {
    this.scene.background = color || null;
    this.renderer.setClearAlpha(color ? 1 : 0);
    // Wireframe strokes are picked for contrast against the backdrop, and the
    // backdrop can change under a live wireframe (a lot photo loads, the colour
    // is edited). Re-tint rather than rebuild — the geometry has not moved.
    if (this._wfEdge) this._wfEdge.color.setHex(this.wireframeStroke());
  }

  /** Stroke colour for hidden-line mode. Picked for maximum separation from
   *  any photographic or rendered backdrop — a saturated hue nowhere near the
   *  grays/browns/blues a house or lot photo actually contains — so the edges
   *  read as unambiguous line data rather than blending into the picture,
   *  whether a human or a vision model is reading the silhouette. Dark on
   *  light backdrops, light on dark; no background means a photo is behind
   *  the canvas, and photos read light. */
  wireframeStroke() {
    const bg = this.scene.background instanceof THREE.Color ? this.scene.background : null;
    const lum = bg ? 0.2126 * bg.r + 0.7152 * bg.g + 0.0722 * bg.b : 1;
    return lum > 0.5 ? 0xff0090 : 0x00e5ff; // vivid magenta on light, vivid cyan on dark
  }

  /**
   * Flat, unlit, un-tone-mapped shading: every surface renders as exactly the
   * hex it was given.
   *
   * The normal render is photographic — ACES tone mapping, a warm sun, a cool
   * sky — and under it a wall picked off a photograph does NOT come back as the
   * colour that was picked. That is correct for a render and useless for
   * checking a match, so this is the mode you flip into to confirm the finishes
   * are one for one with the photo, and flip out of to see how they will look.
   *
   * Metalness has to go too: it moves energy out of the diffuse lobe, and a
   * default 0.05 is a visible 5% darkening on a value that is meant to be exact.
   */
  setTrueColor(enabled) {
    const on = !!enabled;
    this.trueColor = on;
    this.renderer.toneMapping = on ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
    this.trueColorLight.visible = on;
    this.hemi.visible = !on;
    this.sun.visible = !on;
    this.fill.visible = !on;
    if (!this.homeGroup) return;
    this.homeGroup.traverse((o) => {
      if (!o.isMesh) return;
      // While wireframe is on the mesh wears the depth mask and the real
      // material is parked in userData; edit that one or the change is lost the
      // moment wireframe is switched off.
      const live = o.userData.solidMaterial || o.material;
      for (const m of (Array.isArray(live) ? live : [live])) {
        if (!m || m.metalness === undefined) continue;
        if (on) {
          if (m.userData.litMetalness === undefined) m.userData.litMetalness = m.metalness;
          m.metalness = 0;
        } else if (m.userData.litMetalness !== undefined) {
          m.metalness = m.userData.litMetalness;
          delete m.userData.litMetalness;
        }
      }
    });
  }

  /**
   * Hidden-line wireframe. Rather than `material.wireframe` — which draws every
   * triangle edge, including the ones on the far side of the home — the solid
   * geometry stays in place as a depth-only mask and only the silhouette/crease
   * edges are stroked on top. Edges behind the home are occluded by the mask, so
   * the view reads like a line drawing instead of an x-ray, and whatever backdrop
   * is loaded still shows through the silhouette.
   */
  setWireframe(enabled) {
    if (!this.homeGroup) return;

    // Always tear the previous overlay down first: rebuild() hands us fresh
    // geometry, and toggling off has to restore the real materials.
    const stale = [];
    this.homeGroup.traverse((o) => {
      if (o.userData.hiddenLineEdge) { stale.push(o); return; }
      if (!o.isMesh) return;
      if (o.userData.solidMaterial) {
        o.material = o.userData.solidMaterial;
        o.userData.solidMaterial = null;
      }
      for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
        if (m) m.wireframe = false;
      }
    });
    for (const e of stale) {
      e.parent?.remove(e);
      e.geometry?.dispose();
    }
    if (!enabled) {
      this._wfMask?.dispose();
      this._wfEdge?.dispose();
      this._wfMask = this._wfEdge = null;
      this.syncPanoBlending();
      return;
    }

    // The mask ERASES: NoBlending with a zero alpha writes straight over the
    // framebuffer and clears the home's silhouette to transparent.
    //
    // Painting it in the background colour instead — the obvious version — works
    // only when there IS a background. Over a lot photo, which is a plate behind
    // the canvas, it covered the photo with a flat slab, and a backdrop the user
    // loaded is the one thing wireframe must not throw away. Writing no colour at
    // all is no good either: the grid and the ground are drawn before the mask,
    // so they showed through the home like an x-ray. Erasing does both jobs —
    // scene geometry behind the home is wiped, and whatever sits behind the
    // canvas (photo plate, background colour, export composite) shows through.
    this._wfMask?.dispose();
    this._wfEdge?.dispose();
    this._wfMask = new THREE.MeshBasicMaterial({
      color: 0x000000,
      opacity: 0,
      transparent: false,         // stay in the opaque pass, before the lines
      blending: THREE.NoBlending, // overwrite the pixel rather than mix with it
      polygonOffset: true,        // push the mask back so edges are not z-fought
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    this._wfEdge = new THREE.LineBasicMaterial({ color: this.wireframeStroke() });

    const meshes = [];
    this.homeGroup.traverse((o) => {
      if (!o.isMesh) return;
      // Leave the resize gizmo alone — it is UI, not part of the model.
      for (let p = o; p; p = p.parent) if (p === this.overlay) return;
      meshes.push(o);
    });
    for (const m of meshes) {
      m.userData.solidMaterial = m.material;
      m.material = this._wfMask;
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, 25), this._wfEdge);
      edges.userData.hiddenLineEdge = true;
      // Every mask has to have erased its pixels before any line is stroked, or
      // a line drawn early is wiped by a mask drawn late. Made explicit rather
      // than left to the render sort.
      edges.renderOrder = 10;
      m.add(edges);
    }
    this.syncPanoBlending();
  }

  /**
   * Wrap an equirectangular panorama around the site.
   *
   * `onReady` fires once the image has decoded, because the texture arrives a
   * frame or more after the call and the caller usually wants to re-render or
   * re-measure then. Returns true while a panorama is showing.
   */
  setPanorama(pano, groundY = 0, onReady) {
    const src = pano?.src;
    const on = !!src && pano.show !== false;

    if (!on) {
      if (this.panoMesh) this.panoMesh.visible = false;
      return false;
    }

    if (!this.panoMesh) {
      // scale(-1,1,1) turns the sphere inside out AND un-mirrors the mapping —
      // BackSide alone renders the interior but shows the photo flipped.
      const geo = new THREE.SphereGeometry(1, 64, 40);
      geo.scale(-1, 1, 1);
      const mat = new THREE.MeshBasicMaterial({
        // A photograph is already a finished exposure; tone-mapping it again
        // crushes the sky the model is supposed to match.
        toneMapped: false,
        transparent: true,
        depthWrite: false,
      });
      this.panoMesh = new THREE.Mesh(geo, mat);
      this.panoMesh.renderOrder = -1;   // paint before the home, never over it
      this.panoGroup.add(this.panoMesh);
    }

    if (this._panoSrc !== src) {
      this._panoSrc = src;
      this.panoMesh.material.map?.dispose();
      this.panoMesh.material.map = null;
      new THREE.TextureLoader().load(src, (tex) => {
        // A later load may have overtaken this one.
        if (this._panoSrc !== src) { tex.dispose(); return; }
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.mapping = THREE.EquirectangularReflectionMapping;
        tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
        this.panoMesh.material.map = tex;
        this.panoMesh.material.needsUpdate = true;
        onReady?.();
      });
    }

    const radius = Math.max(20, +pano.radiusFt || 300);
    this.panoMesh.visible = true;
    this.panoMesh.scale.setScalar(radius);
    // Centred on the site, lifted by the ground baseline plus the height the
    // camera was at when the panorama was shot.
    this.panoMesh.position.set(0, groundY + (+pano.heightFt || 0), 0);
    this.panoMesh.rotation.set(
      THREE.MathUtils.degToRad(+pano.tiltDeg || 0),
      THREE.MathUtils.degToRad(+pano.yawDeg || 0),
      0,
    );
    this.panoMesh.material.opacity = pano.opacity ?? 1;
    this.panoMesh.material.color.setScalar(pano.brightness ?? 1);
    this.syncPanoBlending();
    return true;
  }

  /**
   * How the panorama is composited, which depends on the wireframe.
   *
   * Normally it is a backdrop: drawn first, everything else paints over it.
   *
   * Under wireframe the home's silhouette is ERASED to transparent, and the
   * panorama — unlike the lot photo, which is a plate behind the canvas — lives
   * inside the same buffer, so it would be erased along with everything else.
   * It is therefore drawn LAST instead, with the depth test off and a
   * destination-over blend, which fills only the pixels nothing has claimed:
   * the cleared silhouette. The line drawing survives on top of it.
   */
  syncPanoBlending() {
    const mesh = this.panoMesh;
    if (!mesh) return;
    const m = mesh.material;
    const wireframe = !!this._wfMask;
    if (wireframe) {
      m.transparent = true;
      m.depthTest = false;
      m.blending = THREE.CustomBlending;
      m.blendEquation = THREE.AddEquation;
      m.blendSrc = THREE.OneMinusDstAlphaFactor;
      m.blendDst = THREE.OneFactor;
      mesh.renderOrder = 20;              // after the mask and after the lines
    } else {
      // An opaque panorama belongs in the opaque pass, where renderOrder -1 puts
      // it before the model. Only a faded one needs the transparent pass.
      m.transparent = (m.opacity ?? 1) < 1;
      m.depthTest = true;
      m.blending = THREE.NormalBlending;
      mesh.renderOrder = -1;
    }
    m.needsUpdate = true;
  }

  /** Hide the panorama for one render — cutouts and geometry plates. */
  setPanoramaVisible(on) {
    if (!this.panoMesh) return undefined;
    const was = this.panoMesh.visible;
    this.panoMesh.visible = !!on && !!this._panoSrc;
    return was;
  }

  resize(w, h) {
    if (w <= 0 || h <= 0) return;
    this.renderer.setSize(w, h, false);
    this.persp.aspect = w / h;
    this.persp.updateProjectionMatrix();
    this._aspect = w / h;
    this.reframeOrtho();
    if (this.controls) this.controls.update();
    if (this.orthoControls) this.orthoControls.update();
  }

  /**
   * Re-derive the ortho frustum for the current aspect.
   *
   * `refit: true` (applying a view preset) sizes the frustum from the stored fit
   * box so the whole subject lands in frame at that moment. Every later call —
   * a window resize, a sidebar toggle, an export at another aspect — keeps that
   * half-height and only widens or narrows the frustum. That matches the
   * perspective camera, which holds its vertical fov, so BOTH cameras keep the
   * model at a fixed fraction of the viewport height and a width change only
   * reveals more scene at the sides. Rescaling on width here is what used to
   * make the model drift against the site photo when the window was resized.
   */
  reframeOrtho({ refit = false } = {}) {
    const fit = this._orthoFit;
    if (!fit) return;
    const a = this._aspect || 1;
    if (refit || !this._orthoHalfH) {
      this._orthoHalfH = Math.max(fit.h / 2, (fit.w / 2) / a) * fit.pad;
    }
    const hh = this._orthoHalfH;
    this.ortho.top = hh; this.ortho.bottom = -hh;
    this.ortho.left = -hh * a; this.ortho.right = hh * a;
    this.ortho.updateProjectionMatrix();
  }

  /**
   * Everything needed to put the camera back exactly where it is now: which
   * camera is live, its transform, the orbit target, and the orthographic
   * frustum's established half-height. Saved with a project so reopening it
   * shows the framing it was saved at rather than a default preset.
   */
  cameraState() {
    const isOrtho = this.camera === this.ortho;
    const controls = isOrtho ? this.orthoControls : this.controls;
    const p = this.camera.position, q = this.camera.quaternion, t = controls.target;
    return {
      type: isOrtho ? 'ortho' : 'persp',
      position: [p.x, p.y, p.z],
      quaternion: [q.x, q.y, q.z, q.w],
      target: [t.x, t.y, t.z],
      zoom: this.camera.zoom,
      fov: this.persp.fov,
      orthoFit: this._orthoFit ? { ...this._orthoFit } : null,
      orthoHalfH: this._orthoHalfH ?? null,
      preset: this._lastView || null,
      userMoved: !!this.userMoved,
    };
  }

  /** Restore a state produced by cameraState(). Returns false if it is unusable. */
  applyCameraState(cs) {
    if (!cs || !Array.isArray(cs.position) || !Array.isArray(cs.target)) return false;
    const isOrtho = cs.type === 'ortho';
    this.useOrtho(isOrtho);
    const cam = isOrtho ? this.ortho : this.persp;
    const controls = isOrtho ? this.orthoControls : this.controls;

    if (!isOrtho && Number.isFinite(cs.fov)) {
      this.persp.fov = cs.fov;
    }
    if (isOrtho) {
      // Restore the frustum before the transform so the first render is framed
      // correctly rather than snapping a frame later.
      this._orthoFit = cs.orthoFit || this._orthoFit;
      this._orthoHalfH = Number.isFinite(cs.orthoHalfH) ? cs.orthoHalfH : this._orthoHalfH;
      this.reframeOrtho();
    }

    cam.position.set(cs.position[0], cs.position[1], cs.position[2]);
    controls.target.set(cs.target[0], cs.target[1], cs.target[2]);
    if (Array.isArray(cs.quaternion)) {
      cam.quaternion.set(cs.quaternion[0], cs.quaternion[1], cs.quaternion[2], cs.quaternion[3]);
    }
    if (Number.isFinite(cs.zoom)) cam.zoom = cs.zoom;
    cam.updateProjectionMatrix();
    controls.update();

    this._lastView = cs.preset || this._lastView;
    // A restored framing is the user's own, so presets must not re-fit over it.
    this.userMoved = cs.userMoved !== false;
    return true;
  }

  useOrtho(on) {
    this.camera = on ? this.ortho : this.persp;
    this.controls.enabled = !on;
    this.orthoControls.enabled = on;
  }

  /**
   * Move the camera to a named preset. Elevation presets use the orthographic
   * camera so walls measure true to scale; the 3/4 and eye-level presets use the
   * perspective camera so they read like a photograph.
   */
  /** Re-apply the last preset — used when the render aspect differs from the viewport. */
  refit() {
    if (this._lastView && !this.userMoved) {
      this.setView(this._lastView, this._lastDim, this._lastOpts);
    }
  }

  setView(name, dim, opts) {
    this._lastDim = dim;
    this._lastOpts = opts;
    this.userMoved = false;
    const d = derived(dim);
    const { widthFt: W, lengthFt: L } = dim;
    const target = new THREE.Vector3(0, d.ridgeY * 0.45, 0);
    const pad = 1.18;

    const ortho = (dir, fitW, fitH) => {
      this.useOrtho(true);
      this._orthoFit = { w: fitW, h: fitH, pad };
      this._orthoHalfH = null;
      this.reframeOrtho({ refit: true });
      const dist = Math.max(L, W) * 3 + 100;
      this.ortho.position.copy(target).addScaledVector(dir, dist);
      this.orthoControls.target.copy(target);
      this.ortho.up.set(0, 1, 0);
      this.ortho.lookAt(target);
      this.orthoControls.update();
    };

    const corners = boxCorners(dim, d, this.bumps);

    /**
     * Pull the camera back along `dir` until every corner of the home's bounding
     * box lands inside the frame. A bounding-sphere fit is far too loose for a
     * 56' x 27' box, so this iterates on the actual projected extent instead.
     */
    const fitDistance = (dir, look, margin) => {
      const cam = this.persp;
      let dist = Math.max(L, W) * 1.5;
      const v = new THREE.Vector3();
      for (let i = 0; i < 5; i++) {
        cam.position.copy(look).addScaledVector(dir, dist);
        cam.lookAt(look);
        cam.updateMatrixWorld(true);
        let extent = 0;
        for (const c of corners) {
          v.copy(c).project(cam);
          extent = Math.max(extent, Math.abs(v.x), Math.abs(v.y));
        }
        if (!isFinite(extent) || extent <= 0) break;
        dist *= extent * margin;
      }
      return dist;
    };

    const persp = (az, elDeg, margin, look) => {
      this.useOrtho(false);
      const a = THREE.MathUtils.degToRad(az);
      const e = THREE.MathUtils.degToRad(elDeg);
      const dir = new THREE.Vector3(
        Math.cos(e) * Math.sin(a),
        Math.sin(e),
        Math.cos(e) * Math.cos(a),
      );
      const t = look || target;
      const radius = fitDistance(dir, t, margin);
      this.persp.position.copy(t).addScaledVector(dir, radius);
      this.controls.target.copy(t);
      this.persp.lookAt(t);
      this.controls.update();
      return radius;
    };

    switch (name) {
      case 'front': ortho(new THREE.Vector3(0, 0, -1), L, d.ridgeY); break;
      case 'rear':  ortho(new THREE.Vector3(0, 0,  1), L, d.ridgeY); break;
      case 'left':  ortho(new THREE.Vector3(-1, 0, 0), W, d.ridgeY); break;
      case 'right': ortho(new THREE.Vector3( 1, 0, 0), W, d.ridgeY); break;
      case 'plan':
      case 'foundation':
        this.useOrtho(true);
        this._orthoFit = { w: L, h: W, pad: 1.15 };
        this._orthoHalfH = null;
        this.reframeOrtho({ refit: true });
        this.ortho.up.set(0, 0, -1);
        this.ortho.position.set(0, 500, 0);
        this.orthoControls.target.set(0, 0, 0);
        this.ortho.lookAt(0, 0, 0);
        this.orthoControls.update();
        break;
      case 'section':
        this.useOrtho(true);
        this._orthoFit = { w: W, h: d.ridgeY || 20, pad: 1.25 };
        this._orthoHalfH = null;
        this.reframeOrtho({ refit: true });
        this.ortho.up.set(0, 1, 0);
        this.ortho.position.set(L * 2, d.ridgeY * 0.5, 0);
        this.orthoControls.target.set(0, d.ridgeY * 0.5, 0);
        this.ortho.lookAt(0, d.ridgeY * 0.5, 0);
        this.orthoControls.update();
        break;
      // Azimuth 0 puts the camera on +Z (the rear). The front wall faces -Z, so
      // front-facing three-quarters sit near 180 degrees.
      case 'hero-left':  persp(-142, 10, 1.06); break;
      case 'hero-right': persp( 142, 10, 1.06); break;
      case 'rear-left':  persp( -38, 10, 1.06); break;
      case 'eye': {
        // Stand a person in front of the home: camera pinned to eye height,
        // distance solved so the whole home still fits the frame.
        const t = new THREE.Vector3(0, dim.floorHeightFt + dim.wallHeightFt * 0.45, 0);
        const el = Math.atan2(opts.eye - t.y, Math.max(L, W));
        persp(-148, THREE.MathUtils.radToDeg(el), 1.06, t);
        this.persp.position.y = opts.eye;
        this.persp.lookAt(t);
        this.controls.update();
        break;
      }
      default: persp(-142, 10, 1.06);
    }
    this._lastView = name;
  }

  setCameraDistance(distFt) {
    if (!isFinite(distFt) || distFt <= 0) return;
    this.userMoved = true;
    const target = this.controls.target;
    const dir = this.persp.position.clone().sub(target);
    if (dir.lengthSq() < 1e-4) dir.set(0, 5, 20);
    dir.normalize();
    this.persp.position.copy(target).addScaledVector(dir, distFt);
    this.controls.update();
  }

  getCameraDistance() {
    return this.persp.position.distanceTo(this.controls.target);
  }

  setGroundBaseline(offsetY) {
    const y = offsetY || 0;
    this._groundBaselineY = y;
    this.ground.position.y = y;
    this.grid.position.y = -0.005 + y;
    this._groundEdge.position.y = y + 0.002;
    this.planGroup.position.y = y;
  }

  rotateView(deg) {
    this.userMoved = true;
    const cam = this.camera === this.ortho ? this.ortho : this.persp;
    const controls = this.camera === this.ortho ? this.orthoControls : this.controls;
    const target = controls.target;
    const rad = THREE.MathUtils.degToRad(deg);

    const offset = cam.position.clone().sub(target);
    offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), rad);
    cam.position.copy(target).add(offset);
    cam.lookAt(target);
    controls.update();
  }

  render() {
    (this.camera === this.ortho ? this.orthoControls : this.controls).update();
    this.renderer.render(this.scene, this.camera);
  }
}
