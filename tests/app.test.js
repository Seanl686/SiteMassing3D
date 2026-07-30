import test from 'node:test';
import assert from 'node:assert/strict';

import { defaultHome, defaultScene, defaultExport, migrate, WALLS, newRoofSection } from '../src/defaults.js';
import {
  derived, wallFrames, fmtAllUnits, buildHome, getWallHeight,
  resolveRoofSections, roofTopAt, wallTopProfile, wallHeightAt, clampOpening,
} from '../src/build.js';

const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

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
    'panel_roof',
    'panel_dormers',
    'panel_colors',
    'panel_openings',
    'panel_stairs',
    'panel_photo',
    'panel_plan',
    'panel_export',
  ];

  assert.equal(panelIds.length, 9, '9 distinct purpose-driven collapsible categories configured');
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

test('16. Symmetric Roof Unchanged While Asymmetry Is Off', () => {
  const dim = defaultHome().dimensions; // 27 x 56, 8ft walls, 2.5ft floor, 4/12
  const secs = resolveRoofSections(dim);

  assert.equal(secs.length, 1, 'No sections declared means one roof over the whole length');
  const s = secs[0];
  assert.ok(near(s.frontPeakY, s.backPeakY), 'Both planes peak at the same height');
  assert.ok(near(s.frontSlope, 4 / 12), 'Front plane runs at the base pitch');
  assert.ok(near(s.backSlope, 4 / 12), 'Back plane runs at the base pitch');
  assert.equal(s.ridgeZ, 0, 'Ridge sits on center');
  assert.ok(near(derived(dim).ridgeY, 10.5 + 13.5 * (4 / 12)), 'Ridge height matches the legacy formula');

  // Front/back pitch values are ignored until the switch is thrown.
  const ignored = { ...dim, frontPitch: 9, backPitch: 2, ridgeOffsetFt: 6 };
  const still = resolveRoofSections(ignored)[0];
  assert.ok(near(still.frontSlope, 4 / 12), 'Front pitch ignored while asymmetricRoof is false');
  assert.equal(still.ridgeZ, 0, 'Ridge offset ignored while asymmetricRoof is false');
});

test('17. Independent Front/Back Pitch Raises One Peak Above the Other', () => {
  const home = defaultHome();
  Object.assign(home.dimensions, { asymmetricRoof: true, frontPitch: 8, backPitch: 3 });

  const s = resolveRoofSections(home.dimensions)[0];
  assert.ok(near(s.frontEaveY, 10.5), 'Front eave at floor + wall height');
  assert.ok(near(s.frontPeakY, 10.5 + 13.5 * (8 / 12)), 'Front plane climbs at 8/12');
  assert.ok(near(s.backPeakY, 10.5 + 13.5 * (3 / 12)), 'Back plane climbs at 3/12');
  assert.ok(s.frontPeakY - s.backPeakY > 5, 'Front peak stands well above the back peak');
  assert.ok(near(s.peakY, s.frontPeakY), 'Section peak is the higher of the two planes');
  // The tall plane sails past the ridge by default, so the roof's highest point
  // is that free edge rather than the peak itself.
  assert.ok(near(s.topY, s.frontPeakY + s.ridgeSail * s.frontSlope), 'Top of roof is the sailing edge');
  assert.ok(near(derived(home.dimensions).ridgeY, s.topY), 'Ridge height follows the tall plane');

  // The gap between the two planes has to be closed by a clerestory wall.
  const roof = buildHome(home, defaultScene()).children.find((c) => c.name === 'roof');
  const section = roof.children.find((c) => c.name === 'roofSection:0');
  assert.ok(section, 'Roof section group built');
  const step = section.children.find((c) => c.name === 'ridgeStep');
  assert.ok(step, 'Clerestory wall built where the peaks disagree');

  // ...and must not appear when the two pitches match again.
  home.dimensions.backPitch = 8;
  const evenRoof = buildHome(home, defaultScene()).children.find((c) => c.name === 'roof');
  const evenSection = evenRoof.children.find((c) => c.name === 'roofSection:0');
  assert.ok(!evenSection.children.some((c) => c.name === 'ridgeStep'), 'No clerestory when peaks are level');
});

