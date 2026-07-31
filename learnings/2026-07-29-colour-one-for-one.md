# Making a picked colour actually be the colour

## What changed

Three defects between "the pixel in the photograph" and "the wall in the
render", found by measuring the render rather than looking at it.

**1. The siding colour was applied twice** (`src/textures.js`)

`generateSidingTexture` painted the colour into the texture, and
`createSidingMaterial` also set it as `material.color`. Three multiplies
`color * map`, so the albedo was the colour squared in linear space. A wall
picked at `#6f8ba3` rendered at about `#152941` before the light touched it,
and the error grew with saturation.

The texture is now authored on white as a pure multiplier: a flat stretch of
siding samples 1.0, so `color * map` is exactly `color`. The old absolute
±50/±45 shadow/highlight deltas became multipliers (`SHADOW_STRENGTH 0.34`,
`HIGHLIGHT_STRENGTH 0.28`) so the profile still reads as it did. As a bonus the
texture is now colour-independent, so it is cached once per style instead of a
fresh 512×512 canvas per colour tried.

**2. There was no way to see a true colour** (`src/scene.js`, `defaults.js`,
`index.html`, `main.js`)

New `scene.trueColor` flag and a `🎨 True colour (flat, unlit)` toggle in the
OUT panel. `Stage.setTrueColor` switches to `NoToneMapping`, hides sun/hemi/fill
in favour of a single white `AmbientLight`, and zeroes metalness on the home's
materials (restoring it on the way out). In that mode every surface renders as
exactly the hex it was given.

**3. Auto-assign gave the trim the sky** (`src/eyedrop.js`)

`suggestFinishRoles` picks the lightest palette entry as trim. Every exterior
photo has sky in it, and sky is usually both the lightest thing in frame and a
large part of it. New `looksLikeSky` guard: light **and** markedly blue-dominant
(`luma > 150 && b - r > 25`). It never strips the pool below three entries.

Also `src/colorpick.js` now derives pointer/wheel positions from
`getBoundingClientRect` instead of `offsetX`/`offsetY`, and the pan clamp was
loosened so it stops overriding the zoom anchor (see Gotchas).

Tests 56 added; `?v=16` → `?v=17`.

## Why it mattered

The whole point of the eyedropper is that the finish is one for one with the
unit in the photograph. It was not: the dominant error was ~60/255 per channel,
which is not a subtle mismatch, it is a different colour. And because the lit
render is legitimately not the albedo, there was no way for anyone to tell
whether a remaining difference was a bug or just the sun.

## Gotchas / pitfalls

- **A colour painted into a map AND set as `material.color` is applied twice.**
  The map should carry relief only, on a white base.
- **`AmbientLight` intensity 1 does not render albedo — it renders albedo/π.**
  The light contributes `colour × intensity` as irradiance and the Lambert BRDF
  then divides by π. The intensity has to be `Math.PI`. Before this the flat
  mode was a uniform 40% dark, which reads exactly like a colour bug.
- **`metalness` moves energy out of the diffuse lobe.** The default 0.05 on
  siding is a visible 5% darkening on a value that is supposed to be exact.
- **`offsetX`/`offsetY` are unreliable on synthesised events.** Chrome returned
  203 for a synthetic wheel dispatched at a point whose true offset was 360,
  which made the zoom anchor look broken when it was the test harness that was
  broken. `clientX - getBoundingClientRect().left` is unambiguous and testable.
- **A tight pan clamp silently overrules the zoom anchor.** The old
  `(dw - w) / 2 + w / 3` limit bound at low zoom, so the anchored pan was
  clamped away and the point drifted anyway — indistinguishable from the
  anchoring not working. The rule is now only that image and frame keep
  overlapping by 40% of the smaller.
- **Measuring a render needs the pixels of the thing you mean.** Naive "most
  common colour" sampling returned the background, then the roof. Rendering the
  same view under two very different siding colours and diffing gives you the
  siding pixels and nothing else.
- Textured siding lands 1/255 off the specified hex; smooth siding is exact.
  That last LSB is mipmap minification blending the flat face with the grooves,
  and is not worth chasing.

## Verification

Measured in Chrome against a synthetic photograph with known flat regions
(`#6f8ba3` siding, `#2f3238` roof, `#f4f4f1` trim, `#a8231f` door):

- Clicking the siding in the picker returned `#6F8BA3` — the exact value.
- True-colour render, smooth siding, five test colours: rendered hex equalled
  specified hex for every one, over 95% of siding pixels.
- Full scene in true colour: siding, roof, trim, skirting and glass all appear
  byte-exact in the render's top colours.
- Lit render for `#6f8ba3` went from `#152941` (before) to `#566f83` (after) —
  the double-apply gone, the remainder being the sun and tone mapping.
- Zoom anchor: red door held at `168,34,31` under the cursor across 1.0× → 5.8×
  → 1.0×, zero drift.
- Wheel rates: trackpad ticks 1.0×→1.1× over five, ctrl-pinch 1.1×→1.5× over
  five, line-mode deltas matching pixel-mode detents.
- Touch: two-finger pinch 1.0× → 5.0× and picked nothing; single tap picked;
  a drag picked nothing.
- `npm test` — 57 pass. No console errors.
