# SiteMassing3D

A parametric 3D massing model of a double-wide, built to produce the plate images
that the site-render prompt in `../SITE-RENDER-PROMPT-TEMPLATE.md` asks for.

The point is not a pretty render. The point is **geometry you can trust**: the
front wall really is `L/W` times as long as the gable end, the roof ridge really
sits at the pitch you typed, and the exterior doors are really where the floor
plan puts them — including on the walls no photograph covers.

## Run it

```fish
cd SiteMassing3D
npm start          # serves on http://localhost:5173
```

Any static server works (`python3 -m http.server 5173` is wired up as `npm run serve`).
It must be served over HTTP — ES modules and the home library will not load from
a `file://` path.

No build step. `three` is vendored into `vendor/`; `node_modules/` is only there
so the vendored copy can be refreshed.

## The loop it is built for

1. Read the model's `W' x L'` off the spec sheet and type it into **Home**.
2. Set siding / trim / roof colors off the dealer-lot photo.
3. Place the **exterior doors** — this is the part a photograph can't give you.
   Load the floor plan as a plate, scale it to the footprint outline, and trace.
4. Hit **Front elev / Rear elev / Left end / Right end**, or **Render 4-view
   contact sheet** for all of them at once.
5. Feed those PNGs to the image model as the geometry reference, alongside the
   lot photo and the home photos.

The burnt-in caption carries the model name and `W × L`, so the plate answers the
"state the dimensions you read" step of the prompt template on its own.

## Controls

**Views** (top bar) — the four elevations and the plan use an orthographic camera,
so they measure true. The three-quarter and eye-level views use a perspective
camera with the focal length from the Scene panel, so they read like a photo.
Orbit/pan/zoom with the mouse at any time; once you move the camera yourself, the
presets stop re-fitting your framing on export.

**Openings** — click a wall to add at that spot, or use `+ Door / + Slider /
+ Window`. Click a door or window to select it:

| Action | Result |
|---|---|
| Drag the body | Move along the wall (windows also move vertically) |
| Drag a blue handle | Resize that edge |
| `Shift` while dragging | Lock to one axis |
| `Alt` while dragging | Turn off the 1″ snap |
| `Del` / `Backspace` | Delete the selection |

Every value is also typeable in the sidebar row. `Offset` is measured left→right
as you face that wall from outside.

**Asymmetric roof & sections** — the roof does not have to be one symmetric
gable. Two independent controls stack:

*Across the ridge.* Tick **Independent front / back roof slopes** and each plane
gets its own pitch. Because the two planes then climb different amounts over the
same run, one peaks higher than the other and the gap between them is closed with
a clerestory wall. **Ridge offset** slides the ridge off center (+ toward the rear
wall), which changes how far each plane runs before it gets there. **Ridge step**
lifts the rear plane's peak by a fixed amount on top of all that — negative drops
it. The panel prints the resolved peak heights and effective pitches as you type.

*Along the length.* **+ Split section** cuts the home into roof sections measured
from the left end. Each section carries its own pitches, ridge offset, ridge step,
front and rear eave heights, and roof style (gable, shed either way, or flat) — or
inherits any of them by leaving the field blank. So one half of the house can run
a 3/12 shed over 11′ walls while the other runs a 10/12 gable over 8′ walls. Where
two neighbouring sections disagree, the wall closing the gap between their roofs
is built for you, the long walls step at the boundary, and each gable end traces
whatever cross-section its end section resolves to.

**Floor plan plate** — load the spec-sheet PNG, set *Plate width (ft)* so the
printed footprint matches the blue outline (turn on *Dimension outline on ground*
to see it), then nudge Offset X/Z and Rotation until it lines up. With *Plan-pick
mode* on, clicking the plate drops a door on the nearest wall at that position.

**Screenshot** — set the pixel size, then *Render PNG*. *Fit pixel aspect to
current view* retargets the height so an elevation isn't 70% sky. *Transparent
background* gives you an alpha PNG to composite straight onto a lot plate.

## Home spec files