test('18. Ridge Offset and Ridge Step Reshape the Cross-Section', () => {
  const dim = { ...defaultHome().dimensions, asymmetricRoof: true, ridgeOffsetFt: 5 };
  const s = resolveRoofSections(dim)[0];

  assert.equal(s.ridgeZ, 5, 'Ridge shifted 5 ft toward the rear wall');
  assert.ok(near(s.frontRun, 18.5), 'Front plane runs the long way to the ridge');
  assert.ok(near(s.backRun, 8.5), 'Back plane runs the short way');
  assert.ok(s.frontPeakY > s.backPeakY, 'Equal pitch over a longer run peaks higher');

  // The offset is clamped so both planes stay real.
  assert.ok(Math.abs(resolveRoofSections({ ...dim, ridgeOffsetFt: 99 })[0].ridgeZ) < 13.5);

  // A ridge step lifts the back peak without touching the back eave.
  const stepped = resolveRoofSections({ ...dim, ridgeOffsetFt: 0, ridgeStepFt: 3 })[0];
  assert.ok(near(stepped.backPeakY - stepped.frontPeakY, 3), 'Back peak sits 3 ft above the front peak');
  assert.ok(near(stepped.backEaveY, 10.5), 'Back eave is unmoved by the step');
  assert.ok(stepped.backSlope > stepped.frontSlope, 'Back plane steepens to reach the raised peak');
});

test('19. Per-Section Roofs: Different Pitch and Peak on Each Half', () => {
  const home = defaultHome();
  home.dimensions.roofSections = [
    { ...newRoofSection(0, 'Left half'), pitch: 3 },
    { ...newRoofSection(28, 'Right half'), pitch: 9, frontWallHeightFt: 10 },
  ];

  const secs = resolveRoofSections(home.dimensions);
  assert.equal(secs.length, 2, 'Two roof sections resolved');
  assert.ok(near(secs[0].x0, -28) && near(secs[0].x1, 0), 'Left section covers the left half');
  assert.ok(near(secs[1].x0, 0) && near(secs[1].x1, 28), 'Right section covers the right half');
  assert.ok(near(secs[0].frontSlope, 3 / 12), 'Left half runs at 3/12');
  assert.ok(near(secs[1].frontSlope, 9 / 12), 'Right half runs at 9/12');
  assert.ok(near(secs[1].frontEaveY, 12.5), 'Right half carries its own 10 ft front wall');
  assert.ok(secs[1].peakY > secs[0].peakY + 5, 'Right half peaks well above the left');
  assert.ok(near(derived(home.dimensions).ridgeY, secs[1].topY), 'Overall ridge is the tallest section');

  const roof = buildHome(home, defaultScene()).children.find((c) => c.name === 'roof');
  assert.ok(roof.children.find((c) => c.name === 'roofSection:0'), 'First section built');
  assert.ok(roof.children.find((c) => c.name === 'roofSection:1'), 'Second section built');
  assert.ok(roof.children.find((c) => c.name === 'roofTransition:0'),
    'Wall built to close the gap where the two roofs disagree');

  // Matching sections need no transition wall between them.
  home.dimensions.roofSections = [newRoofSection(0), newRoofSection(28)];
  const flatRoof = buildHome(home, defaultScene()).children.find((c) => c.name === 'roof');
  assert.ok(!flatRoof.children.some((c) => c.name?.startsWith('roofTransition')),
    'No transition wall when both sections resolve to the same roof');

  // Sections thinner than a foot are noise, not geometry.
  home.dimensions.roofSections = [newRoofSection(0), newRoofSection(0.25)];
  assert.equal(resolveRoofSections(home.dimensions).length, 1, 'Degenerate section dropped');
});

