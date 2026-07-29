# SiteMassing3D

**A repeatable way to show what a house package would look like on a lot.**

Someone asks "what would that home look like on my land?" This turns that into a
photorealistic image, the same way every time, for any home and any lot: build
the massing model to the spec sheet, photograph the lot, load the photos of the
real home, export one package, run the brief inside it. Swap either half and
export again — the process does not change, so neither does the quality.

The app is the measuring half. It produces geometry you can trust and hands it
to an image model with wording precise enough to survive the handoff.

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
4. Load the lot photo in **Site Photo & Camera Framing** and frame the model on
   it — that framing is what the render will match.
5. Load the site plan PDF in **AI Render Package**; page 1 is converted to PNG.
6. Hit **Export render package (.zip)**. One file, ready to hand to the image
   model: the plates, the lot photo, the converted plan, and a written brief
   whose numbers were measured off the model rather than typed.

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

**Floor plan plate** — load the spec-sheet PNG, set *Plate width (ft)* so the
printed footprint matches the blue outline (turn on *Dimension outline on ground*
to see it), then nudge Offset X/Z and Rotation until it lines up. With *Plan-pick
mode* on, clicking the plate drops a door on the nearest wall at that position.

**Photos Of The Real Home** (`HOM` panel) — dealer-lot or catalogue shots of this
model, one slot per wall plus a ¾ catalogue shot. These are a different class of
asset from the lot photos and the brief keeps them strictly apart:

| Asset | Authority on | Not authority on |
|---|---|---|
| Lot photo | the site — ground, planting, backdrop, light, camera position | the home |
| Massing plates | geometry — size, proportion, roof pitch, every opening | colour, material, texture |
| Home photos | finish — how the real siding, windows, trim and roof look | size, proportion, placement |

Each home photo is named for the wall it shows and states the plate it pairs
with, so the model is told to lay the photograph over that plate rather than
choose between them — measured drawing underneath, photographed finish on top.
Walls you have no photo of are exactly why the plates carry every opening on all
four sides; the brief names those walls and says to extend the siding plainly and
invent nothing.

**AI Render Package** — the app's actual output. *Export render package (.zip)*
writes one archive containing:

| File | What it is |
|---|---|
| `00-README.md` | how to use the package |
| `01-BRIEF.md` | the prompt, with every number measured off this model |
| `10-lot-photo.*` | the lot photo, unmodified |
| `20-massing-hero.png` | the current view — the plate matched to the lot photo |
| `21-massing-hero-cutout.png` | the same view with an alpha channel, for compositing |
| `30-elevation-set.png`, `31`–`35` | the four elevations and the roof plan |
| `40-home-*.jpg` | photos of the real home, each named for its wall |
| `50-site-plan.png` | page 1 of the site plan PDF, converted |
| `90-project.json` | the project, so the package can be rebuilt |

The brief inside it states, in order: what you are making, which attachment is
the authority on what, the measured geometry, the opening schedule, the Turn 1
prompt, a **seven-point acceptance check**, the corrections, and finally the
**polish pass**.

**The polish pass is the step to understand.** Everything before it is about
being *correct* — right size, right proportions, right openings, right place on
the lot. None of that makes the picture look real; a correct image still reads
as a cut-out. The polish pass matches the lot's colour temperature, beds the
skirting into the ground with a contact shadow, softens the roofline against the
sky and matches grain and depth of field. It changes no geometry and no
placement.

It runs **once, and only after all seven checks pass**. Polishing early does not
fix a wrong image — it makes it believable, which is the failure you cannot
recover from, because nobody catches it. Running it repeatedly compounds the
contrast and drifts away from the lot photo's real light.

The wording is model-agnostic and the brief says how to adapt it: many-image chat
models take everything as written; two- or three-image editors take the lot
photo, the hero plate and one home photo, with the tables carrying the rest in
text; prompt-and-reference models use the lot photo and hero plate as references.
The run order never changes and the polish pass stays last.

**One lot photo renders one view.** The hero plate is the only one shot from the
lot photo's camera position, so it is the only one the model can site. The
elevations and the contact sheet are geometry reference — they say what the home
is, not where to stand. Four finished renders need four lot photos, each shot
from the position matching its view. The brief says this to the model in as many
words, because rendering a viewpoint the lot photo was never shot from is the
failure this workflow hits most.

