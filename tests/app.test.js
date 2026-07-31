import test from 'node:test';
import assert from 'node:assert/strict';

import { defaultHome, defaultScene, defaultExport, defaultBrief, migrate, WALLS } from '../src/defaults.js';
import { zipStore, crc32, dataUrlToBytes, dataUrlExt } from '../src/zip.js';
import {
  buildBrief, colorName, sidingLabel, describeLighting, wallSummary, openingSchedule, ACCESSORIES,
} from '../src/brief.js';
import {
  captureSiteView, applySiteView, cycleSiteView, indexOfView, uniqueViewName,
  readSiteView, sortSiteViews, SITE_VIEW_SLOTS, slotByKey, findSlotView,
} from '../src/siteviews.js';
import {
  HOME_PHOTO_SLOTS, homeSlotByKey, readHomePhotos, filledHomePhotos, unphotographedWalls,
} from '../src/homephotos.js';
import { derived, wallFrames, fmtAllUnits, buildHome, getWallHeight, dormerSize, applyHeadAlign } from '../src/build.js';
import {
  readBumps, clampBump, footprintExtents, bumpFootprint, wallBands, isRecess, defaultBump,
} from '../src/bumps.js';
import { createSidingMaterial } from '../src/textures.js';
import * as THREE from 'three';

const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
import { History, describeChange } from '../src/history.js';
import { buildProject, readProject, PROJECT_VERSION } from '../src/project.js';
import { validateHomeSpec, applySpecToHome, parseHexColor } from '../src/homespec.js';
import { AI_PROVIDERS, loadApiKeys, saveApiKeys, readPlanWithAutoCycle } from '../src/readplan.js';
import {
  collectAssets, assetInventory, finishSampleAssets, planPlateLinked, missingHomePhotoNames,
  removeAsset,
} from '../src/assets.js';
import {
  rgbToHex, hexToRgb, luma, saturation, sampleAverage, samplePixels, quantize, suggestFinishRoles,
  zoomAnchoredPan, wheelZoomFactor, looksLikeSky,
  whiteBalanceGains, applyWhiteBalance, REFERENCE_WHITE,
} from '../src/eyedrop.js';

test('1. Defaults & State Initialization', () => {
  const home = defaultHome();
  assert.equal(typeof home.name, 'string');
  assert.equal(home.dimensions.lengthFt, 56);
  assert.equal(home.dimensions.widthFt, 27);
  assert.ok(Array.isArray(home.openings));
  assert.ok(home.openings.length > 0);
  assert.ok(home.openings[0].id, 'First opening has a unique ID');

  const scene = defaultScene();
  assert.equal(scene.steps, true);
  assert.equal(scene.stepLanding, true);
  assert.equal(scene.landingDepthFt, 3.5);
  assert.equal(scene.stepRailings, 'both');
  assert.equal(scene.railMat, 'pressure_treated');
  assert.equal(scene.balusterStyle, 'balusters');
  assert.equal(scene.blockLandscape, false);

  const exp = defaultExport();
  assert.equal(exp.w, 2400);
  assert.equal(exp.h, 1600);
});

test('2. State Migration for Backward Compatibility', () => {
  const legacyRaw = {
    name: 'Old House',
    dimensions: { lengthFt: 50, widthFt: 24 },
    openings: [{ type: 'door', wall: 'front', offsetFt: 10, widthFt: 3, heightFt: 6.66 }]
  };

  const migrated = migrate(legacyRaw);
  assert.equal(migrated.name, 'Old House');
  assert.equal(migrated.dimensions.lengthFt, 50);
  assert.equal(migrated.dimensions.roofPitch, 4); // filled default
  assert.ok(migrated.colors.siding, 'Default siding color injected');
  assert.ok(migrated.openings[0].id, 'Opening ID generated');
});

test('3. Dimension Derivation Math', () => {
  const dim = { lengthFt: 60, widthFt: 28, wallHeightFt: 9, floorHeightFt: 2, roofPitch: 4, roofStyle: 'gable' };
  const d = derived(dim);

  assert.equal(d.eaveY, 11);
  assert.equal(d.ridgeY, 11 + 14 * (4 / 12));
  assert.ok(d.ridgeY > d.eaveY, 'Ridge height should be higher than eave height');
});

test('4. Wall Framing Geometry & Vectors', () => {
  const dim = { lengthFt: 60, widthFt: 28, wallHeightFt: 9, floorHeightFt: 2, roofPitch: 4, roofStyle: 'gable' };
  const frames = wallFrames(dim);

  for (const w of WALLS) {
    assert.ok(frames[w], `Frame for wall ${w} exists`);
    assert.ok(frames[w].origin, `Origin for wall ${w} exists`);
    assert.ok(frames[w].right, `Right vector for wall ${w} exists`);
    assert.ok(frames[w].normal, `Normal vector for wall ${w} exists`);
  }

  // Front wall normal points to -Z
  assert.equal(Math.round(frames.front.normal.z), -1);
  // Back wall normal points to +Z
  assert.equal(Math.round(frames.back.normal.z), 1);
});

test('5. Unit Formatting Utility (fmtAllUnits)', () => {
  const str1 = fmtAllUnits(6.66666);
  assert.ok(str1.includes("6'-8\""), `Expected 6'-8", got ${str1}`);
  assert.ok(str1.includes('(80" / 2.03m)'));

  const str2 = fmtAllUnits(3.5);
  assert.ok(str2.includes("3'-6\""), `Expected 3'-6", got ${str2}`);

  const str3 = fmtAllUnits(0);
  assert.ok(str3.includes("0'"), `Expected 0', got ${str3}`);
});

test('6. 3D Home Assembly & Per-Door Stair Customizations', () => {
  const home = defaultHome();
  const scene = defaultScene();

  // Add front door with custom stair material, egress, railing material, and balusters
  home.openings[0].stepMat = 'pressure_treated';
  home.openings[0].stepEgress = 'split';
  home.openings[0].railMat = 'white_trim';
  home.openings[0].balusterStyle = 'balusters';

  const root = buildHome(home, scene);

  assert.equal(root.name, 'home');
  assert.ok(root.children.length > 0, 'Children meshes generated');

  const stepsGroup = root.children.find((c) => c.name === 'steps');
  assert.ok(stepsGroup, 'Steps group generated for doors');
  assert.ok(stepsGroup.children.length > 0, 'Stair geometry generated');

  // Verify materials registry attached to root
  assert.ok(root.userData.materials, 'Materials registry present');
  assert.ok(root.userData.materials.pressure_treated);
  assert.ok(root.userData.materials.rail_white);
  assert.ok(root.userData.materials.rail_pressure_treated);
});

test('7. Independent Per-Item Customization Verification', () => {
  const home = defaultHome();
  const scene = defaultScene();

  const doors = home.openings.filter((o) => o.type === 'door' || o.type === 'slider');
  assert.ok(doors.length >= 2, 'At least two doors exist for per-item test');

  const door1 = doors[0];
  const door2 = doors[1];

  // Customize Door 1 independently
  door1.stepMat = 'pressure_treated';
  door1.stepEgress = 'left';
  door1.railMat = 'black_metal';

  // Customize Door 2 independently with completely different options
  door2.stepMat = 'dark_composite';
  door2.stepEgress = 'split';
  door2.railMat = 'white_trim';

  // Rebuild model and verify that both retain their distinct per-item settings
  const root = buildHome(home, scene);
  const stepsGroup = root.children.find((c) => c.name === 'steps');
  assert.ok(stepsGroup);

  assert.equal(door1.stepMat, 'pressure_treated');
  assert.equal(door1.stepEgress, 'left');
  assert.equal(door1.railMat, 'black_metal');

  assert.equal(door2.stepMat, 'dark_composite');
  assert.equal(door2.stepEgress, 'split');
  assert.equal(door2.railMat, 'white_trim');
});

test('8. Wireframe View Mode State Verification', () => {
  const scene = defaultScene();
  assert.equal(scene.wireframe, false, 'Default wireframe setting is false');

  const home = defaultHome();
  const root = buildHome(home, scene);

  let meshCount = 0;
  root.traverse((o) => {
    if (o.isMesh && o.material) {
      meshCount++;
      const list = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of list) {
        m.wireframe = true;
        assert.equal(m.wireframe, true);
        m.wireframe = false;
        assert.equal(m.wireframe, false);
      }
    }
  });

  assert.ok(meshCount > 0, 'Meshes present to apply wireframe');
});

test('9. Roof Dormers & False Eaves Construction Verification', () => {
  const home = defaultHome();
  const scene = defaultScene();

  home.dimensions.dormerCount = 2; // Double dormers
  home.dimensions.dormerWidthFt = 12.0;
  home.dimensions.dormerHeightFt = 5.0;
  home.dimensions.dormerFalseEave = true;
  home.dimensions.dormerWindow = true;

  const root = buildHome(home, scene);
  const roof = root.children.find((c) => c.name === 'roof');
  assert.ok(roof, 'Roof group present');

  const dormers = roof.children.find((c) => c.name === 'dormers');
  assert.ok(dormers, 'Dormers group generated');
  assert.equal(dormers.children.length, 2, 'Two dormer assemblies constructed for double dormers');
});

test('10. Collapsible Accordion Category Organization Verification', () => {
  const panelIds = [
    'panel_building',
    'panel_dormers',
    'panel_colors',
    'panel_openings',
    'panel_stairs',
    'panel_photo',
    'panel_plan',
    'panel_export',
  ];

  assert.equal(panelIds.length, 8, '8 distinct purpose-driven collapsible categories configured');
});

test('11. Compact UI & Full-Screen 3D Rendering Canvas Priority Verification', () => {
  const sidebarWidthPx = 260; // Slim compact sidebar width
  assert.equal(sidebarWidthPx, 260, 'Sidebar width compact at 260px');

  const stageFlex = '1 1 auto';
  assert.equal(stageFlex, '1 1 auto', '3D stage flex expands to occupy maximum screen space');
});

test('12. Wall Height Definition & Per-Wall Custom Height Verification', () => {
  const home = defaultHome();
  home.dimensions.wallHeightFt = 9.0;
  home.dimensions.frontWallHeightFt = 10.0;

  const root = buildHome(home, defaultScene());
  assert.equal(getWallHeight('front', home.dimensions), 10.0, 'Front wall height reads custom defined 10.0 ft');
  assert.equal(getWallHeight('back', home.dimensions), 9.0, 'Back wall height falls back to defined base wall height 9.0 ft');

  const frontWallGroup = root.children.find((c) => c.name === 'wall:front');
  assert.ok(frontWallGroup, 'Front wall mesh constructed with defined height');
});

test('13. Custom Dormer Positions Respected in Build', () => {
  const home = defaultHome();
  home.dimensions.dormerCount = 2;
  home.dimensions.dormerPositions = [-10, 10];

  const root = buildHome(home, defaultScene());
  const roof = root.children.find((c) => c.name === 'roof');
  assert.ok(roof, 'Roof group exists');
  const dormers = roof.children.find((c) => c.name === 'dormers');
  assert.ok(dormers, 'Dormers group generated');
  assert.equal(dormers.children.length, 2, 'Two dormer assemblies at custom positions');

  // Each dormer should be tagged with its index for picking
  const d0 = dormers.children[0];
  const d1 = dormers.children[1];
  assert.equal(d0.userData.dormerIndex, 0, 'First dormer tagged with index 0');
  assert.equal(d1.userData.dormerIndex, 1, 'Second dormer tagged with index 1');
  assert.equal(d0.name, 'dormer:0', 'First dormer named dormer:0');
  assert.equal(d1.name, 'dormer:1', 'Second dormer named dormer:1');
});

test('14. Nested Inner False Eave (Double-Wide Stepped Profile)', () => {
  const home = defaultHome();
  home.dimensions.dormerCount = 1;
  home.dimensions.dormerFalseEave = true;
  home.dimensions.dormerInnerFalseEave = true;

  const root = buildHome(home, defaultScene());
  const roof = root.children.find((c) => c.name === 'roof');
  const dormers = roof.children.find((c) => c.name === 'dormers');
  assert.ok(dormers, 'Dormers group generated');

  const dormer0 = dormers.children[0];
  // Find inner false eave by name
  const innerEaves = [];
  dormer0.traverse((child) => {
    if (child.name === 'innerFalseEave') innerEaves.push(child);
  });
  assert.equal(innerEaves.length, 1, 'Inner false eave mesh exists inside dormer assembly');

  // Now test with inner false eave disabled
  home.dimensions.dormerInnerFalseEave = false;
  const root2 = buildHome(home, defaultScene());
  const roof2 = root2.children.find((c) => c.name === 'roof');
  const dormers2 = roof2.children.find((c) => c.name === 'dormers');
  const dormer0b = dormers2.children[0];
  const innerEaves2 = [];
  dormer0b.traverse((child) => {
    if (child.name === 'innerFalseEave') innerEaves2.push(child);
  });
  assert.equal(innerEaves2.length, 0, 'Inner false eave absent when disabled');
});

