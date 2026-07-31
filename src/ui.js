import { WALLS, WALL_LABEL, OPENING_PRESETS } from './defaults.js';
import { fmtAllUnits, fmtFt } from './build.js';

const TYPES = [['door', 'Door'], ['slider', 'Slider'], ['window', 'Window']];
const NUMS = [
  ['Offset ft', 'offsetFt'],
  ['Width ft', 'widthFt'],
  ['Height ft', 'heightFt'],
  ['Sill ft', 'sillFt'],
];

const round = (v) => Math.round((v ?? 0) * 100) / 100;

export function initAccordions() {
  document.querySelectorAll('.panel.collapsible .panel-header').forEach((header) => {
    header.addEventListener('click', () => {
      const panel = header.closest('.panel');
      const isOpen = panel.classList.toggle('open');
      const chevron = header.querySelector('.chevron');
      if (chevron) {
        chevron.textContent = isOpen ? '▲' : '▼';
      }
    });
  });
}

/** Ids in the current multi-selection, tolerating a caller that passes none. */
const selSet = (cb) => (cb && cb.selectedIds instanceof Set ? cb.selectedIds : new Set());

// ---------------------------------------------------------------------------
// Roof sections
// ---------------------------------------------------------------------------

const SECTION_NUMS = [
  ['Start ft', 'startFt', '0.5'],
  ['Front /12', 'pitch', '0.5'],
  ['Rear /12', 'pitchBack', '0.5'],
  ['Ridge off ft', 'ridgeOffsetFt', '0.25'],
  ['Ridge step ft', 'ridgeStepFt', '0.25'],
  ['Front eave ft', 'frontWallHeightFt', '0.25'],
  ['Rear eave ft', 'backWallHeightFt', '0.25'],
  ['Front set-in ft', 'frontInsetFt', '0.5'],
  ['Rear set-in ft', 'backInsetFt', '0.5'],
];

/** The numbers a section actually resolves to, printed under its fields. */
function sectionReadout(sec) {
  const el = document.createElement('div');
  el.className = 'readout';
  if (!sec) {
    el.textContent = 'Too narrow to build — widen or remove this section.';
    return el;
  }
  const pitch = (v) => `${(v * 12).toFixed(1)}/12`;
  const step = sec.ridgeStepFt;
  const bits = [
    `front <b>${pitch(sec.slopeFront)}</b> to ${fmtFt(sec.frontPeakY)}`,
    `rear <b>${pitch(sec.slopeBack)}</b> to ${fmtFt(sec.backPeakY)}`,
    Math.abs(step) > 0.02
      ? `<b>${step > 0 ? 'rear' : 'front'} peak ${fmtFt(Math.abs(step))} higher</b>`
      : 'peaks level',
  ];
  if (sec.ridgeSail) {
    bits.push(`${sec.ridgeSail > 0 ? 'front' : 'rear'} plane sails ${fmtFt(Math.abs(sec.ridgeSail))} to ${fmtFt(sec.topY)}`);
  }
  const plan = sec.inset
    ? ` &middot; <b>${fmtFt(sec.widthFt)} deep</b>${sec.frontInsetFt ? `, front ${sec.frontInsetFt > 0 ? 'set in' : 'out'} ${fmtFt(Math.abs(sec.frontInsetFt))}` : ''}${sec.backInsetFt ? `, rear ${sec.backInsetFt > 0 ? 'set in' : 'out'} ${fmtFt(Math.abs(sec.backInsetFt))}` : ''}`
    : '';
  el.innerHTML = `${bits.join(' &middot; ')}<br>eaves ${fmtFt(sec.eaveYFront)} front / ${fmtFt(sec.eaveYBack)} rear${plan}`;
  return el;
}

const sortedSpecs = (dim) => (Array.isArray(dim?.roofSections) ? dim.roofSections : [])
  .slice()
  .sort((a, b) => (a.startFt ?? 0) - (b.startFt ?? 0));

/**
 * The roof-section editor. Rows map one-to-one onto `dim.roofSections`; when
 * that list is empty the roof is a single implicit section and it shows as a
 * read-only summary of the whole-home settings above.
 */