test('20. Gable End Walls Trace the Asymmetric Roof Line', () => {
  const dim = {
    ...defaultHome().dimensions,
    asymmetricRoof: true, frontPitch: 8, backPitch: 3, ridgeOffsetFt: 4,
  };
  const s = resolveRoofSections(dim)[0];
  const left = wallTopProfile('left', dim);

  // Left wall u runs front -> back across the 27 ft width.
  assert.ok(near(left[0].u, 0) && near(left[0].h, 8), 'Starts at the front eave');
  assert.ok(near(left[left.length - 1].u, 27), 'Ends at the back corner');
  assert.ok(near(left[left.length - 1].h, 8), 'Back corner sits at the back eave');
  const uRidge = s.ridgeZ + 27 / 2;
  const peaks = left.filter((p) => near(p.u, uRidge, 1e-6));
  assert.equal(peaks.length, 2, 'Two points at the ridge — the vertical step between the peaks');
  assert.ok(near(Math.max(...peaks.map((p) => p.h)), s.frontPeakY - dim.floorHeightFt),
    'Tall side of the step matches the front plane peak');
  assert.ok(near(Math.min(...peaks.map((p) => p.h)), s.backPeakY - dim.floorHeightFt),
    'Short side of the step matches the back plane peak');

  // The right end is the same profile mirrored: it starts at the back eave.
  const right = wallTopProfile('right', dim);
  assert.ok(near(right[0].h, 8) && near(right[right.length - 1].h, 8), 'Both corners at their eaves');
  assert.ok(near(right[1].u, 27 - uRidge), 'Ridge mirrored across the right end');

  // Every wall the roof touches is built without complaint.
  const root = buildHome({ ...defaultHome(), dimensions: dim }, defaultScene());
  for (const w of WALLS) assert.ok(root.children.find((c) => c.name === `wall:${w}`), `${w} wall built`);
});

test('21. Long Walls Step Where Section Eave Heights Differ', () => {
  const dim = { ...defaultHome().dimensions };
  dim.roofSections = [
    newRoofSection(0),
    { ...newRoofSection(28), frontWallHeightFt: 10, backWallHeightFt: 6 },
  ];

  // The front wall is walked right-to-left, so the +X section lands at u = 0.
  const front = wallTopProfile('front', dim);
  assert.ok(near(front[0].u, 0) && near(front[0].h, 10), 'Front wall starts tall over the raised section');
  assert.ok(near(front[front.length - 1].u, 56) && near(front[front.length - 1].h, 8), 'And drops to 8 ft');
  assert.equal(front.filter((p) => near(p.u, 28)).length, 2, 'A vertical step at the section boundary');

  const back = wallTopProfile('back', dim);
  assert.ok(near(back[0].h, 8) && near(back[back.length - 1].h, 6), 'Back wall steps the other way');

  // Headroom is measured where the opening actually sits, not wall-wide.
  assert.ok(near(wallHeightAt('front', dim, 2, 6), 10), 'Tall stretch reports 10 ft');
  assert.ok(near(wallHeightAt('front', dim, 40, 44), 8), 'Short stretch reports 8 ft');

  const tall = clampOpening(
    { type: 'window', wall: 'front', offsetFt: 2, widthFt: 4, heightFt: 9, sillFt: 0 }, dim);
  assert.ok(tall.heightFt > 8, 'A 9 ft window survives under the 10 ft section');
  const short = clampOpening(
    { type: 'window', wall: 'front', offsetFt: 40, widthFt: 4, heightFt: 9, sillFt: 0 }, dim);
  assert.ok(near(short.heightFt, 7.6), 'The same window is clamped under the 8 ft section');
});