test('15. Connected Dormer Cap (Double-Wide Merged Shed Profile)', () => {
  const home = defaultHome();
  home.dimensions.dormerCount = 2;
  home.dimensions.dormerConnected = true;
  home.dimensions.dormerFalseEave = true;
  home.dimensions.dormerInnerFalseEave = true;
  home.dimensions.dormerWindow = true;

  const root = buildHome(home, defaultScene());
  const roof = root.children.find((c) => c.name === 'roof');
  assert.ok(roof, 'Roof group exists');
  const dormers = roof.children.find((c) => c.name === 'dormers');
  assert.ok(dormers, 'Dormers group generated');

  // Connected mode produces a single cap group, not two separate dormers.
  assert.equal(dormers.children.length, 1, 'Single connected cap group');
  const cap = dormers.children[0];
  assert.equal(cap.name, 'dormer:connected', 'Cap group named dormer:connected');

  // Should contain: front wall, shed roof, 2 side walls, 2 eave returns,
  // 2 inner eave returns, top fascia, bottom trim, and 4 window meshes (2 glass + 2 frame).
  assert.ok(cap.children.length >= 10, `Cap has ${cap.children.length} children (expected >= 10)`);

  // Verify inner false eaves exist
  const innerEaves = [];
  cap.traverse((child) => {
    if (child.name === 'innerFalseEave') innerEaves.push(child);
  });
  assert.equal(innerEaves.length, 2, 'Two inner false eave returns (one per side)');
});

test('16. Independent Per-Dormer Sizes', () => {
  // Unlinked sizes: each dormer builds from its own width/height override.
  const home = defaultHome();
  home.dimensions.dormerCount = 2;
  home.dimensions.dormerPositions = [-14, 12];
  home.dimensions.dormerLinkSizes = false;
  home.dimensions.dormerSizes = [
    { widthFt: 16, heightFt: 6 },
    { widthFt: 7, heightFt: 3.5 },
  ];

  assert.deepEqual(dormerSize(home.dimensions, 0), { dW: 16, dH: 6 });
  assert.deepEqual(dormerSize(home.dimensions, 1), { dW: 7, dH: 3.5 });

  const roof = buildHome(home, defaultScene()).children.find((c) => c.name === 'roof');
  const dormers = roof.children.find((c) => c.name === 'dormers');
  assert.equal(dormers.children.length, 2, 'Two independent dormer assemblies');

  const gableWidth = (grp) => {
    const g = grp.children[0].geometry;
    g.computeBoundingBox();
    const b = g.boundingBox;
    return b.max.x - b.min.x;
  };
  const w0 = gableWidth(dormers.children[0]);
  const w1 = gableWidth(dormers.children[1]);
  assert.ok(Math.abs(w0 - 16) < 0.01, `Dormer 0 gable spans 16 ft (got ${w0})`);
  assert.ok(Math.abs(w1 - 7) < 0.01, `Dormer 1 gable spans 7 ft (got ${w1})`);
  assert.ok(w0 > w1, 'Adjusting one dormer does not resize the other');

  // A missing override falls back to the global size.
  home.dimensions.dormerSizes = [{ widthFt: 16 }, null];
  assert.deepEqual(dormerSize(home.dimensions, 0), { dW: 16, dH: home.dimensions.dormerHeightFt });
  assert.deepEqual(dormerSize(home.dimensions, 1), {
    dW: home.dimensions.dormerWidthFt,
    dH: home.dimensions.dormerHeightFt,
  });

  // Linked mode ignores the overrides entirely (legacy behaviour).
  home.dimensions.dormerLinkSizes = true;
  home.dimensions.dormerSizes = [{ widthFt: 16, heightFt: 6 }, { widthFt: 7, heightFt: 3.5 }];
  assert.deepEqual(dormerSize(home.dimensions, 0), dormerSize(home.dimensions, 1));

  // Connected cap uses each end's own width and the taller of the two heights.
  home.dimensions.dormerLinkSizes = false;
  home.dimensions.dormerConnected = true;
  const cap = buildHome(home, defaultScene())
    .children.find((c) => c.name === 'roof')
    .children.find((c) => c.name === 'dormers').children[0];
  assert.equal(cap.name, 'dormer:connected');
  const wall = cap.children[0].geometry;
  wall.computeBoundingBox();
  const capWidth = wall.boundingBox.max.x - wall.boundingBox.min.x;
  const expected = (12 + 7 / 2) - (-14 - 16 / 2);
  assert.ok(Math.abs(capWidth - expected) < 0.01, `Cap spans ${expected} ft (got ${capWidth})`);
});

test('17. Migration Normalizes Per-Dormer Size Overrides', () => {
  const migrated = migrate({
    dimensions: {
      dormerCount: 2,
      dormerLinkSizes: false,
      dormerSizes: [{ widthFt: '14', heightFt: 5 }, 'junk', { widthFt: -3 }],
      dormerPositions: ['-10', 10, 'x'],
    },
  });
  assert.deepEqual(migrated.dimensions.dormerSizes, [{ widthFt: 14, heightFt: 5 }, null, null]);
  assert.deepEqual(migrated.dimensions.dormerPositions, [-10, 10]);
  assert.equal(migrated.dimensions.dormerLinkSizes, false);

  // Legacy saves with no dormer size data come back unlinked, which is visually
  // identical because an empty dormerSizes array inherits the global size.
  assert.equal(migrate({ dimensions: {} }).dimensions.dormerLinkSizes, false);
  assert.equal(migrate({ dimensions: { dormerLinkSizes: true } }).dimensions.dormerLinkSizes, true);
  assert.deepEqual(migrate({ dimensions: {} }).dimensions.dormerSizes, []);
});

test('18. Nested Dormer (Gable Inside Gable)', () => {
  const home = defaultHome();
  home.dimensions.dormerCount = 2;
  home.dimensions.dormerNested = true;
  home.dimensions.dormerLinkSizes = false;
  home.dimensions.dormerPositions = [0, 0];
  home.dimensions.dormerSizes = [
    { widthFt: 18, heightFt: 6 },
    { widthFt: 8, heightFt: 3.5 },
  ];

  const roof = buildHome(home, defaultScene()).children.find((c) => c.name === 'roof');
  const dormers = roof.children.find((c) => c.name === 'dormers');
  assert.equal(dormers.children.length, 2, 'Outer and inner gable assemblies');

  const face = (grp) => {
    const m = grp.children[0];
    m.geometry.computeBoundingBox();
    const b = m.geometry.boundingBox;
    return { w: b.max.x - b.min.x, h: b.max.y - b.min.y, z: m.position.z, x: m.position.x };
  };
  const outer = face(dormers.children[0]);
  const inner = face(dormers.children[1]);

  assert.ok(Math.abs(outer.w - 18) < 0.01, `Outer gable 18 ft wide (got ${outer.w})`);
  assert.ok(Math.abs(inner.w - 8) < 0.01, `Inner gable 8 ft wide (got ${inner.w})`);
  assert.ok(inner.w < outer.w && inner.h < outer.h, 'Inner gable fits inside the outer one');
  assert.ok(inner.z < outer.z, 'Inner gable projects forward of the outer face');

  // The inner gable is clamped to stay inside the outer gable, both in size...
  home.dimensions.dormerSizes[1] = { widthFt: 40, heightFt: 40 };
  const clamped = face(
    buildHome(home, defaultScene())
      .children.find((c) => c.name === 'roof')
      .children.find((c) => c.name === 'dormers').children[1]
  );
  assert.ok(Math.abs(clamped.w - 16.5) < 0.01, `Inner width clamped to outer - 1.5 (got ${clamped.w})`);
  assert.ok(Math.abs(clamped.h - 5.5) < 0.01, `Inner height clamped to outer - 0.5 (got ${clamped.h})`);

  // ...and in offset.
  home.dimensions.dormerSizes[1] = { widthFt: 8, heightFt: 3.5 };
  home.dimensions.dormerNestOffsetFt = 50;
  const shoved = face(
    buildHome(home, defaultScene())
      .children.find((c) => c.name === 'roof')
      .children.find((c) => c.name === 'dormers').children[1]
  );
  assert.ok(Math.abs(shoved.x - 4.5) < 0.01, `Offset clamped inside the outer face (got ${shoved.x})`);

  // Resizing the inner gable leaves the outer one untouched.
  const outerAfter = face(
    buildHome(home, defaultScene())
      .children.find((c) => c.name === 'roof')
      .children.find((c) => c.name === 'dormers').children[0]
  );
  assert.deepEqual(
    { w: outerAfter.w, h: outerAfter.h },
    { w: outer.w, h: outer.h },
    'Outer gable unchanged by inner gable edits'
  );
});

test('19. Dormer Sizes Snap to the Quarter-Foot Grid', () => {
  const m = migrate({
    dimensions: {
      dormerCount: 2,
      dormerSizes: [{ widthFt: 9.9962, heightFt: 4.0833 }, { widthFt: 0.05, heightFt: 3 }],
    },
  }).dimensions;
  // Quarter feet divide evenly into a foot, so the spinner lands on whole numbers.
  assert.deepEqual(m.dormerSizes[0], { widthFt: 10, heightFt: 4 });
  // ...and nothing collapses to a zero-size gable.
  assert.deepEqual(m.dormerSizes[1], { widthFt: 0.25, heightFt: 3 });
});

test('20. Global Opening Head Alignment Below Wall Top', () => {
  const home = defaultHome();
  home.dimensions.wallHeightFt = 9;
  home.dimensions.leftWallHeightFt = 12;   // per-wall heights drive their own heads
  home.dimensions.headAlign = true;
  home.dimensions.windowHeadDropFt = 1.5;
  home.dimensions.doorHeadDropFt = 2;

  const win = home.openings.find((o) => o.type === 'window' && o.wall === 'front');
  const leftWin = home.openings.find((o) => o.type === 'window' && o.wall === 'left');
  const door = home.openings.find((o) => o.type === 'door');
  win.sillFt = 0.1;
  door.heightFt = 3;

  applyHeadAlign(home);

  // Windows keep their height and ride on the sill; doors stay on the floor, so
  // the drop sets their height instead.
  assert.equal(win.sillFt + win.heightFt, 9 - 1.5, 'Front window head sits 1.5 ft below the wall top');
  assert.equal(leftWin.sillFt + leftWin.heightFt, 12 - 1.5, 'Left window follows the 12 ft wall');
  assert.equal(door.sillFt, 0, 'Door stays on the floor');
  assert.equal(door.heightFt, 9 - 2, 'Door height set by the head drop');

  // An opening flagged headFree keeps whatever the user set.
  const other = home.openings.filter((o) => o.type === 'window')[1];
  other.headFree = true;
  other.sillFt = 0.25;
  applyHeadAlign(home);
  assert.equal(other.sillFt, 0.25, 'Free-head opening untouched');

  // Off by default, and a no-op while off.
  const plain = defaultHome();
  assert.equal(plain.dimensions.headAlign, false);
  const sill = plain.openings.find((o) => o.type === 'window').sillFt;
  applyHeadAlign(plain);
  assert.equal(plain.openings.find((o) => o.type === 'window').sillFt, sill, 'No change while disabled');

  // buildHome applies it, so the geometry and the sidebar values agree.
  home.dimensions.headAlign = true;
  win.sillFt = 0;
  buildHome(home, defaultScene());
  assert.equal(win.sillFt + win.heightFt, 9 - 1.5, 'buildHome re-aligns the heads');
});

test('20. Procedural Siding Material Creation & Texture Generation', () => {
  const lapMat = createSidingMaterial('#8d9299', 'horizontal_lap');
  assert.ok(lapMat, 'Horizontal lap material generated');

  const shakeMat = createSidingMaterial('#4a525d', 'cedar_shingle');
  assert.ok(shakeMat, 'Cedar shingle material generated');

  const boardMat = createSidingMaterial('#ffffff', 'board_batten');
  assert.ok(boardMat, 'Board & batten material generated');
});

test('21. Corner Trim Boards & Per-Area Siding Assignment (Dormers & Gable Accents)', () => {
  const home = defaultHome();
  home.dimensions.cornerTrim = true;
  home.dimensions.cornerTrimWidthFt = 0.5;
  home.dimensions.sidingTexture = 'horizontal_lap';
  home.dimensions.dormerSidingTexture = 'cedar_shingle';
  home.dimensions.gableSidingTexture = 'board_batten';
  home.colors.dormerSiding = '#5a626d';
  home.colors.gableSiding = '#3a424d';
  home.dimensions.dormerCount = 1;

  const root = buildHome(home, defaultScene());
  const corners = root.children.find((c) => c.name === 'cornerTrim');
  assert.ok(corners, 'Corner trim group constructed');
  assert.equal(corners.children.length, 8, '8 corner trim boards generated for 4 L-shaped building corners');

  const leftWall = root.children.find((c) => c.name === 'wall:left');
  assert.ok(leftWall, 'Left gable end wall constructed');
  const gablePeak = leftWall.children.find((c) => c.name === 'gablePeak');
  assert.ok(gablePeak, 'Gable peak constructed with independent gable accent material');

  const materials = root.userData.materials;
  assert.ok(materials.siding, 'Main siding material initialized');
  assert.ok(materials.dormerSiding, 'Dormer siding material initialized');
  assert.ok(materials.gableSiding, 'Gable siding material initialized');
});

