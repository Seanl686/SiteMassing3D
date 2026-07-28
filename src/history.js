// Undo / redo stack for the project state.
//
// The module is deliberately DOM-free: it stores whatever plain-object snapshots
// the caller hands it, so it can be unit-tested and so the caller stays in
// charge of what a "snapshot" contains (see snapshotState() in main.js, which
// keeps image data URLs out of the stack by reference).

const clone = (v) => JSON.parse(JSON.stringify(v));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** "roofPitch" -> "roof pitch", "widthFt" -> "width". */
function humanKey(key) {
  return String(key)
    .replace(/Ft$/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase();
}

/** First key whose value differs between two flat-ish objects. */
function firstDiffKey(a = {}, b = {}) {
  for (const key of new Set([...Object.keys(a || {}), ...Object.keys(b || {})])) {
    if (!same(a?.[key], b?.[key])) return key;
  }
  return null;
}

/**
 * What a snapshot changed, used both for the button tooltips and — because
 * record() only merges consecutive edits carrying the SAME label — to decide
 * what counts as one undo step. Naming the individual field is what keeps
 * dragging one slider to a single step while two different fields edited in
 * quick succession stay separate.
 */
export function describeChange(prev, next) {
  if (!prev || !next) return 'edit';
  const sections = [
    ['openings', (s) => s.home?.openings, false],
    ['', (s) => s.home?.dimensions, true],
    ['colour', (s) => s.home?.colors, true],
    ['site photo', (s) => s.home?.sitePhoto, true],
    ['floor plan', (s) => s.home?.plan, true],
    ['model name', (s) => s.home?.name, false],
    ['scene', (s) => s.scene, true],
  ];
  for (const [label, pick, byField] of sections) {
    const a = pick(prev), b = pick(next);
    if (same(a, b)) continue;
    if (!byField) return label;
    const key = firstDiffKey(a, b);
    if (!key) return label || 'edit';
    return label ? `${humanKey(key)} ${label}` : humanKey(key);
  }
  return 'edit';
}

export class History {
  /**
   * `limit` caps the stack; `coalesceMs` merges consecutive edits that carry the
   * same label, so dragging a slider lands as one undo step rather than forty.
   */
  constructor({ limit = 80, coalesceMs = 600, now = () => Date.now() } = {}) {
    this.limit = Math.max(2, limit);
    this.coalesceMs = coalesceMs;
    this.now = now;
    this.entries = [];   // [{ snapshot, label, at }], oldest first
    this.index = -1;     // position of the current state within entries
  }

  /** Seed the stack with the state the app opened with. Clears any history. */
  reset(snapshot, label = 'opened') {
    this.entries = [{ snapshot: clone(snapshot), label, at: this.now() }];
    this.index = 0;
  }

  get current() {
    return this.index >= 0 ? this.entries[this.index].snapshot : null;
  }

  get canUndo() { return this.index > 0; }
  get canRedo() { return this.index >= 0 && this.index < this.entries.length - 1; }

  /** Label of the step an undo would take back, or null. */
  peekUndo() { return this.canUndo ? this.entries[this.index].label : null; }
  /** Label of the step a redo would re-apply, or null. */
  peekRedo() { return this.canRedo ? this.entries[this.index + 1].label : null; }

  /**
   * Record a new state. Returns true when the stack changed.
   *
   * A snapshot identical to the current one is ignored, so the app can call this
   * from its generic save path without every no-op save adding a step. Recording
   * after an undo drops the redo tail, which is what every editor does.
   */
  record(snapshot, label = 'edit') {
    if (this.index < 0) { this.reset(snapshot, label); return true; }
    const head = this.entries[this.index];
    if (same(head.snapshot, snapshot)) return false;

    const at = this.now();
    if (label === head.label && at - head.at < this.coalesceMs && this.index > 0) {
      head.snapshot = clone(snapshot);
      head.at = at;
      this.entries.length = this.index + 1; // a coalesced edit still kills the redo tail
      return true;
    }

    this.entries.length = this.index + 1;
    this.entries.push({ snapshot: clone(snapshot), label, at });
    if (this.entries.length > this.limit) this.entries.shift();
    this.index = this.entries.length - 1;
    return true;
  }

  /** Step back. Returns { snapshot, label } for the state to apply, or null. */
  undo() {
    if (!this.canUndo) return null;
    const undone = this.entries[this.index].label;
    this.index -= 1;
    return { snapshot: clone(this.entries[this.index].snapshot), label: undone };
  }

  /** Step forward. Returns { snapshot, label }, or null. */
  redo() {
    if (!this.canRedo) return null;
    this.index += 1;
    const entry = this.entries[this.index];
    return { snapshot: clone(entry.snapshot), label: entry.label };
  }

  /** Every snapshot still reachable — used to prune the image pool. */
  snapshots() {
    return this.entries.map((e) => e.snapshot);
  }

  get size() { return this.entries.length; }
  get position() { return this.index; }
}
