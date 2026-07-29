// The render package: one zip that carries everything an image model needs.
//
// This is the app's actual output. A polished lot render needs three things
// handed over together — the massing geometry, the lot photo, and the site plan
// — plus wording that ties them to each other. Exporting them one PNG at a time
// is how half of them end up missing from the upload, so they leave as a single
// file with a numbered manifest and a brief that names each one by filename.

import { buildBrief } from './brief.js';
import { measureFraming } from './framing.js';
import { buildProject } from './project.js';
import { zipStore, dataUrlToBytes, dataUrlExt } from './zip.js';
import {
  slug, plateCanvas, contactSheetCanvas, canvasToPngBytes, withRestoredCamera, saveWithPicker,
} from './capture.js';

/** The geometry plates, in the order they go into the package. */
const PLATE_VIEWS = [
  ['front', 'Front elevation', 'front-elevation'],
  ['rear', 'Rear elevation', 'rear-elevation'],
  ['left', 'Left end elevation', 'left-end-elevation'],
  ['right', 'Right end elevation', 'right-end-elevation'],
  ['plan', 'Roof plan', 'roof-plan'],
];

export const defaultPackageOptions = () => ({
  elevations: true,
  contactSheet: true,
  cutout: true,
  lotPhoto: true,
  sitePlan: true,
  originalPdf: true,
  projectJson: true,
});

const README = (name) => `# ${name} — render package

Everything in this folder was exported together from SiteMassing3D so it stays
consistent: the plates, the lot photo, the site plan and the brief all describe
the same model at the same moment.

## How to use it

1. Open \`01-BRIEF.md\`. Section 1 lists the files to attach, in order.
2. Attach them to the image model (Gemini / Nano Banana, ChatGPT, Firefly,
   Midjourney edit — the wording is model-agnostic).
3. Paste section 5 as your first message. The model is asked to echo the
   dimensions back before it renders, so a misread costs one turn, not four.
4. Use section 6 for corrections — **one change per turn**, never stacked.

## One lot photo renders one view

\`20-massing-hero.png\` is the only plate that carries a camera position matched to
\`10-lot-photo.jpg\`. That pair is what produces a render. Every other plate —
the contact sheet, the four elevations, the roof plan — is a **geometry
reference**: it tells the model what the home is, not where to stand.

So a four-view contact sheet does **not** yield four renders. Four renders need
four lot photos, each shot from the position that matches its view, and one
pass per pair:

| Want this render | Shoot the lot from | Frame this view in the app |
|---|---|---|
| front three-quarter | facing the pad's front-left | ¾ front-L |
| opposite three-quarter | facing the pad's front-right | ¾ front-R |
| straight-on front | square to the long side of the pad | Front elev |
| end view | square to the short side | Left / Right end |

Re-frame the app's camera to match each photo before exporting, because the
scale and ridge-height percentages in the brief are measured off that camera.

## Why the plates are untextured

Deliberate. They are measurement, not a picture: the front wall really is the
right multiple of the gable end, the ridge really sits at the pitch that was
typed, and every door and window is where the floor plan puts it — including on
the walls no photograph covers. A textured render would fight the lot photo's
lighting; a clean massing plate reads as geometry.
`;

/**
 * Assemble the package. Returns `{ files, manifest, brief, folder }` without
 * writing anything, so it can be inspected or tested before it is saved.
 *
 * Rendering the elevation plates moves the camera and hides the site photo;
 * both are put back before this returns.
 */