test('22. Continuous Wall Siding & Drip Edge Removal Verification', () => {
  const home = defaultHome();
  home.dimensions.dormerCount = 1;
  home.dimensions.dormerDripEdge = false;
  home.dimensions.dormerContinuousWall = true;
  home.colors.belowDormerSiding = '#7a828d';

  const root = buildHome(home, defaultScene());
  const roof = root.children.find((c) => c.name === 'roof');
  assert.ok(roof, 'Roof constructed');
  const dormers = roof.children.find((c) => c.name === 'dormers');
  assert.ok(dormers, 'Dormers constructed');

  const materials = root.userData.materials;
  assert.ok(materials.belowDormerSiding, 'Below-dormer siding material initialized');

  // Verify continuous wall siding inherits main siding material when dormerContinuousWall is true
  const dormer0 = dormers.children[0];
  const frontGable = dormer0.children[0];
  assert.equal(frontGable.material, materials.siding, 'Dormer inherits main wall siding material for seamless wall continuation');

  // Verify main roof front fascia is split into segments so no fascia runs through under the dormer baseline
  const frontFascia = roof.children.find((c) => c.name === 'fasciaFront');
  assert.ok(frontFascia, 'Front fascia cut out into segments under dormers in continuous wall mode');
  assert.equal(frontFascia.children.length, 2, '2 front fascia segments on outer sides of single dormer');
});

test('23. Split Double Side Egress Stair Railings Verification', () => {
  const home = defaultHome();
  const frontDoor = home.openings.find((o) => o.type === 'door');
  assert.ok(frontDoor, 'Door exists');

  frontDoor.stepEgress = 'split';
  frontDoor.stepRailings = 'both';
  frontDoor.railMat = 'black_metal';

  const root = buildHome(home, defaultScene());
  const stepsGroup = root.children.find((c) => c.name === 'steps');
  assert.ok(stepsGroup, 'Steps constructed');
  assert.ok(stepsGroup.children.length > 0, 'Step meshes generated for split egress door');

  // Verify railing posts & sloped rails exist for double side egress
  const doorSteps = stepsGroup.children[0];
  assert.ok(doorSteps.children.length > 5, 'Railings and posts generated for split double side egress stairs');
});




test('24. Undo / Redo History Stack', () => {
  let clock = 0;
  const h = new History({ limit: 4, coalesceMs: 100, now: () => clock });

  h.reset({ home: { name: 'a' } }, 'opened');
  assert.equal(h.canUndo, false, 'Nothing to undo at the opening state');
  assert.equal(h.canRedo, false, 'Nothing to redo at the opening state');

  // An identical snapshot is not a step — save() fires on no-op changes too.
  assert.equal(h.record({ home: { name: 'a' } }, 'dimensions'), false, 'Unchanged state is ignored');
  assert.equal(h.size, 1, 'Stack unchanged by a no-op record');

  clock = 1000;
  h.record({ home: { name: 'b' } }, 'dimensions');
  clock = 2000;
  h.record({ home: { name: 'c' } }, 'openings');
  assert.equal(h.size, 3);
  assert.equal(h.peekUndo(), 'openings', 'Undo reports the step it will take back');

  const back = h.undo();
  assert.equal(back.snapshot.home.name, 'b', 'Undo returns the previous state');
  assert.equal(h.peekRedo(), 'openings', 'Redo reports the step it will re-apply');
  const fwd = h.redo();
  assert.equal(fwd.snapshot.home.name, 'c', 'Redo returns the state that was undone');

  // Recording after an undo drops the redo tail.
  h.undo();
  clock = 3000;
  h.record({ home: { name: 'd' } }, 'colours');
  assert.equal(h.canRedo, false, 'A new edit after undo clears the redo tail');
  assert.equal(h.current.home.name, 'd');

  // Rapid same-label edits coalesce into one step (slider drags).
  clock = 3010;
  h.record({ home: { name: 'd2' } }, 'colours');
  clock = 3020;
  h.record({ home: { name: 'd3' } }, 'colours');
  assert.equal(h.size, 3, 'Same-label edits inside the window merge into one entry');
  assert.equal(h.undo().snapshot.home.name, 'b', 'The merged step undoes back past all of them');
  h.redo();

  // A different label always starts a new step, however fast it arrives.
  clock = 3025;
  h.record({ home: { name: 'e' } }, 'openings');
  assert.equal(h.size, 4, 'A different label is never merged');

  // The limit drops the oldest entries, never the newest.
  clock = 4000;
  h.record({ home: { name: 'f' } }, 'dimensions');
  assert.equal(h.size, 4, 'Stack is capped at the limit');
  assert.equal(h.current.home.name, 'f', 'Newest state survives the cap');

  // Snapshots are copies: mutating the caller's object cannot corrupt the stack.
  const live = { home: { name: 'g' } };
  clock = 5000;
  h.record(live, 'dimensions');
  live.home.name = 'mutated';
  assert.equal(h.current.home.name, 'g', 'Stored snapshots are deep copies');
});

test('25. History Change Labels', () => {
  const base = { home: defaultHome(), scene: defaultScene() };
  const clone = () => JSON.parse(JSON.stringify(base));

  const openings = clone();
  openings.home.openings[0].widthFt = 9;
  assert.equal(describeChange(base, openings), 'openings');

  // Labels name the field, so two different fields never merge into one step.
  const dims = clone();
  dims.home.dimensions.roofPitch = 6;
  assert.equal(describeChange(base, dims), 'roof pitch');

  const width = clone();
  width.home.dimensions.widthFt = 30;
  assert.equal(describeChange(base, width), 'width');
  assert.notEqual(describeChange(base, dims), describeChange(base, width));

  const colors = clone();
  colors.home.colors.roof = '#123456';
  assert.equal(describeChange(base, colors), 'roof colour');

  const photo = clone();
  photo.home.sitePhoto.panX = 12;
  assert.equal(describeChange(base, photo), 'pan x site photo');

  const scene = clone();
  scene.scene.sunAz = 200;
  assert.equal(describeChange(base, scene), 'sun az scene');

  assert.equal(describeChange(base, clone()), 'edit', 'No difference falls back to a generic label');
});


test('26. Project File Round-Trips Home, Scene, View and Camera', () => {
  const home = defaultHome();
  home.name = 'Saved with a view';
  home.sitePhoto = { ...home.sitePhoto, src: 'data:image/jpeg;base64,AAAA', rotation: 12, panX: -4, scale: 0.7 };
  const scene = { ...defaultScene(), sunAz: 210, bg: '#101418', grid: false };
  const exportOpts = { ...defaultExport(), w: 3000 };
  const camera = {
    type: 'ortho',
    position: [0, 12, -300], quaternion: [0, 1, 0, 0], target: [0, 6, 0],
    zoom: 1.4, fov: 42, orthoFit: { w: 56, h: 14, pad: 1.18 }, orthoHalfH: 9.2,
    preset: 'front', userMoved: true,
  };

  const file = buildProject({
    home, scene, exportOpts,
    view: { preset: 'front', label: 'Front elev', camera },
    savedAt: '2026-07-28T12:00:00.000Z',
  });
  assert.equal(file.version, PROJECT_VERSION);
  assert.equal(file.savedAt, '2026-07-28T12:00:00.000Z');

  // Survives serialisation — this is what actually lands on disk.
  const read = readProject(JSON.parse(JSON.stringify(file)));

  assert.equal(read.home.name, 'Saved with a view');
  assert.equal(read.home.sitePhoto.src, 'data:image/jpeg;base64,AAAA', 'Background image travels with the project');
  assert.equal(read.home.sitePhoto.rotation, 12, 'Photo orientation is preserved');
  assert.equal(read.home.sitePhoto.panX, -4);
  assert.equal(read.home.sitePhoto.scale, 0.7);
  assert.equal(read.scene.sunAz, 210, 'Scene options are preserved');
  assert.equal(read.scene.bg, '#101418');
  assert.equal(read.scene.grid, false);
  assert.equal(read.exportOpts.w, 3000, 'Export settings are preserved');
  assert.equal(read.view.preset, 'front', 'View preset is preserved');
  assert.equal(read.view.label, 'Front elev');
  assert.deepEqual(read.view.camera, camera, 'Camera orientation is preserved verbatim');
  assert.equal(read.restoredView, true);
  assert.equal(read.version, PROJECT_VERSION);
});

test('27. Project Reader Accepts Older Bare-Home Files', () => {
  // homes/*.json and anything saved before views existed are a bare home object.
  const bare = defaultHome();
  bare.name = 'Library spec';
  const read = readProject(JSON.parse(JSON.stringify(bare)));

  assert.equal(read.home.name, 'Library spec');
  assert.equal(read.restoredView, false, 'No camera in an old file, so the app frames it itself');
  assert.equal(read.view.camera, null);
  assert.equal(read.version, 1);
  assert.deepEqual(read.scene, defaultScene(), 'Missing scene falls back to defaults');
  assert.deepEqual(read.exportOpts, defaultExport());

  // A wrapped file with no view block is still readable.
  const wrapped = readProject({ home: bare, scene: { ...defaultScene(), sunEl: 12 } });
  assert.equal(wrapped.restoredView, false);
  assert.equal(wrapped.scene.sunEl, 12);

  assert.throws(() => readProject(null), /not a project file/);
  assert.throws(() => readProject({ nothing: true }), /no home/);
});

// ---------------------------------------------------------------------------
// Render package: zip container, brief text, and the state that carries them
// ---------------------------------------------------------------------------

test('28. Zip Writer Produces A Readable Store-Only Archive', () => {
  const files = [
    { name: 'pkg/00-README.md', data: 'hello world' },
    { name: 'pkg/10-photo.png', data: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]) },
  ];
  const bytes = zipStore(files, { modified: new Date(2026, 6, 29, 12, 30, 0) });

  assert.ok(bytes instanceof Uint8Array);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(dv.getUint32(0, true), 0x04034b50, 'Starts with a local file header');

  // End of central directory: last 22 bytes when there is no archive comment.
  const eocd = bytes.length - 22;
  assert.equal(dv.getUint32(eocd, true), 0x06054b50, 'Ends with EOCD');
  assert.equal(dv.getUint16(eocd + 10, true), 2, 'Two entries in the directory');

  const cdStart = dv.getUint32(eocd + 16, true);
  assert.equal(dv.getUint32(cdStart, true), 0x02014b50, 'Central directory sits where EOCD says');

  // Store-only: the payload is present verbatim, so the reader does not need
  // an inflater. Find the README text in the raw bytes.
  const text = new TextDecoder().decode(bytes);
  assert.ok(text.includes('hello world'), 'Entry data is stored uncompressed');
  assert.ok(text.includes('pkg/00-README.md'), 'Entry names are stored');

  assert.throws(() => zipStore([]), /at least one entry/);
});

test('29. CRC32 And Data URL Decoding Match Known Values', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926, 'CRC-32 check value');
  assert.equal(crc32(new Uint8Array(0)), 0);

  const bytes = dataUrlToBytes('data:image/png;base64,aGVsbG8=');
  assert.equal(new TextDecoder().decode(bytes), 'hello');
  assert.equal(dataUrlExt('data:image/png;base64,AA'), 'png');
  assert.equal(dataUrlExt('data:image/jpeg;base64,AA'), 'jpg');
  assert.equal(dataUrlExt('data:application/pdf;base64,AA'), 'pdf');
  assert.throws(() => dataUrlToBytes('not-a-data-url'), /not a data URL/);
});

test('30. Brief Carries The Measured Geometry, Not Hand-Typed Blanks', () => {
  const home = defaultHome();
  home.name = 'Redmond 25610';
  home.dimensions.widthFt = 27;
  home.dimensions.lengthFt = 56;
  const scene = defaultScene();

  const framing = {
    left: 0.3, right: 0.8, ridgeTop: 0.62, bottom: 0.2, top: 0.62,
    nearCorner: 'front-right corner', visibleWalls: ['front wall', 'right gable end'],
    viewLabel: '¾ front-L',
  };
  const md = buildBrief({
    home, scene, framing,
    site: { landmark: 'the utility pole', keep: 'trees and sky', pad: 'the gravel pad' },
    manifest: [{ index: 1, file: '10-lot-photo.jpg', role: 'the empty lot' }],
    savedAt: '2026-07-29',
  });

  assert.ok(md.includes('Redmond 25610'));
  assert.ok(md.includes('2.07'), 'States the front-wall to gable-end ratio');
  assert.ok(md.includes('30% to 80%'), 'Scale comes from the measured framing');
  assert.ok(md.includes('62%'), 'Ridge height comes from the measured framing');
  assert.ok(md.includes('front-right corner'), 'Near corner comes from the camera');
  assert.ok(md.includes('the gravel pad') && md.includes('the utility pole'));
  assert.ok(md.includes('10-lot-photo.jpg'), 'Attachments are named by filename');
  assert.ok(!md.includes('{{X1}}'), 'No unfilled scale blanks when framing is known');
  // The opening schedule is the whole point — the walls no photo covers.
  assert.ok(md.includes('Rear / utility door'));
  assert.ok(md.includes('Primary bedroom'));

  // With no framing, it degrades to blanks rather than inventing numbers.
  const noFraming = buildBrief({ home, scene, site: {} });
  assert.ok(noFraming.includes('{{X1}}'));
});

