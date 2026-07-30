# Wireframe contrast and a bounded ground plane

## What changed
- `wireframeStroke()` (src/scene.js) now returns vivid magenta (`0xff0090`) on light backdrops and vivid cyan (`0x00e5ff`) on dark ones, replacing the old near-neutral dark/light gray pair. Picked for maximum hue separation from anything a house or lot photo actually contains, so edges stay unambiguous for both human eyes and vision-model reads.
- Ground plane + grid are no longer a fixed 2000ft/400ft slab. `Stage.rebuildGround(extentFt)` rebuilds both from a new scene option `groundExtentFt` (default 150ft), plus a bright amber (`0xffb400`) `LineLoop` boundary ring at the extent edge so the cutoff itself is visible, not just present.
- New scene field `groundExtentFt` in `defaultScene()` (src/defaults.js), wired through `sceneNums` in main.js and a `#s_groundExtent` number input in index.html next to the Ground grid checkbox.

## Why it mattered
User wanted the wireframe view to read clearly to an LLM doing vision analysis on renders — the old stroke colors were tonal (dark-on-light / light-on-dark) which blends into grayscale-ish siding and roof tones. They also didn't want the ground grid implying an unbounded lot; a plane/grid sized to a real number the user can set (and see the edge of) reads as a measured site instead of scenery fading to infinity.

## Gotchas / pitfalls
- `THREE.GridHelper`'s geometry is baked in at construction — there's no resize, only dispose + recreate. `rebuildGround()` tears down grid, ground-plane geometry, and the boundary ring together and only fires when `groundExtentFt` actually changes (compared against `this.groundExtentFt`), so normal per-frame `applySceneOpts` calls don't thrash geometry.
- Ground baseline (`setGroundBaseline`, used when the model's floor sits above/below grade) has to reposition all three of ground/grid/boundary ring — easy to add a fourth ground-related object later and forget one of these two touch points (`rebuildGround` and `setGroundBaseline`).
- Divisions scale with extent (`extentFt / 5`, min 4) so grid squares stay roughly constant size regardless of how far the user dials the extent out.

## Verification
`npm test` — all 59 existing tests pass unchanged (none pinned the old stroke hexes or fixed ground/grid dimensions).