export async function buildRenderPackage({ stage, state, viewName, options, savedAt } = {}) {
  const opts = { ...defaultPackageOptions(), ...(options || {}) };
  const { home, scene } = state;
  const base = slug(home.name);
  const folder = `${base}-render-package`;
  const files = [];
  const manifest = [];

  const add = (file, data, role) => {
    files.push({ name: `${folder}/${file}`, data });
    if (role) manifest.push({ index: manifest.length + 1, file, role });
  };

  // ---- 1. the lot photo, unmodified ---------------------------------------
  const sp = home.sitePhoto || {};
  if (opts.lotPhoto && sp.src) {
    const ext = dataUrlExt(sp.src, 'jpg');
    add(`10-lot-photo.${ext}`, dataUrlToBytes(sp.src),
      'the empty lot — the source of truth for the site. Do not re-render it.');
  }

  // ---- 2. the hero plate: the composite the user framed --------------------
  const framing = measureFraming(stage, home, viewName);
  const heroCanvas = plateCanvas(stage, home, scene, state.export, viewName || 'hero', {
    alpha: false,
    captionFile: `20-massing-hero.png`,
  });
  add('20-massing-hero.png', await canvasToPngBytes(heroCanvas),
    'the massing model framed and scaled the way it should sit on the lot — match this placement, angle and size.');

  if (opts.cutout) {
    const cut = plateCanvas(stage, home, scene, state.export, viewName || 'hero', { alpha: true });
    add('21-massing-hero-cutout.png', await canvasToPngBytes(cut),
      'the same view as a transparent cutout, for compositing directly onto the lot photo.');
  }

  // ---- 3. geometry plates -------------------------------------------------
  // Clean plates are geometry references, so the lot photo comes out from
  // behind them — otherwise the model reads the backdrop as part of the home.
  const photoWas = sp.show;
  try {
    if (sp) sp.show = false;

    if (opts.contactSheet) {
      const sheet = contactSheetCanvas(stage, home, scene, state.export);
      add('30-elevation-set.png', await canvasToPngBytes(sheet.canvas),
        'four-view contact sheet — GEOMETRY REFERENCE ONLY. Do not render these four views; there is one lot photo, so there is one render.');
    }

    if (opts.elevations) {
      await withRestoredCamera(stage, async () => {
        let n = 31;
        for (const [view, label, name] of PLATE_VIEWS) {
          stage.setView(view, home.dimensions, scene);
          const file = `${n}-${name}.png`;
          const c = plateCanvas(stage, home, scene, state.export, label, {
            alpha: false, burn: true, captionFile: file,
          });
          add(file, await canvasToPngBytes(c), `${label} — geometry reference, true orthographic, measures to scale. Not a view to render.`);
          n++;
        }
      });
    }
  } finally {
    if (sp) sp.show = photoWas;
  }

  // ---- 4. the site plan ---------------------------------------------------
  const plan = home.sitePlan || {};
  if (opts.sitePlan && plan.src) {
    const pageLabel = plan.pageCount > 1 ? ` (page ${plan.page} of ${plan.pageCount})` : '';
    add(`50-site-plan.${dataUrlExt(plan.src, 'png')}`, dataUrlToBytes(plan.src),
      `the site plan / spec sheet${pageLabel}, converted to PNG so the model can read it.`);
  }
  if (opts.originalPdf && plan.pdf) {
    // Carried but NOT in the manifest: attaching the PDF is the failure mode the
    // converted PNG exists to avoid. It rides along for the human.
    add(`51-site-plan-original.pdf`, dataUrlToBytes(plan.pdf));
  }

  // ---- 5. the brief -------------------------------------------------------
  const brief = buildBrief({
    home,
    scene,
    framing,
    site: home.brief || {},
    manifest,
    savedAt,
  });
  files.unshift({ name: `${folder}/00-README.md`, data: README(home.name || 'Untitled model') });
  files.splice(1, 0, { name: `${folder}/01-BRIEF.md`, data: brief });

  // ---- 6. the project file, so the package can be reproduced --------------
  if (opts.projectJson) {
    const project = buildProject({
      home,
      scene,
      exportOpts: state.export,
      view: { preset: stage._lastView || null, label: viewName || null, camera: stage.cameraState() },
      savedAt,
    });
    files.push({
      name: `${folder}/90-project.json`,
      data: JSON.stringify(project, null, 2),
    });
  }

  return { files, manifest, brief, folder, framing };
}

/** Build the package and hand it to the user as a single .zip. */
export async function exportRenderPackage(ctx) {
  const built = await buildRenderPackage(ctx);
  const bytes = zipStore(built.files, { modified: new Date() });
  const blob = new Blob([bytes], { type: 'application/zip' });
  const filename = `${built.folder}.zip`;

  const saved = await saveWithPicker(blob, filename, 'Render package (ZIP)', 'application/zip', '.zip');
  if (!saved) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  return { ...built, filename, bytes: bytes.length };
}
