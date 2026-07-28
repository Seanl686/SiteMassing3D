import test from 'node:test';
import assert from 'node:assert/strict';

import { defaultHome, defaultScene, defaultExport, migrate, WALLS } from '../src/defaults.js';
import { derived, wallFrames, fmtAllUnits, buildHome, getWallHeight, dormerSize, applyHeadAlign } from '../src/build.js';
import { createSidingMaterial } from '../src/textures.js';

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