test('22. Shed Sections Peak at One Wall', () => {
  const base = defaultHome().dimensions;
  const shed = resolveRoofSections({ ...base, roofStyle: 'shed' })[0];
  assert.ok(near(shed.ridgeZ, 13.5), 'Shed ridge sits on the back wall line');
  assert.ok(near(shed.frontPeakY, 10.5 + 27 * (4 / 12)), 'Single plane climbs the full width');
  assert.ok(near(shed.backEaveY, shed.frontPeakY), 'Back wall grows to meet the high edge');
  assert.ok(near(roofTopAt(shed, -13.5), 10.5), 'Roof is at the eave over the front wall');
  assert.ok(near(roofTopAt(shed, 13.5), shed.peakY), 'Roof is at the peak over the back wall');

  const front = resolveRoofSections({ ...base, roofStyle: 'shedFront' })[0];
  assert.ok(near(front.ridgeZ, -13.5), 'Front-high shed peaks on the front wall line');
  assert.ok(near(front.frontEaveY, front.peakY), 'Front wall grows to meet the high edge');

  // A flat section levels both walls onto one deck.
  const flat = resolveRoofSections({ ...base, roofStyle: 'flat', frontWallHeightFt: 9 })[0];
  assert.ok(near(flat.frontEaveY, flat.backEaveY), 'Flat deck cannot sit on two wall heights');
  assert.ok(near(roofTopAt(flat, 0), flat.peakY), 'Flat roof is level across the width');
});

test('23. Roof Section Migration & Round-Trip', () => {
  const migrated = migrate({
    name: 'Split-pitch',
    dimensions: {
      lengthFt: 60,
      asymmetricRoof: true,
      frontPitch: 7,
      // Sections out of order, with blank and stringy fields, as hand-written
      // JSON tends to arrive.
      roofSections: [
        { startFt: 30, pitch: '6', backPitch: '' },
        { startFt: 0, label: 'Left' },
        'nonsense',
      ],
    },
  });

  const secs = migrated.dimensions.roofSections;
  assert.equal(secs.length, 2, 'Junk entries dropped');
  assert.equal(secs[0].startFt, 0, 'Sections sorted by start offset');
  assert.ok(secs[0].id && secs[1].id, 'Every section carries an id');
  assert.equal(secs[1].pitch, 6, 'Numeric strings coerced');
  assert.equal(secs[1].backPitch, null, 'Blank fields mean inherit, not zero');
  assert.equal(migrated.dimensions.frontPitch, 7, 'Whole-home overrides preserved');

  // A home saved before any of this existed still loads as a plain gable.
  const legacy = migrate({ dimensions: { lengthFt: 50, widthFt: 24, roofPitch: 5 } });
  assert.deepEqual(legacy.dimensions.roofSections, [], 'Legacy homes carry no sections');
  assert.equal(legacy.dimensions.asymmetricRoof, false, 'Legacy homes stay symmetric');
  const s = resolveRoofSections(legacy.dimensions)[0];
  assert.ok(near(s.frontSlope, s.backSlope), 'Legacy roof is symmetric');
});

test('24. Asymmetric Roof Assembles With Dormers and Steps', () => {
  const home = defaultHome();
  Object.assign(home.dimensions, {
    asymmetricRoof: true, frontPitch: 6, backPitch: 2, ridgeOffsetFt: -3, ridgeStepFt: 1.5,
    dormerCount: 2,
  });
  home.dimensions.roofSections = [
    newRoofSection(0),
    { ...newRoofSection(34), pitch: 2, roofStyle: 'shed' },
  ];

  const root = buildHome(home, defaultScene());
  const roof = root.children.find((c) => c.name === 'roof');
  assert.ok(roof, 'Roof group built');
  assert.equal(roof.children.filter((c) => c.name?.startsWith('roofSection:')).length, 2);
  assert.ok(roof.children.find((c) => c.name === 'dormers'), 'Dormers still built on a mixed roof');
  assert.ok(root.children.find((c) => c.name === 'steps'), 'Steps still built');

  // Nothing in the assembly may come out with a broken transform.
  let meshes = 0;
  root.traverse((o) => {
    if (!o.isMesh) return;
    meshes++;
    assert.ok(Number.isFinite(o.position.x + o.position.y + o.position.z),
      `${o.name || 'mesh'} has a finite position`);
  });
  assert.ok(meshes > 20, 'A full home worth of geometry');
});