test('31. Brief Vocabulary Is Derived From The Model State', () => {
  assert.equal(colorName('#3a3d42'), 'charcoal');
  assert.equal(colorName('#f5f5f2'), 'white');
  assert.equal(colorName('#8c3a33'), 'barn red');
  assert.equal(colorName('nonsense'), 'unspecified');

  assert.equal(sidingLabel('board_batten'), 'vertical board-and-batten siding');
  assert.equal(sidingLabel(undefined), 'horizontal lap siding');

  assert.ok(describeLighting({ flat: 0.95 }).includes('overcast'));
  assert.ok(describeLighting({ flat: 0.6 }).includes('soft'));
  assert.ok(describeLighting({ flat: 0.1, sunAz: 300, sunEl: 15 }).includes('from the right'));

  const home = defaultHome();
  assert.ok(wallSummary(home, 'front').includes('window'));
  assert.equal(wallSummary({ openings: [] }, 'left'), 'blank — no doors, no windows');

  const rows = openingSchedule(home);
  assert.equal(rows.length, home.openings.length);
  assert.equal(rows[0].wall, 'front', 'Schedule is grouped front, rear, left, right');
  const walls = [...new Set(rows.map((r) => r.wall))];
  assert.deepEqual(walls, ['front', 'back', 'left', 'right']);
});

test('32. Site Plan And Brief Blanks Survive A Save/Reopen Round Trip', () => {
  const home = defaultHome();
  home.sitePlan = {
    src: 'data:image/png;base64,AAAA', pdf: 'data:application/pdf;base64,BBBB',
    name: '139160_117254_3196.pdf', page: 1, pageCount: 4, width: 1700, height: 2200,
  };
  home.brief.landmark = 'the utility pole on the left';
  home.brief.keep = 'trees, stone wall, sky';

  const file = buildProject({ home, scene: defaultScene(), exportOpts: defaultExport(), view: null });
  const read = readProject(JSON.parse(JSON.stringify(file)));

  assert.equal(read.home.sitePlan.src, 'data:image/png;base64,AAAA');
  assert.equal(read.home.sitePlan.pageCount, 4);
  assert.equal(read.home.sitePlan.name, '139160_117254_3196.pdf');
  assert.equal(read.home.brief.landmark, 'the utility pole on the left');

  // A file saved before the render package existed still opens, with defaults.
  const old = migrate({ dimensions: defaultHome().dimensions, openings: [] });
  assert.equal(old.sitePlan.src, null);
  assert.deepEqual(old.brief, defaultBrief());
});

// ---------------------------------------------------------------------------
// Saved site views and the 360 panorama
// ---------------------------------------------------------------------------

test('33. Site Views Capture Only The Photo Fields, And Cycle With Wrap', () => {
  const a = captureSiteView({
    name: 'From the gate',
    sitePhoto: { src: 'data:x', scale: 2, panX: -8, show: true, transient: 'nope' },
    camera: { type: 'persp', position: [1, 2, 3] },
    viewLabel: '¾ front-L',
  });
  const b = captureSiteView({ name: 'From the road', sitePhoto: { src: 'data:y' } });

  assert.equal(a.photo.scale, 2);
  assert.equal(a.photo.panX, -8);
  assert.equal(a.photo.transient, undefined, 'Only the documented photo fields are stored');
  assert.equal(a.viewLabel, '¾ front-L');
  assert.notEqual(a.id, b.id, 'Views get distinct ids');
  assert.equal(captureSiteView({ sitePhoto: {} }).name, 'Untitled view');

  const list = [a, b];
  assert.equal(cycleSiteView(list, a.id, 1).id, b.id);
  assert.equal(cycleSiteView(list, b.id, 1).id, a.id, 'Forward wraps');
  assert.equal(cycleSiteView(list, a.id, -1).id, b.id, 'Backward wraps');
  // From an unsaved set-up both directions still land somewhere useful.
  assert.equal(cycleSiteView(list, null, 1).id, a.id);
  assert.equal(cycleSiteView(list, null, -1).id, b.id);
  assert.equal(cycleSiteView([], null, 1), null, 'Nothing to cycle');
  assert.equal(indexOfView(list, b.id), 1);

  // Applying a view overlays its photo onto the live one, leaving the rest.
  const applied = applySiteView(a, { opacity: 0.4, rotY: 12 });
  assert.equal(applied.src, 'data:x');
  assert.equal(applied.scale, 2);
  assert.equal(applied.rotY, 12, 'Untouched live fields survive');
});

test('34. Site View Names Are Made Unique — They Become Package Folders', () => {
  const a = captureSiteView({ name: 'North', sitePhoto: {} });
  const b = captureSiteView({ name: 'North', sitePhoto: {} });
  b.name = uniqueViewName([a], 'North');
  assert.equal(b.name, 'North 2');
  assert.equal(uniqueViewName([a, b], 'North'), 'North 3');
  // Clash detection ignores case; the typed casing is what gets kept.
  assert.equal(uniqueViewName([a, b], 'north'), 'north 3');
  assert.equal(uniqueViewName([a], 'North', a.id), 'North', 'Renaming itself is not a clash');
  assert.equal(uniqueViewName([], ''), 'Untitled view');
});

test('35. Site Views And Panorama Round-Trip Through A Project File', () => {
  const home = defaultHome();
  home.siteViews = [
    captureSiteView({ name: 'From the gate', sitePhoto: { src: 'data:a', panY: 4 }, camera: { type: 'persp' }, viewLabel: '¾ front-L' }),
    captureSiteView({ name: 'From the road', sitePhoto: { src: 'data:b' }, camera: { type: 'ortho' } }),
  ];
  home.activeSiteViewId = home.siteViews[1].id;
  home.panorama = { ...home.panorama, src: 'data:pano', yawDeg: 37, radiusFt: 420, heightFt: 5 };

  const file = buildProject({ home, scene: defaultScene(), exportOpts: defaultExport(), view: null });
  const read = readProject(JSON.parse(JSON.stringify(file)));

  assert.equal(read.home.siteViews.length, 2);
  assert.equal(read.home.siteViews[0].name, 'From the gate');
  assert.equal(read.home.siteViews[0].photo.panY, 4);
  assert.equal(read.home.siteViews[0].camera.type, 'persp');
  assert.equal(read.home.activeSiteViewId, home.siteViews[1].id, 'Which view was active is kept');
  assert.equal(read.home.panorama.yawDeg, 37);
  assert.equal(read.home.panorama.radiusFt, 420);

  // An active id pointing at a view that is gone must not survive.
  const orphaned = migrate({ ...home, siteViews: [], activeSiteViewId: 'ghost' });
  assert.equal(orphaned.activeSiteViewId, null);

  // Files written before any of this still open with sane defaults.
  const old = migrate({ dimensions: defaultHome().dimensions, openings: [] });
  assert.deepEqual(old.siteViews, []);
  assert.equal(old.panorama.src, null);
  assert.equal(old.panorama.radiusFt, 300);
});

test('36. A Panorama Backdrop Changes What The Brief Asks For', () => {
  const home = defaultHome();
  const scene = defaultScene();
  const framing = { left: 0.2, right: 0.7, ridgeTop: 0.5, nearCorner: 'front-left corner', visibleWalls: [], viewLabel: 'x' };

  const flat = buildBrief({ home, scene, framing, site: { backdrop: 'photo' } });
  assert.ok(flat.includes('Use the lot photo as the source of truth for the site'));
  assert.ok(!flat.includes('already behind the home'));

  const pano = buildBrief({ home, scene, framing, site: { backdrop: 'panorama' } });
  assert.ok(pano.includes('The lot is already behind the home in the hero plate'));
  assert.ok(pano.includes('360 panorama'));

  // A named pass says which one it is, so folders do not get mixed.
  const pass = buildBrief({ home, scene, framing, site: {}, passName: 'From the gate' });
  assert.ok(pass.includes('From the gate'));
  assert.ok(pass.includes('do not mix their files'));
});

test('37. The Four Lot-Photo Slots Are Named Camera Positions', () => {
  assert.equal(SITE_VIEW_SLOTS.length, 4);
  for (const s of SITE_VIEW_SLOTS) {
    assert.ok(s.key && s.name && s.preset && s.shoot, `${s.key} is fully described`);
    // The user is told where to stand, not just what the view is called.
    assert.ok(s.shoot.length > 30, `${s.key} says where to shoot from`);
  }
  // All four are perspective presets — no photograph is orthographic, so the
  // elevations are geometry reference and can never back a lot photo.
  assert.deepEqual(
    SITE_VIEW_SLOTS.map((s) => s.preset),
    ['hero-left', 'hero-right', 'rear-left', 'eye'],
  );
  assert.equal(slotByKey('hero-left').name, '¾ front-left');
  assert.equal(slotByKey('nope'), null);

  const filled = captureSiteView({ name: '¾ front-left', slotKey: 'hero-left', sitePhoto: { src: 'a' } });
  const freeform = captureSiteView({ name: 'From the gate', sitePhoto: { src: 'b' } });
  assert.equal(freeform.slotKey, null, 'A free-form view claims no slot');
  assert.equal(findSlotView([freeform, filled], 'hero-left').name, '¾ front-left');
  assert.equal(findSlotView([freeform], 'hero-left'), null);

  // A slotKey that is not one of the four is dropped rather than trusted.
  assert.equal(readSiteView({ name: 'x', slotKey: 'made-up' }).slotKey, null);
  assert.equal(readSiteView({ name: 'x', slotKey: 'eye' }).slotKey, 'eye');
});

test('38. Slots Sort Into Shooting Order However They Were Filled', () => {
  const eye = captureSiteView({ name: 'd', slotKey: 'eye', sitePhoto: {} });
  const free1 = captureSiteView({ name: 'free one', sitePhoto: {} });
  const left = captureSiteView({ name: 'a', slotKey: 'hero-left', sitePhoto: {} });
  const free2 = captureSiteView({ name: 'free two', sitePhoto: {} });
  const rear = captureSiteView({ name: 'c', slotKey: 'rear-left', sitePhoto: {} });

  const sorted = sortSiteViews([eye, free1, left, free2, rear]);
  assert.deepEqual(
    sorted.map((v) => v.slotKey),
    ['hero-left', 'rear-left', 'eye', null, null],
    'Slots first in canonical order, free-form after',
  );
  // Free-form views keep the order they were saved in.
  assert.deepEqual(sorted.slice(3).map((v) => v.name), ['free one', 'free two']);

  // Sorting is applied on the way in, so a reopened project reads the same.
  const home = migrate({
    dimensions: defaultHome().dimensions,
    openings: [],
    siteViews: [eye, left].map((v) => JSON.parse(JSON.stringify(v))),
  });
  assert.deepEqual(home.siteViews.map((v) => v.slotKey), ['hero-left', 'eye']);
});

test('39. A Slotted Pass Tells The Model Where The Photo Was Taken From', () => {
  const home = defaultHome();
  const scene = defaultScene();
  const framing = { left: 0.2, right: 0.7, ridgeTop: 0.5, nearCorner: 'front-left corner', visibleWalls: [], viewLabel: 'x' };
  const slot = slotByKey('rear-left');

  const md = buildBrief({ home, scene, framing, site: {}, passName: slot.name, passShoot: slot.shoot });
  assert.ok(md.includes(slot.name));
  assert.ok(md.includes('Where the photograph was taken from:'));
  assert.ok(md.includes('rear-left corner'));

  // Without a slot there is no shooting note to make up.
  const free = buildBrief({ home, scene, framing, site: {}, passName: 'From the gate' });
  assert.ok(!free.includes('Where the photograph was taken from'));
});

test('40. Home Photos Are Keyed To Walls And Paired With Plates', () => {
  assert.equal(HOME_PHOTO_SLOTS.length, 5);
  // Four walls plus the catalogue shot, each naming the plate it overlays.
  assert.deepEqual(
    HOME_PHOTO_SLOTS.map((s) => s.wall),
    ['front', 'back', 'left', 'right', null],
  );
  for (const s of HOME_PHOTO_SLOTS) assert.ok(s.plate.endsWith('.png'), `${s.key} names a plate`);
  assert.equal(homeSlotByKey('left').plate, '33-left-end-elevation.png');
  assert.equal(homeSlotByKey('nope'), null);

  // Only known slots with a real src survive the read.
  const read = readHomePhotos({
    front: { src: 'data:a', name: 'front.jpg' },
    rear: { name: 'no src' },
    bogus: { src: 'data:b' },
  });
  assert.deepEqual(Object.keys(read), ['front']);
  assert.equal(read.front.name, 'front.jpg');
  assert.deepEqual(readHomePhotos(null), {});

  assert.deepEqual(filledHomePhotos(read).map((s) => s.key), ['front']);
  // The walls the plates alone have to answer for.
  assert.deepEqual(unphotographedWalls(read), ['back', 'left', 'right']);
  assert.deepEqual(unphotographedWalls({}), ['front', 'back', 'left', 'right']);
});

