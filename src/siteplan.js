// Site plan / spec sheet intake.
//
// The plan usually arrives as a PDF, and image models either ignore PDF
// attachments outright or read their text unreliably — the old workflow told
// you to shell out to ImageMagick and convert page 1 by hand. This does that
// conversion in the browser instead, so the plan lands in the render package as
// a PNG the model can actually read.
//
// pdf.js is vendored and imported lazily: it is 1.6 MB of parser that most
// sessions never touch.

const PDFJS_URL = '../vendor/pdf.min.mjs';
const WORKER_URL = 'vendor/pdf.worker.min.mjs';

let pdfjsPromise = null;

function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import(/* @vite-ignore */ PDFJS_URL).then((mod) => {
      const lib = mod.default && mod.default.getDocument ? mod.default : mod;
      // Same-origin worker; the app is served over HTTP either way.
      lib.GlobalWorkerOptions.workerSrc = new URL(WORKER_URL, document.baseURI).href;
      return lib;
    });
  }
  return pdfjsPromise;
}

export const isPdf = (file) =>
  !!file && (file.type === 'application/pdf' || /\.pdf$/i.test(file.name || ''));

/**
 * Render one page of a PDF to a PNG data URL, scaled so its long edge is about
 * `maxDim` pixels — big enough for an image model to read a dimension line,
 * small enough to keep the package under a sane size.
 *
 * Returns { dataUrl, pageCount, page, width, height }.
 */
export async function pdfPageToPng(file, { page = 1, maxDim = 2200 } = {}) {
  const pdfjs = await loadPdfjs();
  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  try {
    const pageCount = doc.numPages;
    const n = Math.min(Math.max(1, Math.round(page)), pageCount);
    const pg = await doc.getPage(n);

    const base = pg.getViewport({ scale: 1 });
    const scale = Math.min(4, maxDim / Math.max(base.width, base.height));
    const viewport = pg.getViewport({ scale: Math.max(0.2, scale) });

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d');
    // Plans are line art on white; without this the transparent PDF background
    // exports as black once the alpha is flattened.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await pg.render({ canvasContext: ctx, viewport, background: '#ffffff' }).promise;
    return {
      dataUrl: canvas.toDataURL('image/png'),
      pageCount,
      page: n,
      width: canvas.width,
      height: canvas.height,
    };
  } finally {
    doc.destroy();
  }
}

/** How many pages a PDF has, without rendering any of them. */
export async function pdfPageCount(file) {
  const pdfjs = await loadPdfjs();
  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  const n = doc.numPages;
  doc.destroy();
  return n;
}

/** Re-encode an image file to a PNG data URL, capped at `maxDim` on the long edge. */
export function imageFileToPng(file, maxDim = 2200) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let w = img.naturalWidth, h = img.naturalHeight;
      if (Math.max(w, h) > maxDim) {
        const s = maxDim / Math.max(w, h);
        w = Math.round(w * s); h = Math.round(h * s);
      }
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      resolve({ dataUrl: c.toDataURL('image/png'), pageCount: 1, page: 1, width: w, height: h });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image decode failed')); };
    img.src = url;
  });
}

/** Load a plan from whatever the user picked — PDF page 1, or a plain image. */
export function loadSitePlan(file, opts = {}) {
  return isPdf(file) ? pdfPageToPng(file, opts) : imageFileToPng(file, opts.maxDim);
}
