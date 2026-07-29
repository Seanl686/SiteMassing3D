// The render package: one zip that carries everything an image model needs.
//
// This is the app's actual output. A polished lot render needs three things
// handed over together — the massing geometry, the lot photo, and the site plan
// — plus wording that ties them to each other. Exporting them one PNG at a time
// is how half of them end up missing from the upload, so they leave as a single
// file with a numbered manifest and a brief that names each one by filename.

import { buildBrief } from './brief.js';
import { measureFraming } from './framing.js';
import { slotByKey, SITE_VIEW_SLOTS } from './siteviews.js';
import { HOME_PHOTO_SLOTS, filledHomePhotos } from './homephotos.js';
import { HOME_SPEC_SCHEMA, buildSpecPrompt } from './homespec.js';
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
  allSiteViews: true,
  homePhotos: true,
  planPrompt: true,
});

const pad2 = (n) => String(n).padStart(2, '0');

/** Is the 360 wrap the backdrop of the plate we are about to render? */
const usingPanorama = (stage, pano) => !!pano?.src && pano.show !== false && !!stage?.panoMesh?.visible;

const README = (name, multi, pano) => `# ${name} — render package

## What this is for

This package exists to produce **one photorealistic image of ${name} standing on
this specific lot** — the picture you show someone who asked "what would it look
like on my land?"

It is a repeatable pattern, not a one-off. Every home and every lot goes through
the same steps and comes out the same quality: build the massing model to the
spec sheet, photograph the lot, export this package, run the brief. Swap either
half and export again.

Everything in this folder was exported together, so it stays consistent: the
plates, the lot photo, the site plan and the brief all describe the same model
at the same moment.

${multi ? `## Several render passes

This package holds **one folder per saved site view**, under \`views/\`. Start at
\`01-INDEX.md\`. Each folder is its own conversation with the image model: its own
lot photo, its own massing plate framed from that photo's position, and its own
\`BRIEF.md\`. The plates at the root are shared geometry reference.

` : ''}## How to use it

1. Open \`${multi ? '01-INDEX.md, then a view folder\'s BRIEF.md' : '01-BRIEF.md'}\`. Section 1 lists the files to attach, in order.
2. Attach them to the image model (Gemini / Nano Banana, ChatGPT, Firefly,
   Midjourney edit — the wording is model-agnostic; section 2 says how to adapt
   it for tools that only take two or three images). Section 2 also sets out
   which attachment is the authority on what: **the lot photo owns the site, the
   massing plates own the geometry, the home photographs own the finish.** The
   plates and the home photographs describe the same home and are used one over
   the other — measured drawing underneath, photographed finish on top.
3. **Place it.** Paste section 6 as your first message. The model is asked to
   echo the dimensions back before it renders, so a misread costs one turn, not
   four.
4. **Check it.** Run the seven-point list in section 7 against what came back.
   Twenty seconds, every time. Do not skip it.
5. **Correct it.** Section 8, one change per turn, re-checking after each.
6. **Polish it.** Section 9 — once, and only when all seven checks pass.

### Step 6 is the one people get wrong

The polish pass is what turns a *correct* image into a *photograph*: it matches
the lot's colour temperature, beds the skirting into the ground with a contact
shadow, softens the roofline against the sky, matches grain and depth of field.
It changes no geometry and no placement.

It is deliberately last. Polishing an image whose proportions or openings are
still wrong does not fix them — it makes them believable, and a convincing wrong
picture is worse than an obviously wrong one, because nobody catches it. Run it
once; running it repeatedly compounds the contrast and drifts away from the lot
photo's real light.

${pano ? `## The lot is a 360 panorama