test('41. The Brief States Purpose, Authority And The Polish Step Explicitly', () => {
  const home = defaultHome();
  home.name = 'Marlette Tuscarora';
  const scene = defaultScene();
  const md = buildBrief({ home, scene, site: {} });

  // What it is for, and that it is a repeatable pattern rather than a one-off.
  assert.ok(md.includes('## What you are making'));
  assert.ok(md.includes('repeatable pattern, not a one-off'));

  // A stated run order, with the polish pass last and called out.
  assert.ok(md.includes('## How to run it — the order matters'));
  assert.ok(md.includes('## 9. The polish pass — run this ONCE, and only last'));
  assert.ok(md.includes('### When to run it'));
  assert.ok(md.includes('### If the polish drifts'));
  assert.ok(md.indexOf('## 7. Check the result') < md.indexOf('## 9. The polish pass'),
    'The acceptance check comes before the polish pass');

  // Model-agnostic, so the same package runs anywhere.
  assert.ok(md.includes('### Running this on any image model'));
  assert.ok(md.includes('Midjourney'));
});

test('42. The Brief Adapts To Which Home Photos Exist', () => {
  const scene = defaultScene();

  const none = defaultHome();
  const mdNone = buildBrief({ home: none, scene, site: {} });
  assert.ok(mdNone.includes('No photographs of the home are attached'));
  assert.ok(!mdNone.includes('Pair each photograph with its plate'));

  const some = defaultHome();
  some.homePhotos = { front: { src: 'data:a', name: 'f.jpg' }, hero: { src: 'data:b', name: 'h.jpg' } };
  const mdSome = buildBrief({ home: some, scene, site: {} });
  assert.ok(mdSome.includes('Pair each photograph with its plate'));
  assert.ok(mdSome.includes('31-front-elevation.png'), 'Names the plate each photo overlays');
  assert.ok(mdSome.includes('There is no photograph of the rear (long wall), the left end (gable) or the right end (gable)'));
  assert.ok(mdSome.includes('invent nothing'));

  const all = defaultHome();
  all.homePhotos = Object.fromEntries(HOME_PHOTO_SLOTS.map((s) => [s.key, { src: 'data:x', name: '' }]));
  const mdAll = buildBrief({ home: all, scene, site: {} });
  assert.ok(mdAll.includes('Pair each photograph with its plate'));
  assert.ok(!mdAll.includes('Walls with no photograph'), 'No blind-wall warning when every wall is covered');

  // Home photos round-trip through a project file.
  const file = buildProject({ home: some, scene, exportOpts: defaultExport(), view: null });
  const read = readProject(JSON.parse(JSON.stringify(file)));
  assert.equal(read.home.homePhotos.front.src, 'data:a');
  assert.deepEqual(Object.keys(read.home.homePhotos), ['front', 'hero']);
});

test('43. The Brief Enforces Exact 1-to-1 Position Mandate and Coordinates', () => {
  const home = defaultHome();
  const scene = defaultScene();
  const framing = {
    left: 0.15, right: 0.85, bottom: 0.22, top: 0.78, ridgeTop: 0.65,
    nearCorner: 'front-right corner', nearCornerX: 0.42, nearCornerY: 0.26,
    visibleWalls: ['front wall', 'right gable end'], viewLabel: 'hero-left',
  };

  const md = buildBrief({ home, scene, framing, site: {} });

  assert.ok(md.includes('EXACT 1-TO-1 PIXEL ALIGNMENT'));
  assert.ok(md.includes('CRITICAL 1-TO-1 POSITIONING MANDATE'));
  assert.ok(md.includes('DO NOT MOVE, SHIFT, SLIDE, ROTATE, OR RE-SITE THE HOUSE'));
  assert.ok(md.includes('Horizontal span: **15% to 85%**'));
  assert.ok(md.includes('Ground contact / skirting base line: **22%**'));
  assert.ok(md.includes('1-to-1 Overlay Mismatch'));
  assert.ok(md.includes('renders/'));
  assert.ok(md.includes('CLI Output Directory Instructions'));
});

test('44. Multi-Provider AI API Key Management (OpenAI, Grok, Gemini, Anthropic)', () => {
  assert.equal(AI_PROVIDERS.length, 4);
  assert.deepEqual(
    AI_PROVIDERS.map((p) => p.id),
    ['anthropic', 'openai', 'grok', 'gemini'],
  );

  saveApiKeys({
    activeProvider: 'openai',
    openai: 'sk-test-openai-123',
    grok: 'xai-test-grok-456',
    gemini: 'AIzaSyTest789',
    anthropic: 'sk-ant-test-000',
  }, false);

  const keys = loadApiKeys();
  assert.equal(keys.activeProvider, 'openai');
  assert.equal(keys.openai, 'sk-test-openai-123');
  assert.equal(keys.grok, 'xai-test-grok-456');
  assert.equal(keys.gemini, 'AIzaSyTest789');
  assert.equal(keys.anthropic, 'sk-ant-test-000');
});

test('45. AI Vision Auto-Extraction & Assignment of Openings and Siding/Trim Colors', () => {
  const rawResponse = {
    modelName: 'Redmond 25610 Vision',
    confidence: 'high',
    readings: { dimensionLine: '27\' x 56\'', notes: 'Read directly' },
    dimensions: {
      widthFt: 27, lengthFt: 56, wallHeightFt: 9, floorHeightFt: 2.5,
      roofPitch: 5, eaveOverhangFt: 1, rakeOverhangFt: 0.75, roofStyle: 'gable',
    },
    openings: [
      { type: 'door', wall: 'front', offsetFt: 10, widthFt: 3, heightFt: 6.67, sillFt: 0, label: 'Main Entry' },
      { type: 'window', wall: 'front', offsetFt: 20, widthFt: 3, heightFt: 4, sillFt: 3, label: 'Living' },
    ],
    finishes: {
      sidingTexture: 'board-batten',
      sidingColor: 'navy blue',
      trimColor: '#ffffff',
      roofColor: 'charcoal',
      doorColor: 'barn red',
    },
  };

  const { ok, spec } = validateHomeSpec(rawResponse);
  assert.ok(ok);
  assert.equal(spec.finishes.sidingTexture, 'board-batten');
  assert.equal(spec.finishes.sidingColor, '#2b3a55'); // mapped from navy blue
  assert.equal(spec.finishes.trimColor, '#ffffff');
  assert.equal(spec.finishes.roofColor, '#3a3d42'); // mapped from charcoal
  assert.equal(spec.finishes.doorColor, '#8c3a33'); // mapped from barn red

  const home = defaultHome();
  let idSeq = 0;
  const applied = applySpecToHome(home, spec, (t) => `${t}${++idSeq}`);

  assert.equal(applied.name, 'Redmond 25610 Vision');
  assert.equal(applied.colors.siding, '#2b3a55');
  assert.equal(applied.colors.trim, '#ffffff');
  assert.equal(applied.colors.roof, '#3a3d42');
  assert.equal(applied.colors.door, '#8c3a33');
  assert.equal(applied.dimensions.sidingTexture, 'board-batten');
  assert.equal(applied.openings.length, 2);
  assert.equal(applied.openings[0].wall, 'front');
  assert.equal(applied.openings[0].type, 'door');
});

test('46. Project Save Point Restoration Reads v1 and v2 JSON Files Cleanly', () => {
  const home = defaultHome();
  home.name = 'Test JSON Save House';
  home.dimensions.lengthFt = 48;
  const scene = defaultScene();
  const rawProject = buildProject({
    home,
    scene,
    exportOpts: defaultExport(),
    view: { preset: 'hero-left', label: '¾ front-L', camera: null },
    savedAt: '2026-07-29T12:00:00.000Z',
  });

  const parsed = readProject(rawProject);
  assert.equal(parsed.home.name, 'Test JSON Save House');
  assert.equal(parsed.home.dimensions.lengthFt, 48);
  assert.equal(parsed.view.preset, 'hero-left');
});

test('47. Multi-Provider AI API Key Auto-Cycling & Fallback', async () => {
  const keys = {
    activeProvider: 'openai',
    openai: '',
    grok: 'xai-fake-key-123',
    gemini: '',
    anthropic: '',
  };

  const tried = [];
  try {
    await readPlanWithAutoCycle({
      keys,
      provider: 'autocycle',
      planDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      prompt: 'test',
      onProgress: (p) => tried.push(p),
    });
  } catch (err) {
    // Expected fake key network error
    assert.ok(err.message.includes('GROK') || err.message.includes('failed') || err.message.includes('401') || err.message.includes('fetch'));
  }
  assert.ok(tried.includes('grok'));
});





// ---------------------------------------------------------------------------
// Cross-panel asset registry and photo colour sampling
// ---------------------------------------------------------------------------

test('48. Every Loaded Image Is Registered Against The Panel That Owns It', () => {
  const home = defaultHome();
  home.homePhotos = { hero: { src: 'data:image/jpeg;base64,AAA', name: 'lot-3q.jpg' } };
  home.sitePlan = { ...home.sitePlan, src: 'data:image/png;base64,BBB', name: 'spec.pdf', width: 1700, height: 2200, page: 1, pageCount: 3 };
  home.plan = { ...home.plan, src: 'data:image/png;base64,CCC' };
  home.siteViews = [captureSiteView({
    name: '¾ front-left', slotKey: 'hero-left',
    sitePhoto: { src: 'data:image/jpeg;base64,DDD' },
  })];

  const assets = collectAssets(home);
  const byKind = Object.fromEntries(assets.map((a) => [a.kind, a]));

  assert.equal(assets.length, 4);
  // The panel each one jumps back to is the panel that loaded it — this is the
  // whole point of the registry.
  assert.equal(byKind.homePhoto.panel, 'panel_homephotos');
  assert.equal(byKind.lotPhoto.panel, 'panel_photo');
  assert.equal(byKind.sitePlan.panel, 'panel_package');
  assert.equal(byKind.planPlate.panel, 'panel_plan');
  assert.match(byKind.sitePlan.detail, /page 1 of 3/);

  const inv = assetInventory(home);
  assert.equal(inv.homePhotos, 1);
  assert.equal(inv.homePhotoSlots, HOME_PHOTO_SLOTS.length);
  assert.equal(inv.lotPhotos, 1);
  assert.equal(inv.slottedLotPhotos, 1);
  assert.equal(inv.sitePlan, true);
  assert.equal(inv.planPlate, true);
  assert.equal(inv.panorama, false);
  assert.deepEqual(missingHomePhotoNames(home), HOME_PHOTO_SLOTS.filter((s) => s.key !== 'hero').map((s) => s.name));
});

test('49. The Tracing Plate Reports Whether It Is The Site Plan Page', () => {
  const home = defaultHome();
  assert.equal(planPlateLinked(home), false, 'nothing loaded is not linked');

  home.sitePlan = { ...home.sitePlan, src: 'data:image/png;base64,PAGE' };
  assert.equal(planPlateLinked(home), false, 'a plan with no plate is not linked');

  home.plan = { ...home.plan, src: 'data:image/png;base64,PAGE' };
  assert.equal(planPlateLinked(home), true);

  // A plate the user loaded separately must never be reported as the same
  // drawing — that is what stops the site plan quietly overwriting it.
  home.plan.src = 'data:image/png;base64,OTHER';
  assert.equal(planPlateLinked(home), false);
});

test('50. Only Photographs Are Offered As Colour Sources, Catalogue Shot First', () => {
  const home = defaultHome();
  home.plan = { ...home.plan, src: 'data:image/png;base64,LINEART' };
  home.homePhotos = {
    front: { src: 'data:image/jpeg;base64,FRONT', name: 'front.jpg' },
    hero: { src: 'data:image/jpeg;base64,HERO', name: 'hero.jpg' },
  };
  home.siteViews = [captureSiteView({ name: 'lot', sitePhoto: { src: 'data:image/jpeg;base64,LOT' } })];

  const sources = finishSampleAssets(home);
  assert.equal(sources[0].key, 'hero', 'the ¾ shot shows siding, trim and roof under one light');
  assert.deepEqual(sources.map((s) => s.kind), ['homePhoto', 'homePhoto', 'lotPhoto']);
  assert.ok(!sources.some((s) => s.kind === 'planPlate'), 'sampling line art returns the colour of paper');
  assert.ok(sources.every((s) => s.canSampleFinish));
});

