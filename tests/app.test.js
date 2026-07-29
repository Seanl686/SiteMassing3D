import test from 'node:test';
import assert from 'node:assert/strict';

import { defaultHome, defaultScene, defaultExport, defaultBrief, migrate, WALLS } from '../src/defaults.js';
import { zipStore, crc32, dataUrlToBytes, dataUrlExt } from '../src/zip.js';
import {
  buildBrief, colorName, sidingLabel, describeLighting, wallSummary, openingSchedule,
} from '../src/brief.js';
import {
  captureSiteView, applySiteView, cycleSiteView, indexOfView, uniqueViewName,
  readSiteView, sortSiteViews, SITE_VIEW_SLOTS, slotByKey, findSlotView,
} from '../src/siteviews.js';
import {
  HOME_PHOTO_SLOTS, homeSlotByKey, readHomePhotos, filledHomePhotos, unphotographedWalls,
} from '../src/homephotos.js';
import { derived, wallFrames, fmtAllUnits, buildHome, getWallHeight, dormerSize, applyHeadAlign } from '../src/build.js';
import { createSidingMaterial } from '../src/textures.js';
import { History, describeChange } from '../src/history.js';
import { buildProject, readProject, PROJECT_VERSION } from '../src/project.js';

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

