import { WALLS, WALL_LABEL, OPENING_PRESETS } from './defaults.js';
import { fmtAllUnits, fmtFt, ROOF_STYLES, ROOF_STYLE_LABEL } from './build.js';

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

// ---------------------------------------------------------------------------
// Roof sections
// ---------------------------------------------------------------------------

const SECTION_NUMS = [
  ['Start ft', 'startFt', '0.5'],
  ['Front /12', 'frontPitch', '0.5'],
  ['Back /12', 'backPitch', '0.5'],
  ['Ridge off ft', 'ridgeOffsetFt', '0.25'],
  ['Ridge step ft', 'ridgeStepFt', '0.25'],
  ['Front eave ft', 'frontWallHeightFt', '0.25'],
  ['Back eave ft', 'backWallHeightFt', '0.25'],
];

/** "front peak 13'-2" · rear peak 11'-4"" — the numbers this section resolves to. */
function sectionReadout(sec) {
  const el = document.createElement('div');
  el.className = 'readout';
  if (!sec) {
    el.textContent = 'Too narrow to build — widen or remove this section.';
    return el;
  }
  const step = sec.backPeakY - sec.frontPeakY;
  const pitch = (s) => `${(s * 12).toFixed(1)}/12`;
  const stepNote = Math.abs(step) > 0.02
    ? ` · <b>${step > 0 ? 'rear' : 'front'} peak ${fmtFt(Math.abs(step))} higher</b>`
    : ' · peaks level';
  el.innerHTML =
    `front peak <b>${fmtFt(sec.frontPeakY)}</b> at ${pitch(sec.frontSlope)} · ` +
    `rear peak <b>${fmtFt(sec.backPeakY)}</b> at ${pitch(sec.backSlope)}${stepNote}<br>` +
    `eaves ${fmtFt(sec.frontEaveY)} front / ${fmtFt(sec.backEaveY)} rear · ` +
    `ridge ${sec.ridgeZ === 0 ? 'on center' : `${fmtFt(Math.abs(sec.ridgeZ))} ${sec.ridgeZ > 0 ? 'rear' : 'front'} of center`}`;
  return el;
}

/**
 * The roof-section editor. Rows map one-to-one onto `dim.roofSections`; when
 * that list is empty the roof is a single implicit section and we show it as a
 * read-only summary of the whole-home settings above.
 */
const sortedSpecs = (dim) => (Array.isArray(dim?.roofSections) ? dim.roofSections : [])
  .slice()
  .sort((a, b) => (a.startFt ?? 0) - (b.startFt ?? 0));

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
    const span = document.createElement('span');
    span.className = 'span';
    span.textContent = `0 – ${fmtFt(dim.lengthFt)}`;
    head.append(tag, name, span);
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
    lbl.addEventListener('input', () => { spec.label = lbl.value; cb.onEdit(false); });
    head.appendChild(lbl);

    const span = document.createElement('span');
    span.className = 'span';
    span.textContent = sec ? `${fmtFt(sec.startFt)} – ${fmtFt(sec.endFt)}` : '—';
    head.appendChild(span);
    card.appendChild(head);

    const grid = document.createElement('div');
    grid.className = 'grid4 sec-grid';
    for (const [name, key, step] of SECTION_NUMS) {
      const l = document.createElement('label');
      const s = document.createElement('span');
      s.textContent = name;
      const input = document.createElement('input');
      input.type = 'number';
      input.step = step;
      input.autocomplete = 'off';
      input.dataset.key = key;
      // Blank means "inherit from the whole-home settings", which is not the
      // same as zero — so the field has to be able to hold nothing at all.
      input.placeholder = key === 'startFt' ? '0' : 'Auto';
      input.value = spec[key] ?? '';
      if (key === 'startFt' && i === 0) {
        input.value = 0;
        input.disabled = true;
        input.title = 'The first section always starts at the left end';
      }
      input.addEventListener('input', () => {
        const raw = input.value.trim();
        if (raw === '') {
          spec[key] = key === 'startFt' ? 0 : null;
        } else {
          const v = parseFloat(raw);
          if (Number.isNaN(v)) return; // mid-typing
          spec[key] = v;
        }
        cb.onEdit(key === 'startFt');
      });
      l.append(s, input);
      grid.appendChild(l);
    }
    card.appendChild(grid);

    const foot = document.createElement('div');
    foot.className = 'foot';
    const styleSel = document.createElement('select');
    const inheritOpt = document.createElement('option');
    inheritOpt.value = '';
    inheritOpt.textContent = 'Roof style: inherit';
    styleSel.appendChild(inheritOpt);
    for (const v of ROOF_STYLES) {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = ROOF_STYLE_LABEL[v];
      styleSel.appendChild(opt);
    }
    styleSel.value = ROOF_STYLES.includes(spec.roofStyle) ? spec.roofStyle : '';
    styleSel.addEventListener('change', () => {
      spec.roofStyle = styleSel.value || null;
      cb.onEdit(true);
    });
    foot.appendChild(styleSel);

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'danger';
    del.textContent = '✕';
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
  if (!container) return;
  const byId = new Map(resolved.map((s) => [s.id, s]));
  const cards = container.querySelectorAll('.roof-section');
  const specs = sortedSpecs(dim);
  for (const card of cards) {
    const sec = card.dataset.id ? byId.get(card.dataset.id) : resolved[0];
    const old = card.querySelector('.readout');
    if (old) card.replaceChild(sectionReadout(sec), old);
    const span = card.querySelector('.span');
    if (span) span.textContent = sec ? `${fmtFt(sec.startFt)} – ${fmtFt(sec.endFt)}` : '—';
  }
  // A start offset can reorder the sections; when it does, the rows have to be
  // rebuilt rather than patched.
  const order = specs.map((s) => s.id).join(',');
  const shown = [...cards].map((c) => c.dataset.id).filter(Boolean).join(',');
  return order !== shown;
}