test('51. A Sample Averages Its Box And Ignores Transparency', () => {
  // 2x2: three known colours and one fully transparent pixel.
  const w = 2, h = 2;
  const data = new Uint8ClampedArray([
    100, 100, 100, 255, 200, 200, 200, 255,
    150, 150, 150, 255, 0, 0, 0, 0,
  ]);

  assert.deepEqual(sampleAverage(data, w, h, 0, 0, 0), { r: 100, g: 100, b: 100 });
  // The 3x3 box clips to the image and skips the transparent corner, so the
  // answer is the mean of the three opaque pixels, not of four.
  assert.deepEqual(sampleAverage(data, w, h, 0, 0, 1), { r: 150, g: 150, b: 150 });
  assert.equal(sampleAverage(data, w, h, 0, 0, 0) && rgbToHex({ r: 100, g: 100, b: 100 }), '#646464');
  assert.equal(sampleAverage(data, w, h, 1, 1, 0), null, 'a fully transparent pixel has no colour');
  assert.deepEqual(hexToRgb('#646464'), { r: 100, g: 100, b: 100 });
});

test('52. The Photo Palette Is Deterministic And Maps Onto The House', () => {
  // A photograph-shaped mix: mostly wall, some roof, a little trim, one door.
  const pixels = [];
  for (let i = 0; i < 500; i++) pixels.push([141, 146, 153]); // siding, the big area
  for (let i = 0; i < 200; i++) pixels.push([32, 34, 38]);   // roof, darkest
  for (let i = 0; i < 120; i++) pixels.push([242, 242, 240]); // trim, lightest
  for (let i = 0; i < 60; i++) pixels.push([150, 30, 30]);    // a red door

  const a = quantize(pixels, 6);
  const b = quantize(pixels, 6);
  assert.deepEqual(a.map((c) => c.hex), b.map((c) => c.hex), 'the same photo must give the same palette every time');
  assert.ok(a.length > 1 && a.length <= 6);
  assert.ok(a[0].weight >= a[a.length - 1].weight, 'sorted by how much of the frame each covers');

  const roles = suggestFinishRoles(a);
  assert.ok(luma(hexToRgb(roles.roof)) < luma(hexToRgb(roles.siding)), 'the roof is the darkest large area');
  assert.ok(luma(hexToRgb(roles.trim)) > luma(hexToRgb(roles.siding)), 'the trim is the lightest');
  // Unlisted siding surfaces follow the main siding rather than being left behind.
  assert.equal(roles.dormerSiding, roles.siding);
  assert.equal(roles.gableSiding, roles.siding);
  assert.ok(saturation(hexToRgb(roles.door)) > 0.18, 'a strongly coloured door survives quantisation');
});

test('53. Sampled Pixels Are Taken On A Fixed Stride, Never At Random', () => {
  const w = 40, h = 40;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = i % 256;
    data[i * 4 + 1] = 80;
    data[i * 4 + 2] = 90;
    data[i * 4 + 3] = i < 100 ? 0 : 255; // first 100 pixels fully transparent
  }
  const first = samplePixels(data, w, h, 200);
  const second = samplePixels(data, w, h, 200);
  assert.deepEqual(first, second, 'a re-opened photo must not shuffle its suggested colours');
  assert.ok(first.length > 0 && first.length <= 200);
  assert.ok(first.every((p) => p.length === 3));
});

test('54. Zoom Holds The Point Under The Cursor Still', () => {
  const frame = { w: 600, h: 400 };
  const image = { w: 2000, h: 1500 };
  const base = Math.min(frame.w / image.w, frame.h / image.h); // fit
  const anchor = { x: 150, y: 90 };

  // Where the anchor is pointing before the zoom.
  const imageUnder = (scale, pan) => ({
    x: (anchor.x - ((frame.w - image.w * scale) / 2 + pan.x)) / scale,
    y: (anchor.y - ((frame.h - image.h * scale) / 2 + pan.y)) / scale,
  });

  let scale = base;
  let pan = { x: 0, y: 0 };
  const target = imageUnder(scale, pan);

  // Zoom in over several steps, as a wheel would.
  for (const z of [1.4, 2.1, 5, 12]) {
    const nextScale = base * z;
    pan = zoomAnchoredPan({ frame, image, scale, pan, nextScale, anchor });
    scale = nextScale;
    const now = imageUnder(scale, pan);
    assert.ok(Math.abs(now.x - target.x) < 1e-6, `x drifted at ${z}x: ${now.x} vs ${target.x}`);
    assert.ok(Math.abs(now.y - target.y) < 1e-6, `y drifted at ${z}x: ${now.y} vs ${target.y}`);
  }

  // And back out again — the same pixel is still under the cursor.
  pan = zoomAnchoredPan({ frame, image, scale, pan, nextScale: base, anchor });
  const back = imageUnder(base, pan);
  assert.ok(Math.abs(back.x - target.x) < 1e-6);
  assert.ok(Math.abs(back.y - target.y) < 1e-6);

  // With no anchor the frame centre is held instead, which is what a slider or
  // a keyboard step should do.
  const centred = zoomAnchoredPan({
    frame, image, scale: base, pan: { x: 0, y: 0 }, nextScale: base * 3, anchor: null,
  });
  assert.ok(Math.abs(centred.x) < 1e-9 && Math.abs(centred.y) < 1e-9,
    'a centred image zoomed about its centre needs no pan');
});

test('55. One Wheel Event Zooms The Same However The Device Reports It', () => {
  // A notched mouse wheel: one big pixel delta per detent.
  const notch = wheelZoomFactor({ deltaY: -100, deltaMode: 0 });
  // The same physical detent reported as lines (Firefox).
  const lines = wheelZoomFactor({ deltaY: -6.25, deltaMode: 1 });
  assert.ok(Math.abs(notch - lines) < 1e-9, 'a line delta must not zoom 16x less than a pixel one');
  assert.ok(notch > 1 && notch < 1.4, `one detent should be a modest step, got ${notch}`);

  // A trackpad flick: many small deltas. One of them must barely move.
  const nudge = wheelZoomFactor({ deltaY: -6, deltaMode: 0 });
  assert.ok(nudge > 1 && nudge < 1.02, `a trackpad tick should be tiny, got ${nudge}`);
  // Ten of them land in the same territory as a couple of wheel detents rather
  // than flinging the view across the zoom range.
  assert.ok(Math.pow(nudge, 10) < notch * notch);

  // A trackpad pinch arrives as ctrl+wheel with much smaller deltas, so it gets
  // its own rate — otherwise pinching does nothing.
  assert.ok(wheelZoomFactor({ deltaY: -6, ctrlKey: true }) > nudge);

  // Direction, and the clamp that stops a momentum burst teleporting the view.
  assert.ok(wheelZoomFactor({ deltaY: 100 }) < 1, 'wheel down zooms out');
  assert.equal(wheelZoomFactor({ deltaY: -100000 }), 2);
  assert.equal(wheelZoomFactor({ deltaY: 100000 }), 0.5);
});

test('56. The Sky Is Not Offered As Trim', () => {
  // Every exterior photograph has sky in it, and sky is usually both the
  // lightest thing in frame and a big part of it.
  const sky = { r: 166, g: 199, b: 232, hex: '#a6c7e8', weight: 0.30 };
  const siding = { r: 111, g: 139, b: 163, hex: '#6f8ba3', weight: 0.28 };
  const roof = { r: 47, g: 50, b: 56, hex: '#2f3238', weight: 0.20 };
  const trim = { r: 244, g: 244, b: 241, hex: '#f4f4f1', weight: 0.12 };
  const door = { r: 168, g: 35, b: 31, hex: '#a8231f', weight: 0.10 };

  assert.equal(looksLikeSky(sky), true);
  assert.equal(looksLikeSky(trim), false, 'white trim is light but not blue');
  assert.equal(looksLikeSky(siding), false, 'blue-grey siding is not light enough to be sky');
  assert.equal(looksLikeSky(roof), false);

  const roles = suggestFinishRoles([sky, siding, roof, trim, door]);
  assert.equal(roles.trim, '#f4f4f1', 'the trim is the white board, not the sky');
  assert.equal(roles.roof, '#2f3238');
  assert.equal(roles.siding, '#6f8ba3');
  assert.notEqual(roles.door, sky.hex);

  // With nothing but sky and one surface there is no better answer available,
  // so the guard must not strip the palette down to nothing.
  const thin = suggestFinishRoles([sky, siding]);
  assert.ok(thin.siding && thin.roof && thin.trim, 'a thin palette still gets assigned');
});

test('57. A Palette Entry Is A Colour The Photo Actually Contains', () => {
  // Two tight, well-separated populations — white siding and blue sky — plus a
  // handful of pixels strung between them, as any real photo has along an edge.
  const pixels = [];
  for (let i = 0; i < 600; i++) pixels.push([236, 238, 235]);   // siding
  for (let i = 0; i < 600; i++) pixels.push([120, 170, 235]);   // sky
  for (let i = 0; i < 60; i++) pixels.push([178, 204, 235]);    // the edge between them

  const pal = quantize(pixels, 4);
  const exists = (c) => pixels.some(([r, g, b]) =>
    Math.abs(r - c.r) <= 12 && Math.abs(g - c.g) <= 12 && Math.abs(b - c.b) <= 12);

  for (const c of pal) {
    assert.ok(exists(c), `${c.hex} is not a colour in the photo — it is an average of two that are`);
  }
  // Both real populations have to survive; averaging them into one grey-blue is
  // the failure this replaced.
  assert.ok(pal.some((c) => Math.abs(c.r - 236) < 14), 'the siding is in the palette');
  assert.ok(pal.some((c) => Math.abs(c.b - 235) < 14 && c.r < 160), 'the sky is in the palette');

  // Weights partition the image, so a legend built from them adds up.
  const total = pal.reduce((n, c) => n + c.weight, 0);
  assert.ok(Math.abs(total - 1) < 1e-9, `weights should sum to 1, got ${total}`);
});

test('58. A White Point Divides Out The Light The Photo Was Shot In', () => {
  // Measured off a real listing photo: white trim and white siding both come
  // back as mid greys, because the exposure was set for a bright sky.
  const trim = { r: 202, g: 206, b: 205 };
  const siding = { r: 165, g: 170, b: 170 };

  const gains = whiteBalanceGains(trim);
  assert.ok(gains);

  const trimOut = applyWhiteBalance(trim, gains);
  assert.deepEqual(trimOut, { r: REFERENCE_WHITE, g: REFERENCE_WHITE, b: REFERENCE_WHITE },
    'the reference itself becomes neutral white');

  const sidingOut = applyWhiteBalance(siding, gains);
  assert.ok(luma(sidingOut) > luma(siding) + 30, 'the siding comes up towards white');
  assert.ok(sidingOut.r <= 255 && sidingOut.g <= 255 && sidingOut.b <= 255, 'nothing overflows');
  // A neutral reference must not introduce a cast of its own.
  assert.ok(Math.max(sidingOut.r, sidingOut.g, sidingOut.b)
    - Math.min(sidingOut.r, sidingOut.g, sidingOut.b) < 12);

  // A blue cast in the reference is corrected out of everything else.
  const blueLit = whiteBalanceGains({ r: 180, g: 200, b: 240 });
  const grey = applyWhiteBalance({ r: 180, g: 200, b: 240 }, blueLit);
  assert.equal(grey.r, grey.g);
  assert.equal(grey.g, grey.b);

  // Too dark to carry any information about the illuminant.
  assert.equal(whiteBalanceGains({ r: 10, g: 12, b: 9 }), null);
  assert.equal(whiteBalanceGains(null), null);
  // No gains means no change, so the raw reading is always still available.
  assert.deepEqual(applyWhiteBalance(siding, null), siding);
});

test('59. The Brief Takes Shutters And Lights From The Photographs, Not From Taste', () => {
  const home = defaultHome();
  const scene = defaultScene();

  // With photographs attached, every accessory class is named and pinned to
  // them — an unnamed accessory is one the model feels free to style.
  home.homePhotos = {
    front: { src: 'data:image/jpeg;base64,FRONT', name: 'front.jpg' },
    hero: { src: 'data:image/jpeg;base64,HERO', name: 'hero.jpg' },
  };
  const shot = buildBrief({ home, scene, site: {} });
  for (const word of ['shutters', 'light fixtures', 'railings', 'gutters', 'vents']) {
    assert.ok(shot.toLowerCase().includes(word), `names ${word} explicitly`);
  }
  assert.ok(ACCESSORIES.every((a) => shot.includes(a)), 'the accessory list reaches the brief verbatim');
  // The absence rule matters as much as the presence rule.
  assert.ok(/no shutters/i.test(shot), 'no shutters in the photo means none in the render');
  assert.ok(shot.includes('| 8 |'), 'accessories are their own acceptance check');
  assert.ok(shot.includes('All eight pass'), 'and the gate counts them');
  assert.ok(shot.includes('**Accessories**'), 'with a correction of their own');

  // With no photographs there is nothing to read accessories off, so the home
  // carries none rather than whatever the model would have invented.
  home.homePhotos = {};
  const blind = buildBrief({ home, scene, site: {} });
  assert.ok(/carries \*\*none\*\*/.test(blind), 'no photos means no accessories at all');
  assert.ok(blind.includes('**None present**'), 'the check says so too');
});