**The four lot photos.** The top of the Site Photo panel has a labelled slot for
each of the four standard camera positions, so it is unambiguous which
photograph goes where:

| # | Slot | Where to stand with the camera |
|---|---|---|
| 1 | ¾ front-left | Off the front-**left** corner of the pad. Long front wall running away, left gable end facing you. |
| 2 | ¾ front-right | Mirror image: off the front-**right** corner. |
| 3 | ¾ rear-left | Behind the pad, off the rear-left corner — the side no dealer photo covers. |
| 4 | Straight on, eye level | Square to the long side of the pad, camera at eye height, ~1.5× the home length back. |

All four are perspective positions. The orthographic elevations measure true but
no photograph is orthographic, so they are geometry reference and never a slot.

Loading a photo into a slot jumps the 3D camera to that position — align the
model to the photo from there and the slot keeps the alignment and the camera.
You do not need all four; each one you fill becomes its own render pass, and the
package's `01-INDEX.md` and per-pass briefs repeat the shooting note so the image
model knows which position it is rendering.

**Saved site views** below the slots hold the same thing for any other angle:
the lot photo, its alignment *and* the camera, under a name. Save one with
`+ Save current`. Slots and free-form views cycle together with `‹ Prev` /
`Next ›`, the badge in the view bar, or the `[` and `]` keys — slots first in
shooting order, free-form after. With *One folder per saved site view* ticked, the package writes
`views/01-<name>/` … each with its own lot photo, hero plate, cutout and
`BRIEF.md`, plus a root `01-INDEX.md`. One export, one render pass per photo.

**360° Panorama Site Wrap** removes the constraint entirely. Load an
equirectangular (2:1) 360 shot taken from the middle of the pad and it is
wrapped on a sphere **centred on the house site** — not pinned to the camera, so
the home does not slide across it as you orbit. Every angle becomes a valid
render position from a single photograph, and the hero plate comes out with the
real lot already behind the home at the right perspective. Set *Shot height* to
the tripod height, *Horizon radius* to roughly the treeline distance, then nudge
*Level* until the horizon lies flat on the ground grid; *Heading* spins the lot
under the home. The brief detects this and changes what it asks the model for —
"photographise this scene" rather than "composite these two plates". A panorama
supersedes the flat site photo while it is showing.

The brief's scale numbers ("spans 31% to 78% of the image width", "ridge at 59%
of frame height", "nearest corner: front-left") are read off the live camera by
projecting the model's bounding box, so **re-export after you re-frame**. The
*Measured framing* line in the panel shows them live.

Fill the *What only the lot photo can tell you* fields — the landmark, the pad,
what to preserve — and they land in the brief. Leave *Nearest corner* and
*Lighting* blank and they are derived from the camera and the sun sliders.

The site plan accepts a **PDF** and converts page 1 to PNG in the browser (pdf.js
is vendored). This matters: most image models ignore PDF attachments outright,
and the ones that accept them read text unreliably.

**Screenshot** — set the pixel size, then *Render PNG*. *Fit pixel aspect to
current view* retargets the height so an elevation isn't 70% sky. *Transparent
background* gives you an alpha PNG to composite straight onto a lot plate.

## Home spec files

`Save JSON` writes the whole working state to a file: the home (dimensions,
colors, every opening), the scene (sun, background, toggles), the site photo
including its image and alignment, the export settings, and the view — which
preset was active and exactly where the camera was pointing. Reopening the file
puts you back in front of the same picture.

Files are versioned (`"format": "sitemassing3d", "version": 2`). A bare home
object — the `homes/*.json` library specs, and anything saved before views were
stored — still opens; it simply gets framed by the default preset.

Drop a file in `homes/`, add a line to `homes/index.json`, and it shows up in the
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

- Single rectangular footprint. No L-shapes, dormers, porch roofs, or bay windows.
- One roof pitch, ridge always along the length.
- Massing-level materials: flat colors, no siding or shingle texture. That is
  deliberate — a textured render fights the lot photo's lighting, while a clean
  massing plate reads as a geometry reference.