export function renderRoofSectionList(container, dim, resolved, cb) {
  container.textContent = '';
  const specs = sortedSpecs(dim);
  const byId = new Map(resolved.map((s) => [s.id, s]));

  if (!specs.length) {
    const card = document.createElement('div');
    card.className = 'opening roof-section locked';
    const head = document.createElement('header');
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = 'whole roof';
    const name = document.createElement('span');
    name.textContent = 'One roof over the full length';
    name.style.cssText = 'flex:1;font-size:12px;';
    const sp = document.createElement('span');
    sp.className = 'span';
    sp.textContent = `0 – ${fmtFt(dim.lengthFt)}`;
    head.append(tag, name, sp);
    card.appendChild(head);
    card.appendChild(sectionReadout(resolved[0]));
    container.appendChild(card);
    return;
  }

  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i];
    const sec = byId.get(spec.id);
    const card = document.createElement('div');
    card.className = 'opening roof-section';
    card.dataset.id = spec.id;

    const head = document.createElement('header');
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = `S${i + 1}`;
    head.appendChild(tag);

    const lbl = document.createElement('input');
    lbl.className = 'lbl';
    lbl.type = 'text';
    lbl.autocomplete = 'off';
    lbl.placeholder = 'section label';
    lbl.value = spec.label || '';
    lbl.addEventListener('input', () => { spec.label = lbl.value; cb.onEdit(); });
    head.appendChild(lbl);

    const sp = document.createElement('span');
    sp.className = 'span';
    sp.textContent = sec ? `${fmtFt(sec.startFt)} – ${fmtFt(sec.endFt)}` : '—';
    head.appendChild(sp);
    card.appendChild(head);

    const grid = document.createElement('div');
    grid.className = 'grid4 sec-grid';
    for (const [name, key, step] of SECTION_NUMS) {
      const l = document.createElement('label');
      const t = document.createElement('span');
      t.textContent = name;
      const input = document.createElement('input');
      input.type = 'number';
      input.step = step;
      input.autocomplete = 'off';
      input.dataset.key = key;
      // Blank means "inherit the whole-home value", which is not the same as
      // zero — so the field has to be able to hold nothing at all.
      input.placeholder = key === 'startFt' ? '0' : 'Auto';
      input.value = spec[key] ?? '';
      if (key === 'startFt' && i === 0) {
        input.value = 0;
        input.disabled = true;
        input.title = 'The first section always starts at the left end';
      }
      input.addEventListener('input', () => {
        const raw = input.value.trim();
        if (raw === '') spec[key] = key === 'startFt' ? 0 : null;
        else {
          const v = parseFloat(raw);
          if (Number.isNaN(v)) return; // mid-typing
          spec[key] = v;
        }
        cb.onEdit();
      });
      l.append(t, input);
      grid.appendChild(l);
    }
    card.appendChild(grid);

    const foot = document.createElement('div');
    foot.className = 'foot';
    const styleSel = document.createElement('select');
    for (const [v, text] of [['', 'Roof style: inherit'], ['gable', 'Gable'], ['flat', 'Flat / low slope']]) {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = text;
      styleSel.appendChild(opt);
    }
    styleSel.value = spec.roofStyle || '';
    styleSel.addEventListener('change', () => { spec.roofStyle = styleSel.value || null; cb.onEdit(); });
    foot.appendChild(styleSel);

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'danger';
    del.textContent = '\u2715';
    del.title = 'Remove this section';
    del.addEventListener('click', () => cb.onDelete(spec.id));
    foot.appendChild(del);
    card.appendChild(foot);

    card.appendChild(sectionReadout(sec));
    container.appendChild(card);
  }
}

/** Refresh each card's resolved numbers in place, leaving the inputs alone. */
export function syncRoofSectionReadouts(container, resolved, dim) {
  if (!container) return false;
  const byId = new Map(resolved.map((s) => [s.id, s]));
  const cards = container.querySelectorAll('.roof-section');
  for (const card of cards) {
    const sec = card.dataset.id ? byId.get(card.dataset.id) : resolved[0];
    const old = card.querySelector('.readout');
    if (old) card.replaceChild(sectionReadout(sec), old);
    const sp = card.querySelector('.span');
    if (sp) sp.textContent = sec ? `${fmtFt(sec.startFt)} – ${fmtFt(sec.endFt)}` : '—';
  }
  // A start offset can reorder the sections; when it does the rows have to be
  // rebuilt rather than patched.
  const order = sortedSpecs(dim).map((s) => s.id).join(',');
  const shown = [...cards].map((c) => c.dataset.id).filter(Boolean).join(',');
  return order !== shown;
}