`Save JSON` writes the whole home — dimensions, colors, every opening — to a file.
Drop it in `homes/`, add a line to `homes/index.json`, and it shows up in the
**Library** dropdown.

`homes/_TEMPLATE.json` is the starting point. Its dimensions are placeholders:
**read the real `W' x L'` off the spec sheet rather than trusting them.**

```json
{
  "name": "Redmond 25610",
  "dimensions": {
    "widthFt": 27, "lengthFt": 56,
    "wallHeightFt": 8, "floorHeightFt": 2.5,
    "roofPitch": 4, "eaveOverhangFt": 1, "rakeOverhangFt": 0.75,
    "roofStyle": "gable"
  },
  "colors": { "siding": "#8d9299", "trim": "#f2f2f0", "roof": "#3a3d42",
              "skirting": "#e6e6e1", "door": "#f2f2f0", "glass": "#4d6070" },
  "openings": [
    { "id": "d1", "type": "door", "wall": "front",
      "offsetFt": 14, "widthFt": 3, "heightFt": 6.67, "sillFt": 0,
      "label": "Main entry" }
  ]
}
```

An asymmetric or sectioned roof adds a few more `dimensions` keys. All of them are
optional; a file without them is a plain symmetric gable.

```json
"dimensions": {
  "asymmetricRoof": true,
  "frontPitch": 9, "backPitch": 3,
  "ridgeOffsetFt": 2.5, "ridgeStepFt": 0,
  "roofSections": [
    { "startFt": 0,  "label": "Main", "pitch": null },
    { "startFt": 28, "label": "Wing", "pitch": 3,
      "frontWallHeightFt": 11, "roofStyle": "shed" }
  ]
}
```

- `asymmetricRoof` — until this is `true`, `frontPitch`, `backPitch`,
  `ridgeOffsetFt` and `ridgeStepFt` are ignored and the roof stays symmetric.
- `roofSections` — ordered by `startFt`, measured in feet from the **left end**.
  The first section always starts at 0 and the last runs to the far end; anything
  narrower than a foot is dropped. `null` (or a missing key) on any field but
  `startFt` means "inherit from the whole-home settings above".
- `pitch` sets both slopes of a section at once; `frontPitch` / `backPitch`
  override it per plane.
- `roofStyle` — `gable`, `shed` (high edge at the rear wall), `shedFront` (high
  edge at the front wall), or `flat`. A shed grows the wall on its high side to
  meet the plane, and a flat deck levels both walls onto one height.
- `wall` — `front` and `back` are the long walls, `left` and `right` the gable ends.
- `type` — `door`, `slider`, or `window`.
- `offsetFt` — from the wall's left corner, viewed from outside.
- `sillFt` — above the floor deck, not above grade. Doors are pinned to 0.
- All lengths are feet; `6.67` is a 6'-8" door.

Because the format is plain JSON keyed to the spec sheet's own vocabulary, you
can hand a spec sheet PNG to Claude and ask it to write the file — model name,
`W' x L'`, and the door and window schedule read straight off the plan. Check the
result against the sheet before you trust a render made from it.

## Conventions inside the model

- One world unit is one foot. `+X` runs along the length, `+Z` across the width,
  `+Y` is up. The front wall faces `-Z`; the gable ends are at `±X`.
- Walls are extruded `THREE.Shape`s with a hole per opening, so an opening is a
  real void, not a decal — it stays correct at any camera angle.
- The gizmo overlay is excluded from every export.

## Known limits

- Single rectangular footprint. No L-shapes, porch roofs, or bay windows.
- The ridge always runs along the length. It can sit off center, step vertically,
  and change pitch or height from one section to the next, but it never turns a
  corner — a cross-gable would need a second ridge axis.
- Roof sections split along the length only. There is no way to give the front
  half of the *width* a different treatment from the rear half beyond the two
  slopes either side of the ridge.
- Massing-level materials: flat colors, no siding or shingle texture. That is
  deliberate — a textured render fights the lot photo's lighting, while a clean
  massing plate reads as a geometry reference.
