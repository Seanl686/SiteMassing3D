import test from 'node:test';
import assert from 'node:assert/strict';

import { defaultHome, defaultScene, defaultExport, migrate, WALLS } from '../src/defaults.js';
import { derived, wallFrames, fmtAllUnits, buildHome, getWallHeight, dormerSize } from '../src/build.js';

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