\`10-lot-panorama.jpg\` is the whole site, shot from the middle of the pad. The
hero plate in each pass is a view **out of** it, so the lot is already behind the
home at the right perspective — there is nothing to composite onto. Because the
panorama covers every direction, any camera angle is a valid render position;
that is the point of shooting one instead of a handful of flat photos.

The contact sheet, the elevations and the roof plan are still **geometry
reference**: they tell the model what the home is, not where to stand.
` : `## One lot photo renders one view

\`20-massing-hero.png\` is the only plate that carries a camera position matched to
\`10-lot-photo.jpg\`. That pair is what produces a render. Every other plate —
the contact sheet, the four elevations, the roof plan — is a **geometry
reference**: it tells the model what the home is, not where to stand.

So a four-view contact sheet does **not** yield four renders. Four renders need
four lot photos, each shot from the position that matches its view, and one
pass per pair:

${SITE_VIEW_SLOTS.map((s, i) => `${i + 1}. **${s.name}** — ${s.shoot}`).join('\n')}

The app has a labelled slot for each of those four. Fill the ones you shot and
the package renders one folder per slot in a single pass. A 360 panorama removes
the constraint entirely — one shot, any angle.
`}
Re-frame the app's camera before exporting either way, because the scale and
ridge-height percentages in the brief are measured off that camera.

## Where to place rendered images (CLI & Automated Pipelines)

When running image generation via CLI scripts, LLM tools, or automated agents:
- **Save all output rendered images directly into the `renders/` subfolder** inside this package directory.
- Recommended filenames: `renders/render-01-initial.png`, `renders/render-02-polished.png`, `renders/render-final.png`.
${multi ? `- For multi-view packages, save each view's output into its view directory's \`renders/\` folder (e.g. \`views/01-front-yard/renders/\`).\n` : ''}
## Why the plates are untextured

Deliberate. They are measurement, not a picture: the front wall really is the
right multiple of the gable end, the ridge really sits at the pitch that was
typed, and every door and window is where the floor plan puts it — including on
the walls no photograph covers. A textured render would fight the lot photo's
lighting; a clean massing plate reads as geometry.
`;

/** Root index when the package holds several render passes. */
function buildViewIndex(home, passes) {
  const L = [`# ${home.name || 'Untitled model'} — ${passes.length} render passes`, ''];
  // (buildViewIndex is only reached with two or more passes, so the plural holds.)
  L.push(`This package holds one folder per saved site view. **Each folder is a`);
  L.push(`separate conversation with the image model** — its own lot photo, its own`);
  L.push(`massing plate framed from that photo's position, and its own brief.`);
  L.push('');
  L.push(`Do not mix them. A plate framed for one lot photo cannot be sited on`);
  L.push(`another; that mismatch is what makes a composite read as pasted on.`);
  L.push('');
  L.push(`| # | Site view | Shot from | Folder | Output Renders Folder |`);
  L.push(`|---|---|---|---|---|`);
  passes.forEach((p, i) => {
    const shoot = slotByKey(p.view.slotKey)?.shoot || 'a free-form camera position';
    L.push(`| ${i + 1} | ${p.view.name} | ${shoot} | \`${p.dir}/BRIEF.md\` | \`${p.dir}/renders/\` |`);
  });
  L.push('');
  L.push(`## CLI Output Destination`);
  L.push(`Save all output rendered images for each pass into the \`renders/\` subfolder inside that view's folder (e.g. \`${passes[0]?.dir || 'views/01-view'}/renders/\`).`);
  L.push('');
  L.push(`The shared geometry plates (contact sheet, elevations, roof plan) and the`);
  L.push(`site plan sit at the root and are referenced by every brief. They are`);
  L.push(`measurements to read, not viewpoints to render.`);
  return L.join('\n');
}

/**
 * Assemble the package. Returns `{ files, manifest, brief, folder }` without
 * writing anything, so it can be inspected or tested before it is saved.
 *
 * Rendering the elevation plates moves the camera and hides the site photo;
 * both are put back before this returns.
 */