export function renderOpeningList(container, home, cb) {
  container.textContent = '';

  const selectedUnit = home.openings.find((o) => o.id === cb.selectedId);

  // If a unit is selected, render the Selected Unit Details card at the top of the sidebar!
  if (selectedUnit) {
    const topSec = document.createElement('div');
    topSec.className = 'selected-unit-section';

    const h = document.createElement('h3');
    h.textContent = 'Selected Unit Details';
    h.style.cssText = 'margin:6px 0 6px;font-size:11px;color:#6fb2ff;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;';
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
  allHeader.textContent = selectedUnit ? 'All Openings by Wall' : 'Openings';
  allHeader.style.cssText = 'margin:12px 0 6px;font-size:11px;color:#9aa2ad;font-weight:600;';
  container.appendChild(allHeader);

  for (const wall of WALLS) {
    const list = (byWall.get(wall) || []).slice().sort((a, b) => a.offsetFt - b.offsetFt);
    if (!list.length) continue;

    const h = document.createElement('div');
    h.textContent = WALL_LABEL[wall];
    h.style.cssText = 'margin:8px 0 4px;font-size:10px;color:#858d98;font-weight:600;text-transform:uppercase;';
    container.appendChild(h);

    for (const o of list) {
      if (selectedUnit && o.id === selectedUnit.id) continue;
      container.appendChild(row(o, cb));
    }
  }
  syncOpeningValues(container, home, cb.selectedId);
}

const MAT_LABELS = { concrete: '🧱 Concrete', pressure_treated: '🪵 Wood', dark_composite: '⬛ Composite' };
const EGRESS_LABELS = { front: '⬆ Front', left: '⬅ Left', right: '➡ Right', split: '↔ Split' };
const RAIL_MAT_LABELS = { pressure_treated: '🪵 Wood', white_trim: '⚪ White', black_metal: '⬛ Iron', matching_trim: '🎨 Trim' };
const BALUSTER_LABELS = { balusters: '║║ Spindles', horizontal_cables: '═ Cables', open: '🔓 Open' };

const MAT_ARR = ['concrete', 'pressure_treated', 'dark_composite'];
const EGRESS_ARR = ['front', 'left', 'right', 'split'];
const RAIL_MAT_ARR = ['pressure_treated', 'white_trim', 'black_metal', 'matching_trim'];
const BALUSTER_ARR = ['balusters', 'horizontal_cables', 'open'];

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
  for (const el of container.querySelectorAll('.opening')) {
    const o = home.openings.find((x) => x.id === el.dataset.id);
    if (!o) continue;
    el.classList.toggle('sel', o.id === selectedId);
    for (const input of el.querySelectorAll('input[data-key]')) {
      if (document.activeElement === input) continue; // never fight the user's cursor
      input.value = round(o[input.dataset.key]);
    }
    const lbl = el.querySelector('input.lbl');
    if (lbl && document.activeElement !== lbl) lbl.value = o.label || '';
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
    cb.onSelect(o.id);
  });

  const head = document.createElement('header');
  const tag = document.createElement('span');
  tag.className = 'tag' + (o.type === 'window' ? ' window' : '');
  tag.textContent = o.type;
  head.appendChild(tag);

  const lbl = document.createElement('input');
  lbl.className = 'lbl';
  lbl.type = 'text';
  lbl.autocomplete = 'off';
  lbl.placeholder = 'label';
  lbl.value = o.label || '';
  lbl.addEventListener('input', () => { o.label = lbl.value; cb.onEdit(o, false); });
  lbl.addEventListener('focus', () => cb.onSelect(o.id));
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
    i.addEventListener('focus', () => cb.onSelect(o.id));
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
    matSelect.addEventListener('focus', () => cb.onSelect(o.id));
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
    egressSelect.addEventListener('focus', () => cb.onSelect(o.id));
    egressSelect.addEventListener('change', () => {
      o.stepEgress = egressSelect.value;
      cb.onEdit(o, true);
    });
    egressLabel.append(egressSpan, egressSelect);
    subGrid.appendChild(egressLabel);

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
    railMatSelect.addEventListener('focus', () => cb.onSelect(o.id));
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
    balusterSelect.addEventListener('focus', () => cb.onSelect(o.id));
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