export function renderOpeningList(container, home, cb) {
  container.textContent = '';

  const ids = selSet(cb);
  const groupUnits = home.openings.filter((o) => ids.has(o.id));
  const selectedUnit = home.openings.find((o) => o.id === cb.selectedId);

  // Two or more units selected -> the group editor replaces the single-unit card.
  if (groupUnits.length > 1) {
    const topSec = document.createElement('div');
    topSec.className = 'selected-unit-section';

    const h = document.createElement('h3');
    h.className = 'subhead group';
    h.textContent = `Group edit — ${groupUnits.length} selected`;
    topSec.appendChild(h);
    topSec.appendChild(renderGroupCard(groupUnits, cb));
    container.appendChild(topSec);
  }

  // If a single unit is selected, render the Selected Unit Details card at the top of the sidebar!
  if (selectedUnit && groupUnits.length <= 1) {
    const topSec = document.createElement('div');
    topSec.className = 'selected-unit-section';

    const h = document.createElement('h3');
    h.className = 'subhead';
    h.textContent = 'Selected unit';
    topSec.appendChild(h);

    const card = renderSelectedUnitCard(selectedUnit, cb);
    topSec.appendChild(card);
    container.appendChild(topSec);
  }

  const byWall = new Map(WALLS.map((w) => [w, []]));
  for (const o of home.openings) {
    if (!byWall.has(o.wall)) byWall.set(o.wall, []);
    byWall.get(o.wall).push(o);
  }

  const allHeader = document.createElement('h3');
  allHeader.className = 'subhead';
  allHeader.textContent = selectedUnit ? 'All openings by wall' : 'All openings';
  container.appendChild(allHeader);

  for (const wall of WALLS) {
    const list = (byWall.get(wall) || []).slice().sort((a, b) => a.offsetFt - b.offsetFt);
    if (!list.length) continue;

    const h = document.createElement('div');
    h.className = 'wall-head';
    h.textContent = WALL_LABEL[wall];
    container.appendChild(h);

    for (const o of list) {
      if (groupUnits.length <= 1 && selectedUnit && o.id === selectedUnit.id) continue;
      container.appendChild(row(o, cb));
    }
  }
  syncOpeningValues(container, home, cb.selectedId, cb);
}

const MAT_LABELS = { concrete: '🧱 Concrete', pressure_treated: '🪵 Wood', dark_composite: '⬛ Composite' };
const EGRESS_LABELS = { front: '⬆ Front', left: '⬅ Left', right: '➡ Right', split: '↔ Split' };
const RAIL_MAT_LABELS = { pressure_treated: '🪵 Wood', white_trim: '⚪ White', black_metal: '⬛ Iron', matching_trim: '🎨 Trim' };
const BALUSTER_LABELS = { balusters: '║║ Spindles', horizontal_cables: '═ Cables', open: '🔓 Open' };
const RAILINGS_LABELS = { both: '↔ Both & Outer', outer: '🛡️ Outer (Away Side)', all: '🏰 Full Surround', left: '⬅ Left Side', right: '➡ Right Side', none: '🚫 None' };

const MAT_ARR = ['concrete', 'pressure_treated', 'dark_composite'];
const EGRESS_ARR = ['front', 'left', 'right', 'split'];
const RAIL_MAT_ARR = ['pressure_treated', 'white_trim', 'black_metal', 'matching_trim'];
const BALUSTER_ARR = ['balusters', 'horizontal_cables', 'open'];
const RAILINGS_ARR = ['both', 'outer', 'all', 'left', 'right', 'none'];

function cycleNext(arr, current) {
  const idx = arr.indexOf(current || arr[0]);
  return arr[(idx + 1) % arr.length];
}

function buildSummaryPills(summaryEl, o, cb) {
  summaryEl.textContent = '';

  const createPill = (lblText, valText, onClick) => {
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'summary-pill';
    pill.title = 'Click to edit or cycle setting';
    pill.innerHTML = `<span class="pill-lbl">${lblText}:</span> <span class="pill-val">${valText}</span>`;
    pill.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
    });
    return pill;
  };

  summaryEl.appendChild(createPill('Width', fmtAllUnits(o.widthFt), () => {
    const rowEl = summaryEl.closest('.selected-card')?.querySelector('.opening');
    const input = rowEl?.querySelector('input[data-key="widthFt"]');
    if (input) input.focus();
  }));

  summaryEl.appendChild(createPill('Height', fmtAllUnits(o.heightFt), () => {
    const rowEl = summaryEl.closest('.selected-card')?.querySelector('.opening');
    const input = rowEl?.querySelector('input[data-key="heightFt"]');
    if (input) input.focus();
  }));

  summaryEl.appendChild(createPill('Offset', fmtAllUnits(o.offsetFt), () => {
    const rowEl = summaryEl.closest('.selected-card')?.querySelector('.opening');
    const input = rowEl?.querySelector('input[data-key="offsetFt"]');
    if (input) input.focus();
  }));

  summaryEl.appendChild(createPill('Sill', fmtAllUnits(o.sillFt), () => {
    const rowEl = summaryEl.closest('.selected-card')?.querySelector('.opening');
    const input = rowEl?.querySelector('input[data-key="sillFt"]');
    if (input) input.focus();
  }));

  if (o.type === 'door' || o.type === 'slider') {
    const stMat = o.stepMat || 'concrete';
    summaryEl.appendChild(createPill('Stair Mat', MAT_LABELS[stMat] || stMat, () => {
      o.stepMat = cycleNext(MAT_ARR, stMat);
      cb.onEdit(o, true);
    }));

    const egr = o.stepEgress || 'front';
    summaryEl.appendChild(createPill('Egress', EGRESS_LABELS[egr] || egr, () => {
      o.stepEgress = cycleNext(EGRESS_ARR, egr);
      cb.onEdit(o, true);
    }));

    const rPlacement = o.stepRailings || 'both';
    summaryEl.appendChild(createPill('Railings', RAILINGS_LABELS[rPlacement] || rPlacement, () => {
      o.stepRailings = cycleNext(RAILINGS_ARR, rPlacement);
      cb.onEdit(o, true);
    }));

    const rMat = o.railMat || 'pressure_treated';
    summaryEl.appendChild(createPill('Rail Mat', RAIL_MAT_LABELS[rMat] || rMat, () => {
      o.railMat = cycleNext(RAIL_MAT_ARR, rMat);
      cb.onEdit(o, true);
    }));

    const bal = o.balusterStyle || 'balusters';
    summaryEl.appendChild(createPill('Balusters', BALUSTER_LABELS[bal] || bal, () => {
      o.balusterStyle = cycleNext(BALUSTER_ARR, bal);
      cb.onEdit(o, true);
    }));
  }
}

