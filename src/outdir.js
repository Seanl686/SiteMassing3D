// The project's output folder.
//
// Every export used to end at the browser's download folder, or at a Save-As
// dialog that starts there and has to be re-steered to the project every single
// time. A site with four views is a dozen files a session, and they belong next
// to the project, not in a pile with everything else the browser has ever
// fetched. So the folder is picked ONCE, remembered, and every later export
// writes straight into it with no dialog at all.
//
// The handle cannot go in localStorage — it is a live object, not JSON — so it
// lives in IndexedDB, which is the only store that structured-clones handles.
// Permission does not survive a reload, so the first export after opening the
// app re-asks; that prompt is one click and it names the folder the user
// already chose.

const DB_NAME = 'sitemassing3d';
const STORE = 'handles';
const KEY = 'outputDir';

/** Chrome, Edge and Opera have the API; Firefox and Safari do not. */
export const supportsOutputFolder = () =>
  typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idb(mode, fn) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  })).catch(() => null);
}

/** The remembered handle, whatever its permission state. */
let cached = null;
let loaded = false;

async function stored() {
  if (!loaded) {
    cached = await idb('readonly', (s) => s.get(KEY));
    loaded = true;
  }
  return cached;
}

/**
 * The folder's name for the UI, or null if none is set. Deliberately does not
 * ask for permission: this runs on every panel refresh, and a permission prompt
 * has to come from a click.
 */
export async function outputFolderName() {
  const handle = await stored();
  return handle ? handle.name : null;
}

/**
 * Let the user choose the folder. Returns its name, or null if they cancelled.
 * Must be called from a user gesture.
 */
export async function chooseOutputFolder() {
  if (!supportsOutputFolder()) return null;
  try {
    const handle = await window.showDirectoryPicker({
      id: 'sitemassing3d-output',   // the picker reopens where it was last used
      mode: 'readwrite',
      startIn: 'documents',
    });
    cached = handle;
    loaded = true;
    await idb('readwrite', (s) => s.put(handle, KEY));
    return handle.name;
  } catch {
    return null;              // cancelled, or the picker is not available here
  }
}

export async function clearOutputFolder() {
  cached = null;
  loaded = true;
  await idb('readwrite', (s) => s.delete(KEY));
}

/**
 * The handle, with write permission confirmed. `prompt: false` checks silently —
 * used to decide whether a Save-As dialog is needed at all — while the default
 * may show the browser's one-click "let this site edit files" prompt, so it has
 * to be reached from a user gesture.
 */
async function writableHandle({ prompt = true } = {}) {
  const handle = await stored();
  if (!handle?.queryPermission) return null;
  const opts = { mode: 'readwrite' };
  let state = await handle.queryPermission(opts);
  if (state === 'prompt' && prompt) state = await handle.requestPermission(opts);
  return state === 'granted' ? handle : null;
}

/** True while a folder is set AND already writable without a further prompt. */
export async function outputFolderReady() {
  return !!(await writableHandle({ prompt: false }));
}

/**
 * Write `blob` into the output folder as `path`, which may name subfolders
 * ('renders/hero-left.png') — they are created as needed, because that is how a
 * package's own structure survives being written out loose.
 *
 * Returns the path written, or null if there is no usable folder, which is the
 * caller's cue to fall back to a Save-As dialog or a download.
 */
export async function writeToOutputFolder(blob, path) {
  const root = await writableHandle();
  if (!root) return null;
  const parts = String(path).split('/').filter(Boolean);
  const name = parts.pop();
  if (!name) return null;
  try {
    let dir = root;
    for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: true });
    const file = await dir.getFileHandle(name, { create: true });
    const writable = await file.createWritable();
    await writable.write(blob);
    await writable.close();
    return parts.length ? `${parts.join('/')}/${name}` : name;
  } catch {
    return null;              // folder deleted, drive unplugged, quota — fall back
  }
}