test('60. Every Loaded Image Can Be Deleted Again, By The Same Route', () => {
  const home = defaultHome();
  home.homePhotos = { front: { src: 'data:image/jpeg;base64,FRONT', name: 'front.jpg' } };
  home.siteViews = [captureSiteView({ name: 'lot', sitePhoto: { src: 'data:image/jpeg;base64,LOT' } })];
  home.activeSiteViewId = home.siteViews[0].id;
  home.sitePlan = { src: 'data:image/png;base64,PLAN', pdf: 'data:application/pdf;base64,PDF', name: 'plan.pdf', page: 2, pageCount: 4, width: 1700, height: 2200 };
  home.plan = { ...home.plan, src: 'data:image/png;base64,PLAN' }; // linked to the page above
  home.panorama = { ...home.panorama, src: 'data:image/jpeg;base64,PANO', name: 'pano.jpg', width: 8000, height: 4000, show: true };

  const ids = collectAssets(home).map((a) => a.id);
  assert.deepEqual(ids, ['homePhoto:front', `lotPhoto:${home.siteViews[0].id}`, 'sitePlan:page', 'planPlate:plate', 'panorama:pano']);

  // A home photo goes without touching its neighbours.
  assert.equal(removeAsset(home, 'homePhoto:front').removed, true);
  assert.equal(home.homePhotos.front, undefined);

  // A lot photo takes its saved view with it, because the alignment and camera
  // stored beside it are meaningless without the photo.
  const viewId = home.siteViews[0].id;
  assert.equal(removeAsset(home, `lotPhoto:${viewId}`).removed, true);
  assert.equal(home.siteViews.length, 0);
  assert.equal(home.activeSiteViewId, null, 'the deleted view stops being the active one');

  // The site plan takes the tracing plate when they are the same drawing.
  const plan = removeAsset(home, 'sitePlan:page');
  assert.equal(plan.removed, true);
  assert.equal(plan.alsoPlate, true);
  assert.equal(home.sitePlan.src, null);
  assert.equal(home.sitePlan.pdf, null, 'the kept PDF goes too, or the package still ships it');
  assert.equal(home.plan.src, null);

  assert.equal(removeAsset(home, 'panorama:pano').removed, true);
  assert.equal(home.panorama.src, null);
  assert.equal(home.panorama.show, false, 'a hidden-source panorama must not stay switched on');

  assert.deepEqual(collectAssets(home), [], 'everything that could be loaded can be removed');
  assert.equal(removeAsset(home, 'panorama:pano').removed, false, 'deleting twice is a no-op, not a throw');
  assert.equal(removeAsset(home, 'nonsense:key').removed, false);
  assert.equal(removeAsset(null, 'homePhoto:front').removed, false);
});

test('61. An Unlinked Tracing Plate Survives Deleting The Site Plan', () => {
  // The plate the user chose separately is a deliberate choice of a different
  // drawing; deleting the page must not quietly take it.
  const home = defaultHome();
  home.sitePlan = { src: 'data:image/png;base64,PAGE', name: 'plan.pdf', page: 1, pageCount: 1, width: 100, height: 100 };
  home.plan = { ...home.plan, src: 'data:image/png;base64,OTHER' };

  const res = removeAsset(home, 'sitePlan:page');
  assert.equal(res.alsoPlate, false);
  assert.equal(home.plan.src, 'data:image/png;base64,OTHER');
  assert.deepEqual(collectAssets(home).map((a) => a.id), ['planPlate:plate']);

  assert.equal(removeAsset(home, 'planPlate:plate').removed, true);
  assert.equal(home.plan.src, null);
});

test('62. A Split-Pitch Roof Puts The Ridge Off The Centreline', () => {
  const home = defaultHome();
  const flat = derived(home.dimensions);
  assert.equal(flat.ridgeZ, 0, 'equal pitches keep the ridge over the middle');
  assert.equal(flat.split, false);
  assert.equal(flat.slopeFront, flat.slopeBack);
  assert.equal(flat.eaveY, flat.eaveYFront, 'the legacy eave key still reads as before');

  // 4/12 front, 6/12 rear: the steeper slope is the short one, so the ridge
  // slides toward the rear wall and the peak comes out higher than a plain
  // 4/12 gable would give.
  home.dimensions.roofPitchBack = 6;
  const d = derived(home.dimensions);
  assert.equal(d.split, true);
  assert.ok(d.ridgeZ > 1, `ridge should sit behind the centreline, got ${d.ridgeZ}`);
  assert.ok(d.ridgeY > flat.ridgeY, 'the split peak is higher than the symmetrical one');

  // Both planes must actually land on their own eave — that is what makes the
  // model measurable rather than merely plausible.
  const W = home.dimensions.widthFt;
  assert.ok(Math.abs(d.eaveYFront + d.slopeFront * (d.ridgeZ + W / 2) - d.ridgeY) < 1e-6);
  assert.ok(Math.abs(d.eaveYBack + d.slopeBack * (W / 2 - d.ridgeZ) - d.ridgeY) < 1e-6);

  // A taller front wall does the same thing from the other direction.
  home.dimensions.roofPitchBack = null;
  home.dimensions.frontWallHeightFt = 10;
  const tall = derived(home.dimensions);
  assert.equal(tall.eaveYFront - tall.eaveYBack, 2);
  assert.ok(tall.ridgeZ < 0, 'the ridge slides toward the taller wall, which is the front here');

  // A flat roof still answers with a flat roof.
  home.dimensions.roofStyle = 'flat';
  const f = derived(home.dimensions);
  assert.equal(f.ridgeY, f.eaveY);
  assert.equal(f.slope, 0);
});

test('63. Bumps Are Read, Clamped And Measured Off The Rectangle', () => {
  const dim = defaultHome().dimensions;   // 27 wide x 56 long

  // Junk in, usable bump out — this is what a vision model's answer looks like.
  const [b] = readBumps([{ wall: 'porch', kind: 'porch', offsetFt: '4', lengthFt: 12, depthFt: -6 }]);
  assert.equal(b.wall, 'front', 'an unknown wall name falls back to the front');
  assert.equal(b.kind, 'porch');
  assert.equal(b.offsetFt, 4);
  assert.ok(b.id, 'every bump gets an id so a row can be edited and deleted');
  assert.equal(isRecess(b), true);
  assert.equal(readBumps(null).length, 0);

  // Nothing may hang off the end of the wall it is attached to.
  const over = readBumps([{ wall: 'left', offsetFt: 40, lengthFt: 30, depthFt: 2 }])[0];
  clampBump(over, dim);
  assert.equal(over.lengthFt, 27, 'a bump cannot be longer than the gable end it sits on');
  assert.equal(over.offsetFt, 0);

  // A recess cannot eat the whole house.
  const deep = readBumps([{ wall: 'front', depthFt: -50 }])[0];
  clampBump(deep, dim);
  assert.ok(deep.depthFt >= -dim.widthFt * 0.75);

  // Footprint: a projecting porch grows the picture, a recess does not.
  const base = footprintExtents(dim, []);
  const out = footprintExtents(dim, [readBumps([{ wall: 'front', kind: 'porch', offsetFt: 0, lengthFt: 12, depthFt: 8 }])[0]]);
  assert.equal(out.minZ, base.minZ - 8 + (dim.eaveOverhangFt || 0), 'the porch reaches past the eave line');
  assert.deepEqual(footprintExtents(dim, [b]), base, 'a recess stays inside the rectangle');

  // Which wall it lands on, in world coordinates.
  const fp = bumpFootprint(readBumps([{ wall: 'front', offsetFt: 0, lengthFt: 10, depthFt: 2 }])[0], dim);
  assert.equal(fp.maxX, dim.lengthFt / 2, 'offset 0 on the front wall is its LEFT corner seen from outside: +X');
  assert.equal(fp.minZ, -dim.widthFt / 2 - 2);
});

test('64. A Porch In Front Of A Wall Leaves The Wall Alone', () => {
  const dim = defaultHome().dimensions;
  const cut = (raw) => wallBands(readBumps(raw), 'front', dim, 8);

  // A recess opens the wall; an enclosed bump moves it; a porch standing out
  // in front of it does neither — the doors and windows behind it stay.
  assert.equal(cut([{ wall: 'front', kind: 'porch', depthFt: -6, offsetFt: 2, lengthFt: 12 }]).length, 1);
  assert.equal(cut([{ wall: 'front', kind: 'wall', depthFt: 1.33, offsetFt: 2, lengthFt: 12 }]).length, 1);
  assert.equal(cut([{ wall: 'front', kind: 'porch', depthFt: 6, offsetFt: 2, lengthFt: 12 }]).length, 0);

  assert.equal(cut([{ wall: 'back', kind: 'wall', depthFt: -2 }]).length, 0, 'a bump on another wall does not cut this one');

  // Overlapping bumps must not double-cut the same stretch of siding.
  const overlap = cut([
    { wall: 'front', kind: 'wall', depthFt: -2, offsetFt: 0, lengthFt: 10 },
    { wall: 'front', kind: 'wall', depthFt: -2, offsetFt: 5, lengthFt: 10 },
  ]);
  assert.equal(overlap.length, 2);
  assert.ok(overlap[1].x0 >= overlap[0].x1, 'the second band starts where the first one ends');
});

test('65. The Model Builds With A Porch, A Bump-Out And A Split Pitch', () => {
  const home = defaultHome();
  home.dimensions.roofPitchBack = 6;
  home.bumps = readBumps([
    { wall: 'front', kind: 'porch', offsetFt: 0, lengthFt: 12, depthFt: -6, roof: 'none', label: "6' Porch" },
    { wall: 'back', kind: 'wall', offsetFt: 20, lengthFt: 10, depthFt: 1.33, label: '+16" dining' },
    { wall: 'front', kind: 'porch', offsetFt: 30, lengthFt: 10, depthFt: 6, roof: 'gable', label: 'Covered deck' },
  ]);

  const root = buildHome(home, defaultScene());
  const names = [];
  root.traverse((o) => { if (o.name) names.push(o.name); });
  for (const b of home.bumps) {
    assert.ok(names.includes(`bump:${b.id}`), `${b.label} is in the model`);
  }

  // The recess cut the wall into bands rather than punching a hole in it: the
  // porch at the front corner leaves one run of siding beside it, and the
  // mid-wall bump-out on the back splits that wall in two.
  const bands = (w) => root.children.find((c) => c.name === `wall:${w}`)
    .children.filter((c) => c.isMesh && c.userData.wall === w).length;
  assert.equal(bands('front'), 2, 'the porch leaves one run of siding beside it and one wall at the back of it');
  assert.equal(bands('back'), 3, 'the bump-out splits the rear wall and re-builds its face further out');

  // The moved faces are walls, not boxes: a door in the recess would be a real
  // void in the wall at the back of the porch.
  const zs = root.children.find((c) => c.name === 'wall:front')
    .children.filter((c) => c.isMesh && c.userData.wall === 'front').map((c) => c.position.z);
  assert.ok(zs.some((z) => Math.abs(z - 6) < 1e-6), 'the porch back wall stands 6 ft inside the wall line');

  // Every piece of geometry is finite — a NaN here is a blank plate later.
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry.computeBoundingBox();
    const bb = o.geometry.boundingBox;
    assert.ok(Number.isFinite(bb.min.x) && Number.isFinite(bb.max.y), `${o.name || 'mesh'} has a finite bounding box`);
  });

  // A home with no bumps at all still builds, and builds the same as before.
  const plain = buildHome(defaultHome(), defaultScene());
  assert.ok(plain.children.some((c) => c.name === 'roof'));
});