// --------------------------------------------------------------------------
// Group edit card
// --------------------------------------------------------------------------

/** Shared value of `key` across the selection, or null when the units differ. */
function commonValue(list, key) {
  const first = round(list[0][key]);
  return list.every((o) => round(o[key]) === first) ? first : null;
}

/** Shared raw value of `key` (strings, booleans), or undefined when mixed. */
function commonRaw(list, key, fallback) {
  const first = list[0][key] ?? fallback;
  return list.every((o) => (o[key] ?? fallback) === first) ? first : undefined;
}

function groupButton(label, title, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.title = title;
  b.addEventListener('click', onClick);
  return b;
}

/** Select whose first entry means "leave each unit as it is". */
function mixedSelect(entries, current, keepLabel, onChange) {
  const sel = document.createElement('select');
  const keep = document.createElement('option');
  keep.value = '';
  keep.textContent = keepLabel;
  sel.appendChild(keep);
  for (const [v, name] of entries) {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = name;
    sel.appendChild(opt);
  }
  sel.value = current === undefined ? '' : current;
  sel.addEventListener('change', () => {
    if (!sel.value) return;
    onChange(sel.value);
  });
  return sel;
}

function renderGroupCard(list, cb) {
  const card = document.createElement('div');
  card.className = 'selected-card group-card';

  const doors = list.filter((o) => o.type !== 'window').length;
  const head = document.createElement('div');
  head.className = 'group-head';
  const title = document.createElement('span');
  title.textContent = `${doors} door/slider · ${list.length - doors} window`;
  head.appendChild(title);
  head.appendChild(groupButton('Clear', 'Deselect everything', () => cb.onClearSelection?.()));
  card.appendChild(head);

  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.style.cssText = 'margin:0 0 6px;font-size:10px;';
  hint.textContent = 'Typing a number sets it on every selected unit. ± buttons shift each unit by that amount. Align / match use the last-clicked unit as the anchor.';
  card.appendChild(hint);

  // Absolute values — blank means the units currently disagree.
  const grid = document.createElement('div');
  grid.className = 'grid4';
  for (const [name, key] of NUMS) {
    const l = document.createElement('label');
    const s = document.createElement('span');
    s.textContent = name;
    const i = document.createElement('input');
    i.type = 'number';
    i.step = '0.25';
    i.autocomplete = 'off';
    i.dataset.gkey = key;
    if (key === 'heightFt') i.setAttribute('list', 'heightPresets');
    else if (key === 'widthFt') i.setAttribute('list', 'widthPresets');
    const cv = commonValue(list, key);
    if (cv === null) { i.value = ''; i.placeholder = 'mixed'; } else i.value = cv;
    i.addEventListener('input', () => {
      const v = parseFloat(i.value);
      if (Number.isNaN(v)) return; // mid-typing — wait for a real number
      cb.onGroupEdit((o) => { o[key] = v; }, true);
    });
    l.append(s, i);
    grid.appendChild(l);
  }
  card.appendChild(grid);

  // Relative nudges — keep the units' existing spread, move the whole set.
  for (const [label, key] of [['Offset', 'offsetFt'], ['Sill', 'sillFt']]) {
    const nudge = document.createElement('div');
    nudge.className = 'group-nudge';
    const cap = document.createElement('span');
    cap.textContent = `${label} shift`;
    nudge.appendChild(cap);
    for (const d of [-1, -0.25, 0.25, 1]) {
      const txt = `${d > 0 ? '+' : '−'}${Math.abs(d)}`;
      nudge.appendChild(groupButton(txt, `Shift every selected ${label.toLowerCase()} by ${d} ft`, () => {
        cb.onGroupEdit((o) => { o[key] = Math.max(key === 'sillFt' ? 0 : -1e6, (+o[key] || 0) + d); }, true);
      }));
    }
    card.appendChild(nudge);
  }

  // Wall / type / head alignment for the whole set.
  const foot = document.createElement('div');
  foot.className = 'foot';
  foot.appendChild(mixedSelect(
    WALLS.map((w) => [w, WALL_LABEL[w]]),
    commonRaw(list, 'wall', 'front'),
    '— move to wall —',
    (v) => cb.onGroupRestructure((o) => { o.wall = v; }),
  ));
  foot.appendChild(mixedSelect(
    TYPES,
    commonRaw(list, 'type', 'window'),
    '— set type —',
    (v) => cb.onGroupRestructure((o) => {
      const oldPreset = OPENING_PRESETS[o.type];
      const preset = OPENING_PRESETS[v];
      o.type = v;
      if (!preset) return;
      o.widthFt = preset.widthFt;
      o.heightFt = preset.heightFt;
      o.sillFt = preset.sillFt;
      if (!o.label || (oldPreset && o.label === oldPreset.label)) o.label = preset.label;
    }),
  ));

  const freeLabel = document.createElement('label');
  freeLabel.className = 'check';
  freeLabel.title = 'Ignore the global opening head drop for every selected unit';
  freeLabel.style.cssText = 'display:flex;align-items:center;gap:3px;font-size:10px;white-space:nowrap;';
  const freeBox = document.createElement('input');
  freeBox.type = 'checkbox';
  const freeCommon = commonRaw(list, 'headFree', false);
  freeBox.checked = freeCommon === true;
  freeBox.indeterminate = freeCommon === undefined;
  freeBox.addEventListener('change', () => {
    const v = freeBox.checked;
    cb.onGroupEdit((o) => { o.headFree = v; }, true);
  });
  const freeText = document.createElement('span');
  freeText.textContent = 'Free head';
  freeLabel.append(freeBox, freeText);
  foot.appendChild(freeLabel);
  card.appendChild(foot);

  // Alignment / distribution / bulk duplicate + delete.
  const acts = document.createElement('div');
  acts.className = 'group-actions';
  const act = (label, name, title) => acts.appendChild(groupButton(label, title, () => cb.onGroupAction(name)));
  act('⊤ Align heads', 'alignTop', 'Match every head height to the anchor');
  act('⊥ Align sills', 'alignSill', 'Match every sill height to the anchor');
  act('⊢ Align offsets', 'alignLeft', 'Match every left edge to the anchor');
  act('⊕ Align centers', 'alignCenter', 'Center every unit on the anchor centerline');
  act('↔ Even spacing', 'distribute', 'Equalise the gaps between units on each wall');
  act('⇔ Match width', 'matchWidth', 'Match every width to the anchor');
  act('⇕ Match height', 'matchHeight', 'Match every height to the anchor');
  act('⧉ Duplicate all', 'duplicate', 'Duplicate every selected unit');
  const del = groupButton('✕ Delete all', 'Delete every selected unit', () => cb.onGroupAction('delete'));
  del.className = 'danger';
  acts.appendChild(del);
  card.appendChild(acts);

  // Stair / railing settings, shown when the set contains a door or slider.
  if (doors) {
    const sub = document.createElement('div');
    sub.className = 'stair-custom-sub';
    sub.style.cssText = 'margin-top:6px;padding-top:6px;border-top:1px solid rgba(255,255,255,0.08);';

    const subTitle = document.createElement('div');
    subTitle.style.cssText = 'font-size:10px;color:#ffd479;font-weight:600;margin-bottom:4px;text-transform:uppercase;';
    subTitle.textContent = `Stair & Deck — applies to ${doors} door/slider`;
    sub.appendChild(subTitle);

    const subGrid = document.createElement('div');
    subGrid.className = 'grid2';
    const doorUnits = list.filter((o) => o.type !== 'window');
    const addSel = (name, key, entries, fallback) => {
      const l = document.createElement('label');
      const s = document.createElement('span');
      s.textContent = name;
      l.append(s, mixedSelect(entries, commonRaw(doorUnits, key, fallback), '— keep —', (v) => {
        cb.onGroupEdit((o) => { if (o.type !== 'window') o[key] = v; }, true);
      }));
      subGrid.appendChild(l);
    };
    addSel('Include Stairs', 'steps', [['true', 'Yes (Build stairs)'], ['false', 'No (No stairs)']], 'true');
    addSel('Stair Material', 'stepMat', MAT_ARR.map((v) => [v, MAT_LABELS[v]]), 'concrete');
    addSel('Egress Direction', 'stepEgress', EGRESS_ARR.map((v) => [v, EGRESS_LABELS[v]]), 'front');
    addSel('Stair Railings', 'stepRailings', RAILINGS_ARR.map((v) => [v, RAILINGS_LABELS[v]]), 'both');
    addSel('Railing Material', 'railMat', RAIL_MAT_ARR.map((v) => [v, RAIL_MAT_LABELS[v]]), 'pressure_treated');
    addSel('Balusters / Infill', 'balusterStyle', BALUSTER_ARR.map((v) => [v, BALUSTER_LABELS[v]]), 'balusters');
    sub.appendChild(subGrid);
    card.appendChild(sub);
  }

  return card;
}