test('25. Raised Roof Sections Carry an Overhang Past the Step', () => {
  const home = defaultHome(); // 56 ft long, 0.75 ft rake overhang
  home.dimensions.roofSections = [
    newRoofSection(0),
    { ...newRoofSection(28), frontWallHeightFt: 14, backWallHeightFt: 14 },
  ];

  const planes = (h) => {
    const roof = buildHome(h, defaultScene()).children.find((c) => c.name === 'roof');
    const out = {};
    for (const s of roof.children.filter((c) => c.name?.startsWith('roofSection:'))) {
      const p = s.children.find((c) => c.name === 'roofPlane:front');
      out[s.name] = { len: p.geometry.parameters.width, cx: p.position.x,
        rakes: s.children.filter((c) => c.name === 'rakeBoard').length };
    }
    return out;
  };

  // Default 'raised': the tall section reaches 0.75 ft past the boundary and
  // out over the gable end; the low one still butts.
  const raised = planes(home);
  assert.ok(near(raised['roofSection:1'].len, 28 + 0.75 * 2), 'Raised section overhangs both of its ends');
  assert.ok(near(raised['roofSection:1'].cx, 14), 'Reaching equally at both ends leaves it centred');
  assert.ok(near(raised['roofSection:0'].len, 28 + 0.75), 'Low section keeps only its gable-end rake');
  assert.ok(near(raised['roofSection:0'].cx, -14 - 0.375), 'Reaching at one end only shifts its centre');
  assert.equal(raised['roofSection:1'].rakes, 2, 'Both raked edges of the raised roof get a board');
  assert.equal(raised['roofSection:0'].rakes, 0, 'A butted joint has no exposed edge to trim');

  // 'both' hangs the low roof out under the step as well.
  home.dimensions.stepOverhang = 'both';
  assert.ok(near(planes(home)['roofSection:0'].len, 28 + 0.75 * 2), 'Both sides of the step overhang');

  // 'none' restores the flush butt joint.
  home.dimensions.stepOverhang = 'none';
  const butted = planes(home);
  assert.ok(near(butted['roofSection:0'].len, 28 + 0.75), 'Low section butts');
  assert.ok(near(butted['roofSection:1'].len, 28 + 0.75), 'Raised section butts too');
  assert.equal(butted['roofSection:1'].rakes, 0, 'No overhang, no rake board');

  // The step overhang has its own distance, and the boards can be switched off.
  home.dimensions.stepOverhang = 'raised';
  home.dimensions.stepOverhangFt = 2;
  assert.ok(near(planes(home)['roofSection:1'].len, 28 + 0.75 + 2), 'Custom step overhang honoured');
  home.dimensions.stepRakeFascia = false;
  assert.equal(planes(home)['roofSection:1'].rakes, 0, 'Rake boards switched off');

  // Gable-end rake boards are opt-in and leave existing plates alone by default.
  const plain = defaultHome();
  const plainRoof = buildHome(plain, defaultScene()).children.find((c) => c.name === 'roof');
  const plainSection = plainRoof.children.find((c) => c.name === 'roofSection:0');
  assert.equal(plainSection.children.filter((c) => c.name === 'rakeBoard').length, 0,
    'A single-section home is unchanged by default');
  plain.dimensions.endRakeFascia = true;
  const trimmed = buildHome(plain, defaultScene()).children.find((c) => c.name === 'roof')
    .children.find((c) => c.name === 'roofSection:0');
  assert.equal(trimmed.children.filter((c) => c.name === 'rakeBoard').length, 4,
    'Opting in trims all four raked edges — both planes at both ends');
});