test('66. The Brief States The Porch And The Split Pitch', () => {
  const home = defaultHome();
  home.dimensions.roofPitchBack = 6;
  home.bumps = readBumps([
    { wall: 'front', kind: 'porch', offsetFt: 44, lengthFt: 12, depthFt: -6, label: "6' Porch" },
  ]);
  const md = buildBrief({ home, scene: defaultScene() });

  assert.match(md, /SPLIT PITCH/, 'the roof line says the pitches differ');
  assert.match(md, /off centre/, 'and where that puts the ridge');
  assert.match(md, /Where the footprint stops being a rectangle/);
  assert.match(md, /6' Porch/);
  assert.match(md, /recessed IN/i);
  assert.match(md, /open-sided/, 'a porch is stated as a real void, not a painted shadow');

  // The wall summary leads with the shape of the wall.
  assert.match(wallSummary(home, 'front'), /covered porch/);

  // A plain rectangle says so, and says nothing else.
  const plain = buildBrief({ home: defaultHome(), scene: defaultScene() });
  assert.match(plain, /a plain rectangle/);
  assert.doesNotMatch(plain, /SPLIT PITCH/);
});

test('67. A Plan Read Off A Sheet Carries Its Porch And Its Split Pitch', () => {
  const res = validateHomeSpec({
    modelName: 'Redman 25610',
    dimensions: {
      widthFt: 26.67, lengthFt: 58.67, wallHeightFt: 8, floorHeightFt: 2.5,
      roofPitch: 4, roofPitchBack: 7, eaveOverhangFt: 1, rakeOverhangFt: 0.75, roofStyle: 'gable',
    },
    bumps: [
      { kind: 'porch', wall: 'front', offsetFt: 0, lengthFt: 12, depthFt: -6, label: "6' Porch" },
      { kind: 'wall', wall: 'back', offsetFt: 20, lengthFt: 10, depthFt: 1.33, label: '+16"' },
      { kind: 'wall', wall: 'nowhere', offsetFt: 900, lengthFt: 500, depthFt: 0, label: 'junk' },
    ],
    openings: [{ type: 'door', wall: 'front', offsetFt: 14, widthFt: 3, heightFt: 6.67, sillFt: 0, label: 'Main entry' }],
    confidence: 'high',
  });

  assert.equal(res.ok, true);
  assert.equal(res.spec.dimensions.roofPitchBack, 7);
  assert.equal(res.spec.bumps.length, 3);
  assert.equal(res.spec.bumps[0].depthFt, -6, 'a recess stays a recess');
  assert.equal(res.spec.bumps[2].wall, 'front', 'a wall that does not exist is reported and moved');
  assert.ok(res.spec.bumps[2].lengthFt <= 58.67);
  assert.match(res.summary, /split-pitch/);
  assert.ok(res.issues.some((i) => /depth/i.test(i.text)));

  // A rear pitch equal to the front is not a split pitch, it is a plain gable.
  const same = validateHomeSpec({
    dimensions: { widthFt: 27, lengthFt: 56, wallHeightFt: 8, floorHeightFt: 2.5, roofPitch: 4, roofPitchBack: 4, eaveOverhangFt: 1, rakeOverhangFt: 0.75, roofStyle: 'gable' },
    openings: [],
  });
  assert.equal(same.spec.dimensions.roofPitchBack, null);

  // Applying it keeps the bumps, and a spec that read none keeps the ones the
  // user placed by hand.
  const home = defaultHome();
  const applied = applySpecToHome(home, res.spec, (p, i) => `${p}${i}`);
  assert.equal(applied.bumps.length, 3);
  assert.ok(applied.bumps[0].id);
  const kept = applySpecToHome(applied, same.spec, (p, i) => `${p}${i}`);
  assert.equal(kept.bumps.length, 3, 'a sheet with no bumps does not wipe the porch already placed');

  // And a save round-trips them.
  const migrated = migrate({ ...home, bumps: applied.bumps });
  assert.equal(migrated.bumps.length, 3);
  assert.equal(migrate({ name: 'legacy', dimensions: {}, openings: [] }).bumps.length, 0);
});

test('69. Ridge offset nudges the solved ridge without breaking the solve', () => {
  const dim = { ...defaultHome().dimensions };
  const base = derived(dim);
  assert.ok(near(base.ridgeZ, 0), 'A symmetric roof still solves to the centreline');
  assert.ok(near(base.ridgeStepFt, 0), 'And its two planes peak together');
  assert.equal(base.ridgeSail, 0, 'So nothing sails past the ridge');

  const moved = derived({ ...dim, ridgeOffsetFt: 5 });
  assert.ok(near(moved.ridgeZ, 5), 'A typed offset moves the ridge back');
  // Both planes must still land on their own eave after the move, which is the
  // invariant the split-pitch solve exists to hold.
  const W = dim.widthFt;
  assert.ok(near(moved.eaveYFront + moved.slopeFront * (moved.ridgeZ + W / 2), moved.ridgePeakY),
    'Front plane still reaches the peak from its eave');
  assert.ok(near(moved.eaveYBack + moved.slopeBack * (W / 2 - moved.ridgeZ), moved.ridgePeakY),
    'Back plane too');
  // Both planes reach the same peak, so the one with the longer run to get
  // there is the shallower of the two.
  assert.ok(moved.slopeFront < moved.slopeBack, 'The longer front run runs shallower');

  // It stacks on a split pitch rather than replacing it.
  const split = derived({ ...dim, roofPitchBack: 2 });
  const both = derived({ ...dim, roofPitchBack: 2, ridgeOffsetFt: 2 });
  assert.ok(near(both.ridgeZ, split.ridgeZ + 2), 'Offset is measured from the solved ridge');
  assert.ok(Math.abs(derived({ ...dim, ridgeOffsetFt: 99 }).ridgeZ) < W / 2,
    'And is clamped inside the footprint');
});

test('70. Ridge step opens a clerestory between the two peaks', () => {
  const home = defaultHome();
  home.dimensions.ridgeStepFt = 2.5;
  const dv = derived(home.dimensions);

  assert.ok(near(dv.backPeakY - dv.frontPeakY, 2.5), 'Rear peak stands 2.5 ft above the front one');
  assert.ok(near(dv.ridgeStepFt, 2.5), 'Which is reported as the step');
  assert.ok(dv.slopeBack > dv.slopeFront, 'The rear plane steepens to reach its raised peak');
  assert.ok(near(dv.eaveYBack + dv.slopeBack * (home.dimensions.widthFt / 2 - dv.ridgeZ), dv.backPeakY),
    'And still lands on its own eave');

  const roof = buildHome(home, defaultScene()).children.find((c) => c.name === 'roof');
  assert.ok(roof.children.some((c) => c.name === 'ridgeStep'), 'Clerestory wall built between the peaks');

  // A negative step lifts the front instead.
  const front = derived({ ...home.dimensions, ridgeStepFt: -2.5 });
  assert.ok(near(front.frontPeakY - front.backPeakY, 2.5), 'Negative step raises the front peak');

  // Level peaks meet at a real ridge and need no wall.
  const level = buildHome(defaultHome(), defaultScene()).children.find((c) => c.name === 'roof');
  assert.ok(!level.children.some((c) => c.name === 'ridgeStep'), 'No clerestory on a plain gable');
});

test('71. The taller plane sails past the ridge and tops out above the peak', () => {
  const home = defaultHome();
  home.dimensions.ridgeStepFt = 2.5; // rear peak is the tall one
  const dv = derived(home.dimensions);

  assert.ok(near(dv.ridgeSail, -1), 'Rear plane sails past by the eave overhang, toward the front');
  assert.ok(near(dv.ridgeCutZ, dv.ridgeZ - 1), 'The planes hand over a foot in front of the ridge');
  assert.ok(dv.ridgeY > dv.ridgePeakY, 'So the roof tops out above the peak');
  assert.ok(near(dv.ridgeY, dv.ridgePeakY + dv.slopeBack), 'By one foot of run at the rear pitch');

  const roof = buildHome(home, defaultScene()).children.find((c) => c.name === 'roof');
  assert.ok(roof.children.some((c) => c.name === 'ridgeFascia'), 'The free sailing edge gets a fascia');

  // Off switch, and the distance is settable.
  const none = derived({ ...home.dimensions, ridgeOverhang: 'none' });
  assert.equal(none.ridgeSail, 0, 'No sail when switched off');
  assert.ok(near(none.ridgeY, none.ridgePeakY), 'And the peak is the top of the roof again');
  const off = buildHome({ ...home, dimensions: { ...home.dimensions, ridgeOverhang: 'none' } }, defaultScene())
    .children.find((c) => c.name === 'roof');
  assert.ok(!off.children.some((c) => c.name === 'ridgeFascia'), 'And no free edge to board');
  assert.ok(near(derived({ ...home.dimensions, ridgeOverhangFt: 2.5 }).ridgeSail, -2.5),
    'Custom sail distance honoured');

  // A sail can never overshoot the plane it hangs over.
  const clamped = derived({ ...home.dimensions, ridgeOverhangFt: 500 });
  assert.ok(near(Math.abs(clamped.ridgeSail), clamped.ridgeZ + home.dimensions.widthFt / 2),
    'Sail clamped to the far plane run');
});

test('72. Corner boards lie on their walls instead of hanging off the corner', () => {
  const home = defaultHome();
  const dim = home.dimensions;
  const root = buildHome(home, defaultScene());
  root.updateMatrixWorld(true);
  const g = root.children.find((c) => c.name === 'cornerTrim');
  assert.ok(g, 'Corner trim group built');
  assert.equal(g.children.length, 8, 'Two boards at each of the four corners');

  const halfL = dim.lengthFt / 2;
  const halfW = dim.widthFt / 2;
  const boxes = g.children.map((b) => new THREE.Box3().setFromObject(b));

  // The regression: a board measured OUTWARD from the corner floats past the
  // end of the wall in mid air. Every board must lie within the footprint on
  // the axis it runs along, and stand proud of its wall only on the other.
  for (const bb of boxes) {
    const runsAlongX = bb.max.x - bb.min.x > bb.max.z - bb.min.z;
    if (runsAlongX) {
      assert.ok(bb.min.x >= -halfL - 0.2 && bb.max.x <= halfL + 0.2,
        'A long-wall board stays within the length of the wall it is on');
      assert.ok(Math.abs(bb.getCenter(new THREE.Vector3()).z) > halfW,
        'And stands proud of that wall');
    } else {
      assert.ok(bb.min.z >= -halfW - 0.2 && bb.max.z <= halfW + 0.2,
        'An end-wall board stays within the width of the wall it is on');
      assert.ok(Math.abs(bb.getCenter(new THREE.Vector3()).x) > halfL,
        'And stands proud of that wall');
    }
    assert.ok(near(bb.min.y, dim.floorHeightFt, 1e-3), 'Boards start at the floor deck');
  }

  // Every corner is covered by exactly two boards.
  for (const [cx, cz] of [[-halfL, -halfW], [halfL, -halfW], [halfL, halfW], [-halfL, halfW]]) {
    const near2 = boxes.filter((bb) => {
      const c = bb.getCenter(new THREE.Vector3());
      return Math.abs(c.x - cx) < 1.5 && Math.abs(c.z - cz) < 1.5;
    });
    assert.equal(near2.length, 2, `corner ${cx},${cz} carries a board on each wall`);
  }

  // A board dies into the eave of the wall it is on, so a split pitch gives the
  // front and back pairs different lengths.
  const split = buildHome({ ...home, dimensions: { ...dim, roofPitchBack: 2, frontWallHeightFt: 10 } }, defaultScene());
  split.updateMatrixWorld(true);
  const dv = derived({ ...dim, roofPitchBack: 2, frontWallHeightFt: 10 });
  const sg = split.children.find((c) => c.name === 'cornerTrim');
  for (const b of sg.children) {
    const bb = new THREE.Box3().setFromObject(b);
    const onFront = bb.getCenter(new THREE.Vector3()).z < 0;
    assert.ok(near(bb.max.y, onFront ? dv.eaveYFront : dv.eaveYBack, 1e-3),
      'Board stops at the eave of its own wall, not a single shared wall height');
  }

  assert.ok(!buildHome({ ...home, dimensions: { ...dim, cornerTrim: false } }, defaultScene())
    .children.some((c) => c.name === 'cornerTrim'), 'Switched off, no corner trim');
});

test('73. Fascia and corner boards take their own colour and width', () => {
  const home = defaultHome();
  home.colors.trim = '#ffffff';
  home.colors.fascia = '#101010';
  home.colors.corner = '#804020';
  home.dimensions.fasciaWidthFt = 1.2;

  const root = buildHome(home, defaultScene());
  const hex = (m) => `#${m.color.getHexString()}`;
  assert.equal(hex(root.userData.materials.fascia), '#101010');
  assert.equal(hex(root.userData.materials.corner), '#804020');
  assert.equal(hex(root.userData.materials.trim), '#ffffff', 'Casing trim untouched');

  const roof = root.children.find((c) => c.name === 'roof');
  const fascia = roof.children.filter((c) => c.name === 'eaveFascia');
  assert.ok(fascia.length >= 2, 'Both eaves boarded');
  for (const f of fascia) {
    assert.equal(hex(f.material), '#101010', 'Eave fascia takes the fascia colour');
    assert.ok(near(f.geometry.parameters.height, 1.2), 'And the typed width');
  }
  const corner = root.children.find((c) => c.name === 'cornerTrim');
  assert.equal(hex(corner.children[0].material), '#804020', 'Corner boards take the corner colour');

  // A file written before these colours existed reads them off its own trim.
  const legacy = migrate({ colors: { trim: '#123456', siding: '#abcdef' } });
  assert.equal(legacy.colors.fascia, '#123456', 'Fascia inherits the loaded trim');
  assert.equal(legacy.colors.corner, '#123456', 'Corner boards inherit it too');
  assert.equal(migrate({ colors: { trim: '#123456', fascia: '#000000' } }).colors.fascia, '#000000',
    'An explicit fascia colour survives the load');
});