function renderSelectedUnitCard(o, cb) {
  const card = document.createElement('div');
  card.className = 'selected-card';

  const summary = document.createElement('div');
  summary.className = 'unit-summary';

  buildSummaryPills(summary, o, cb);

  card.appendChild(summary);
  const r = row(o, cb);
  card.appendChild(r);
  return card;
}

/** Push current values into the existing rows without rebuilding them. */
export function syncOpeningValues(container, home, selectedId, cb) {
  const ids = selSet(cb);
  for (const el of container.querySelectorAll('.opening')) {
    const o = home.openings.find((x) => x.id === el.dataset.id);
    if (!o) continue;
    el.classList.toggle('sel', o.id === selectedId);
    el.classList.toggle('ingroup', ids.size > 1 && ids.has(o.id));
    const pick = el.querySelector('input.pick');
    if (pick) pick.checked = ids.has(o.id);
    for (const input of el.querySelectorAll('input[data-key]')) {
      if (document.activeElement === input) continue; // never fight the user's cursor
      input.value = round(o[input.dataset.key]);
    }
    for (const sel of el.querySelectorAll('select[data-key]')) {
      if (document.activeElement === sel) continue;
      const key = sel.dataset.key;
      if (o[key] !== undefined) sel.value = o[key];
    }
    const lbl = el.querySelector('input.lbl');
    if (lbl && document.activeElement !== lbl) lbl.value = o.label || '';
  }

  // Group card: refresh the shared values, but never fight a focused field.
  const groupUnits = home.openings.filter((o) => ids.has(o.id));
  if (groupUnits.length > 1) {
    for (const input of container.querySelectorAll('input[data-gkey]')) {
      if (document.activeElement === input) continue;
      const cv = commonValue(groupUnits, input.dataset.gkey);
      if (cv === null) { input.value = ''; input.placeholder = 'mixed'; } else input.value = cv;
    }
  }

  for (const card of container.querySelectorAll('.selected-card')) {
    const rowEl = card.querySelector('.opening');
    if (!rowEl) continue;
    const o = home.openings.find((x) => x.id === rowEl.dataset.id);
    if (!o) continue;
    const summary = card.querySelector('.unit-summary');
    if (summary && cb) {
      buildSummaryPills(summary, o, cb);
    }
  }
}