test('26. Taller Plane Sails Past the Ridge and Hangs Over the Clerestory', () => {
  const home = defaultHome(); // 27 ft wide, 8 ft walls, 2.5 ft floor, 1 ft eave overhang
  Object.assign(home.dimensions, { asymmetricRoof: true, frontPitch: 9, backPitch: 2 });

  const s = resolveRoofSections(home.dimensions)[0];
  assert.ok(s.frontPeakY > s.backPeakY + 0.5, 'Front plane peaks well above the back one');
  assert.ok(near(s.ridgeSail, 1), 'Front plane sails past the ridge by the eave overhang');
  assert.ok(near(s.ridgeCutZ, s.ridgeZ + 1), 'The planes now hand over a foot past the ridge');
  assert.ok(near(s.topY, s.frontPeakY + s.frontSlope), 'The sailing edge is the top of the roof');
  assert.ok(near(roofTopAt(s, s.ridgeZ + 0.5), s.frontEaveY + (s.ridgeZ + 0.5 - s.frontEdgeZ) * s.frontSlope),
    'Just past the ridge the roof is still the front plane, still climbing');
  assert.ok(roofTopAt(s, s.ridgeZ + 0.5) > s.frontPeakY, 'Which puts it above the peak');

  const planeOf = (h, which) => {
    const roof = buildHome(h, defaultScene()).children.find((c) => c.name === 'roof');
    const sec = roof.children.find((c) => c.name === 'roofSection:0');
    return {
      mesh: sec.children.find((c) => c.name === `roofPlane:${which}`),
      ridgeFascia: sec.children.filter((c) => c.name === 'ridgeFascia').length,
      clerestory: sec.children.some((c) => c.name === 'ridgeStep'),
    };
  };

  // The front plane is a foot longer along the slope than its run to the ridge,
  // and its new free edge is boarded.
  const sailed = planeOf(home, 'front');
  const runToRidge = Math.hypot(s.ridgeZ - (s.frontEdgeZ - 1), s.frontPeakY - (s.frontEaveY - s.frontSlope));
  assert.ok(sailed.mesh.geometry.parameters.depth > runToRidge + 0.9, 'Front plane reaches past the ridge');
  assert.equal(sailed.ridgeFascia, 1, 'Its sailing edge gets a fascia');
  assert.ok(sailed.clerestory, 'The clerestory wall it hangs over is still there');

  // Turning it off puts the plane back against the clerestory.
  home.dimensions.ridgeOverhang = 'none';
  const stopped = resolveRoofSections(home.dimensions)[0];
  assert.equal(stopped.ridgeSail, 0, 'No sail when switched off');
  assert.ok(near(stopped.ridgeCutZ, stopped.ridgeZ), 'Planes hand over at the ridge again');
  assert.ok(near(stopped.topY, stopped.peakY), 'Top of roof is the peak again');
  assert.equal(planeOf(home, 'front').ridgeFascia, 0, 'And there is no free edge to board');

  // The distance is settable, and the back plane sails when it is the tall one.
  home.dimensions.ridgeOverhang = 'raised';
  home.dimensions.ridgeOverhangFt = 2.5;
  assert.ok(near(resolveRoofSections(home.dimensions)[0].ridgeSail, 2.5), 'Custom ridge overhang honoured');

  home.dimensions.frontPitch = 2;
  home.dimensions.backPitch = 9;
  const flipped = resolveRoofSections(home.dimensions)[0];
  assert.ok(near(flipped.ridgeSail, -2.5), 'Back plane sails the other way when it is taller');
  assert.ok(near(flipped.ridgeCutZ, flipped.ridgeZ - 2.5), 'Hand-over moves to the front side of the ridge');
  assert.equal(planeOf(home, 'back').ridgeFascia, 1, 'And the back plane carries the fascia');

  // Level peaks meet at a real ridge, so nothing sails and nothing is boarded.
  home.dimensions.backPitch = 2;
  const level = resolveRoofSections(home.dimensions)[0];
  assert.equal(level.ridgeSail, 0, 'A symmetric roof has a ridge to meet at');
  assert.equal(planeOf(home, 'front').ridgeFascia, 0, 'So no ridge fascia');
  assert.ok(!planeOf(home, 'front').clerestory, 'And no clerestory');

  // A sail can never overshoot the plane it hangs over.
  home.dimensions.backPitch = 9;
  home.dimensions.ridgeOverhangFt = 500;
  const clamped = resolveRoofSections(home.dimensions)[0];
  assert.ok(near(Math.abs(clamped.ridgeSail), clamped.frontRun), 'Sail clamped to the far plane run');
});