export async function buildRenderPackage(ctx = {}) {
  const { stage, state, viewName, options, savedAt } = ctx;
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

  const sp = home.sitePhoto || {};
  // Saved site views each pair a lot photo with the camera framed onto it, so
  // each one is its own render pass and gets its own folder. Without any, the
  // package describes the single set-up currently on screen.
  const siteViews = opts.allSiteViews && ctx.applyView ? (home.siteViews || []) : [];
  // Folders and an index only earn their keep from two passes up. With exactly
  // one saved view the package stays flat — it is still that view's photo and
  // camera that get rendered, just at the root where a single brief belongs.
  const multi = siteViews.length > 1;
  if (siteViews.length === 1) ctx.applyView(siteViews[0]);

  // One panorama covers the whole site, however many passes there are, so it is
  // added once and every brief points at the same file.
  const pano = home.panorama || {};
  const panoBackdrop = usingPanorama(stage, pano);
  let panoFile = null;
  if (opts.lotPhoto && panoBackdrop && pano.src) {
    panoFile = `10-lot-panorama.${dataUrlExt(pano.src, 'jpg')}`;
    add(panoFile, dataUrlToBytes(pano.src),
      'the lot as a 360 panorama — the source of truth for the site. The hero plate is a view out of it, from inside it.');
  }

  /**
   * The pair that actually produces a render: the lot photo and the massing
   * plate framed from the same position. `prefix` is '' at the root or
   * `views/NN-name/` inside a per-view folder.
   */
  const addRenderPass = async (prefix, names, collect) => {
    const passLotPhoto = home.sitePhoto || {};
    // A panorama is already wrapped around the site, so the hero plate below is
    // a view out of the real lot and there is no separate flat backdrop to
    // attach. One panorama covers every pass, so it sits at the root — see the
    // shared entry above, not here.
    if (opts.lotPhoto && !panoBackdrop && passLotPhoto.src) {
      const ext = dataUrlExt(passLotPhoto.src, 'jpg');
      collect(`${names.lot}.${ext}`, dataUrlToBytes(passLotPhoto.src),
        'the empty lot — the source of truth for the site. Do not re-render it.');
    }
    const passFraming = measureFraming(stage, home, viewName);
    const hero = plateCanvas(stage, home, scene, state.export, viewName || 'hero', {
      alpha: false,
      captionFile: `${names.hero}.png`,
    });
    collect(`${names.hero}.png`, await canvasToPngBytes(hero),
      'the massing model framed and scaled the way it should sit on the lot — match this placement, angle and size.');
    if (opts.cutout) {
      const cut = plateCanvas(stage, home, scene, state.export, viewName || 'hero', { alpha: true });
      collect(`${names.cutout}.png`, await canvasToPngBytes(cut),
        'the same view as a transparent cutout, for compositing directly onto the lot photo.');
    }
    // Pre-create the renders/ directory in the package structure with a placeholder README.md
    const textEncoder = new TextEncoder();
    collect('renders/README.md', textEncoder.encode('# Renders Directory\n\nPlace all finished rendered images generated by CLI tools or LLM image services here.\n'));
    return passFraming;
  };

  // ---- 1 & 2. the render pass(es) -----------------------------------------
  let framing = null;
  const passes = [];
  const backdrop = panoBackdrop ? 'panorama' : 'photo';

  if (!multi) {
    framing = await addRenderPass('', { lot: '10-lot-photo', hero: '20-massing-hero', cutout: '21-massing-hero-cutout' }, add);
  } else {
    for (let i = 0; i < siteViews.length; i++) {
      const view = siteViews[i];
      const dir = `views/${pad2(i + 1)}-${slug(view.name)}`;
      const local = [];
      ctx.applyView(view);
      const f = await addRenderPass(
        dir,
        { lot: 'lot-photo', hero: 'hero', cutout: 'hero-cutout' },
        (file, data, role) => {
          files.push({ name: `${folder}/${dir}/${file}`, data });
          if (role) local.push({ index: local.length + 1, file, role });
        },
      );
      passes.push({ view, dir, framing: f, manifest: local, backdrop });
      if (!framing) framing = f;
    }
    ctx.restore?.();
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
        'four-view contact sheet — GEOMETRY REFERENCE ONLY. Read the home off it; do not render these four views. '
        + (panoBackdrop
          ? 'The hero plate is the one framing to render.'
          : 'There is one lot photo, so there is one render.'));
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

  // ---- 3b. photographs of the real home -----------------------------------
  // Shared across every pass: the home looks the same from wherever the lot was
  // photographed. Each one is named for the wall it shows and states the plate
  // it pairs with, so the model never has to guess which image goes with which
  // elevation.
  if (opts.homePhotos) {
    let n = 40;
    for (const slot of filledHomePhotos(home.homePhotos)) {
      const photo = home.homePhotos[slot.key];
      add(`${n}-home-${slot.key}.${dataUrlExt(photo.src, 'jpg')}`, dataUrlToBytes(photo.src),
        `PHOTOGRAPH OF THE REAL HOME — ${slot.name}. This is what that wall must LOOK like: `
        + `siding profile and colour, window proportions, trim, roof. Lay it over the geometry `
        + `in ${slot.plate}, which stays the authority on sizes and positions.`);
      n++;
    }
  }

  // ---- 4. the site plan ---------------------------------------------------
  const plan = home.sitePlan || {};
  if (opts.sitePlan && plan.src) {
    const pageLabel = plan.pageCount > 1 ? ` (page ${plan.page} of ${plan.pageCount})` : '';
    add(`50-site-plan.${dataUrlExt(plan.src, 'png')}`, dataUrlToBytes(plan.src),
      `the site plan / spec sheet${pageLabel}, converted to PNG so the model can read it.`);
  }
  // The prompt that rebuilds this model from the plan page. Shipped alongside
  // the plan so the package can regenerate the geometry it describes — open the
  // JSON in the app, or hand this file and the plan to any vision model.
  if (opts.sitePlan && plan.src && opts.planPrompt) {
    add('52-READ-THE-PLAN.md',
      buildSpecPrompt({ knownWidthFt: home.dimensions.widthFt, knownLengthFt: home.dimensions.lengthFt })
      + '\n\n## Schema\n\nAnswer with a JSON object matching this schema exactly:\n\n```json\n'
      + JSON.stringify(HOME_SPEC_SCHEMA, null, 2) + '\n```\n');
  }
  if (opts.originalPdf && plan.pdf) {
    // Carried but NOT in the manifest: attaching the PDF is the failure mode the
    // converted PNG exists to avoid. It rides along for the human.
    add(`51-site-plan-original.pdf`, dataUrlToBytes(plan.pdf));
  }

  // ---- 5. the brief(s) ----------------------------------------------------
  // With saved site views there is one brief per view, inside its own folder,
  // because each one is a separate render pass against a different lot photo.
  // The shared plates are referenced up two levels from there.
  const sharedRefs = manifest.map((m) => ({ ...m, file: `../../${m.file}` }));

  for (const p of passes) {
    // The site comes first in the attachment list, then this pass's own plates,
    // then the shared geometry — the order the brief tells the model to use.
    const lead = sharedRefs.filter((m) => panoFile && m.file.endsWith(panoFile));
    const rest = sharedRefs.filter((m) => !lead.includes(m));
    const localManifest = [...lead, ...p.manifest, ...rest]
      .map((m, i) => ({ ...m, index: i + 1 }));
    files.push({
      name: `${folder}/${p.dir}/BRIEF.md`,
      data: buildBrief({
        home,
        scene,
        framing: p.framing,
        site: { ...(home.brief || {}), backdrop: p.backdrop },
        manifest: localManifest,
        savedAt,
        passName: p.view.name,
        passShoot: slotByKey(p.view.slotKey)?.shoot || null,
      }),
    });
  }

  const brief = multi
    ? buildViewIndex(home, passes)
    : buildBrief({ home, scene, framing, site: { ...(home.brief || {}), backdrop }, manifest, savedAt });

  files.unshift({ name: `${folder}/00-README.md`, data: README(home.name || 'Untitled model', multi, panoBackdrop) });
  files.splice(1, 0, { name: `${folder}/${multi ? '01-INDEX.md' : '01-BRIEF.md'}`, data: brief });

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

  return { files, manifest, brief, folder, framing, passes };
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