function row(o, cb) {
  const el = document.createElement('div');
  el.className = 'opening';
  el.dataset.id = o.id;
  // Select on pointerdown, but only when the click is on the row chrome — never
  // swallow interaction with the controls inside it.
  el.addEventListener('pointerdown', (e) => {
    if (e.target.closest('input, select, button')) return;
    // Ctrl/Cmd or Shift extends the selection instead of replacing it.
    cb.onSelect(o.id, e.ctrlKey || e.metaKey || e.shiftKey ? 'toggle' : 'replace');
  });

  const head = document.createElement('header');

  // Checkbox is the explicit, mouse-only way to build a group selection.
  const pick = document.createElement('input');
  pick.type = 'checkbox';
  pick.className = 'pick';
  pick.title = 'Include in group selection';
  pick.checked = selSet(cb).has(o.id);
  pick.addEventListener('change', () => cb.onSelect(o.id, 'toggle'));
  head.appendChild(pick);

  const tag = document.createElement('span');
  tag.className = `tag ${o.type}`;
  tag.textContent = o.type;
  head.appendChild(tag);

  const lbl = document.createElement('input');
  lbl.className = 'lbl';
  lbl.type = 'text';
  lbl.autocomplete = 'off';
  lbl.placeholder = 'label';
  lbl.value = o.label || '';
  lbl.addEventListener('input', () => { o.label = lbl.value; cb.onEdit(o, false); });
  lbl.addEventListener('focus', () => cb.onSelect(o.id, 'anchor'));
  head.appendChild(lbl);
  el.appendChild(head);

  const grid = document.createElement('div');
  grid.className = 'grid4';
  for (const [name, key] of NUMS) {
    const l = document.createElement('label');
    const s = document.createElement('span');
    s.textContent = name;
    const i = document.createElement('input');
    i.type = 'number';
    i.step = '0.25';
    i.autocomplete = 'off';
    i.dataset.key = key;
    if (key === 'heightFt') {
      i.setAttribute('list', 'heightPresets');
    } else if (key === 'widthFt') {
      i.setAttribute('list', 'widthPresets');
    }
    i.value = round(o[key]);
    i.addEventListener('focus', () => cb.onSelect(o.id, 'anchor'));
    i.addEventListener('input', () => {
      const v = parseFloat(i.value);
      if (Number.isNaN(v)) return; // mid-typing ("", "-", "3.") — wait for a real number
      o[key] = v;
      cb.onEdit(o, true);
    });
    l.append(s, i);
    grid.appendChild(l);
  }
  el.appendChild(grid);

  const foot = document.createElement('div');
  foot.className = 'foot';

  const wsel = document.createElement('select');
  for (const w of WALLS) {
    const opt = document.createElement('option');
    opt.value = w; opt.textContent = WALL_LABEL[w];
    if (w === o.wall) opt.selected = true;
    wsel.appendChild(opt);
  }
  wsel.addEventListener('change', () => { o.wall = wsel.value; cb.onRestructure(o.id); });
  foot.appendChild(wsel);

  const tsel = document.createElement('select');
  for (const [v, name] of TYPES) {
    const opt = document.createElement('option');
    opt.value = v; opt.textContent = name;
    if (v === o.type) opt.selected = true;
    tsel.appendChild(opt);
  }
  tsel.addEventListener('change', () => {
    const oldPreset = OPENING_PRESETS[o.type];
    const newType = tsel.value;
    const newPreset = OPENING_PRESETS[newType];
    o.type = newType;
    if (newPreset) {
      o.widthFt = newPreset.widthFt;
      o.heightFt = newPreset.heightFt;
      o.sillFt = newPreset.sillFt;
      if (!o.label || (oldPreset && o.label === oldPreset.label)) {
        o.label = newPreset.label;
      }
    }
    cb.onRestructure(o.id);
  });
  foot.appendChild(tsel);

  // Opt this opening out of the global head alignment so it keeps the sill and
  // height the user set by hand.
  const freeLabel = document.createElement('label');
  freeLabel.className = 'check';
  freeLabel.title = 'Ignore the global opening head drop for this unit';
  freeLabel.style.cssText = 'display:flex;align-items:center;gap:3px;font-size:10px;white-space:nowrap;';
  const freeBox = document.createElement('input');
  freeBox.type = 'checkbox';
  freeBox.checked = !!o.headFree;
  freeBox.addEventListener('change', () => { o.headFree = freeBox.checked; cb.onEdit(o, true); });
  const freeText = document.createElement('span');
  freeText.textContent = 'Free head';
  freeLabel.appendChild(freeBox);
  freeLabel.appendChild(freeText);
  foot.appendChild(freeLabel);

  const dup = document.createElement('button');
  dup.type = 'button';
  dup.textContent = '⧉';
  dup.title = 'Duplicate';
  dup.addEventListener('click', () => cb.onDuplicate(o.id));
  foot.appendChild(dup);

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'danger';
  del.textContent = '✕';
  del.title = 'Delete';
  del.addEventListener('click', () => cb.onDelete(o.id));
  foot.appendChild(del);

  el.appendChild(foot);

  if (o.type === 'door' || o.type === 'slider') {
    const sub = document.createElement('div');
    sub.className = 'stair-custom-sub';
    sub.style.cssText = 'margin-top:6px;padding-top:6px;border-top:1px solid rgba(255,255,255,0.08);';

    const subTitle = document.createElement('div');
    subTitle.style.cssText = 'font-size:10px;color:#6fb2ff;font-weight:600;margin-bottom:4px;text-transform:uppercase;';
    subTitle.textContent = 'Individual Stair & Deck Settings';
    sub.appendChild(subTitle);

    const subGrid = document.createElement('div');
    subGrid.className = 'grid2';

    const stepsLabel = document.createElement('label');
    const stepsSpan = document.createElement('span');
    stepsSpan.textContent = 'Include Stairs';
    const stepsSelect = document.createElement('select');
    stepsSelect.dataset.key = 'steps';
    stepsSelect.innerHTML = `
      <option value="true">Yes (Build stairs)</option>
      <option value="false">No (No stairs)</option>
    `;
    stepsSelect.value = o.steps === false ? 'false' : 'true';
    stepsSelect.addEventListener('focus', () => cb.onSelect(o.id, 'anchor'));
    stepsSelect.addEventListener('change', () => {
      o.steps = stepsSelect.value === 'true';
      cb.onEdit(o, true);
    });
    stepsLabel.append(stepsSpan, stepsSelect);
    subGrid.appendChild(stepsLabel);

    const matLabel = document.createElement('label');
    const matSpan = document.createElement('span');
    matSpan.textContent = 'Stair Material';
    const matSelect = document.createElement('select');
    matSelect.dataset.key = 'stepMat';
    matSelect.innerHTML = `
      <option value="concrete">Concrete (Masonry)</option>
      <option value="pressure_treated">Pressure-Treated Wood</option>
      <option value="dark_composite">Dark Composite</option>
    `;
    matSelect.value = o.stepMat || 'concrete';
    matSelect.addEventListener('focus', () => cb.onSelect(o.id, 'anchor'));
    matSelect.addEventListener('change', () => {
      o.stepMat = matSelect.value;
      cb.onEdit(o, true);
    });
    matLabel.append(matSpan, matSelect);
    subGrid.appendChild(matLabel);

    const egressLabel = document.createElement('label');
    const egressSpan = document.createElement('span');
    egressSpan.textContent = 'Egress Direction';
    const egressSelect = document.createElement('select');
    egressSelect.dataset.key = 'stepEgress';
    egressSelect.innerHTML = `
      <option value="front">Front / Straight out</option>
      <option value="left">Left side egress</option>
      <option value="right">Right side egress</option>
      <option value="split">Split (Both sides)</option>
    `;
    egressSelect.value = o.stepEgress || 'front';
    egressSelect.addEventListener('focus', () => cb.onSelect(o.id, 'anchor'));
    egressSelect.addEventListener('change', () => {
      o.stepEgress = egressSelect.value;
      cb.onEdit(o, true);
    });
    egressLabel.append(egressSpan, egressSelect);
    subGrid.appendChild(egressLabel);

    const railingsLabel = document.createElement('label');
    const railingsSpan = document.createElement('span');
    railingsSpan.textContent = 'Stair Railings';
    const railingsSelect = document.createElement('select');
    railingsSelect.dataset.key = 'stepRailings';
    railingsSelect.innerHTML = `
      <option value="both">Both sides &amp; outer</option>
      <option value="outer">Outer side away from house</option>
      <option value="all">Full surround (All sides)</option>
      <option value="left">Left side only</option>
      <option value="right">Right side only</option>
      <option value="none">None</option>
    `;
    railingsSelect.value = o.stepRailings || 'both';
    railingsSelect.addEventListener('focus', () => cb.onSelect(o.id, 'anchor'));
    railingsSelect.addEventListener('change', () => {
      o.stepRailings = railingsSelect.value;
      cb.onEdit(o, true);
    });
    railingsLabel.append(railingsSpan, railingsSelect);
    subGrid.appendChild(railingsLabel);

    const railMatLabel = document.createElement('label');
    const railMatSpan = document.createElement('span');
    railMatSpan.textContent = 'Railing Material';
    const railMatSelect = document.createElement('select');
    railMatSelect.dataset.key = 'railMat';
    railMatSelect.innerHTML = `
      <option value="pressure_treated">Pressure-Treated Wood</option>
      <option value="white_trim">Classic White Wood</option>
      <option value="black_metal">Black Wrought Iron</option>
      <option value="matching_trim">Matching House Trim</option>
    `;
    railMatSelect.value = o.railMat || 'pressure_treated';
    railMatSelect.addEventListener('focus', () => cb.onSelect(o.id, 'anchor'));
    railMatSelect.addEventListener('change', () => {
      o.railMat = railMatSelect.value;
      cb.onEdit(o, true);
    });
    railMatLabel.append(railMatSpan, railMatSelect);
    subGrid.appendChild(railMatLabel);

    const balusterLabel = document.createElement('label');
    const balusterSpan = document.createElement('span');
    balusterSpan.textContent = 'Balusters / Infill';
    const balusterSelect = document.createElement('select');
    balusterSelect.dataset.key = 'balusterStyle';
    balusterSelect.innerHTML = `
      <option value="balusters">Vertical Balusters (4" spacing)</option>
      <option value="horizontal_cables">Horizontal Cable Railing</option>
      <option value="open">Open Post &amp; Rail</option>
    `;
    balusterSelect.value = o.balusterStyle || 'balusters';
    balusterSelect.addEventListener('focus', () => cb.onSelect(o.id, 'anchor'));
    balusterSelect.addEventListener('change', () => {
      o.balusterStyle = balusterSelect.value;
      cb.onEdit(o, true);
    });
    balusterLabel.append(balusterSpan, balusterSelect);
    subGrid.appendChild(balusterLabel);

    sub.appendChild(subGrid);
    el.appendChild(sub);
  }

  return el;
}
