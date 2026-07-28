import { WALLS, WALL_LABEL, OPENING_PRESETS } from './defaults.js';
import { fmtAllUnits } from './build.js';

const TYPES = [['door', 'Door'], ['slider', 'Slider'], ['window', 'Window']];
const NUMS = [
  ['Offset ft', 'offsetFt'],
  ['Width ft', 'widthFt'],
  ['Height ft', 'heightFt'],
  ['Sill ft', 'sillFt'],
];

const round = (v) => Math.round((v ?? 0) * 100) / 100;

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

function renderSelectedUnitCard(o, cb) {
  const card = document.createElement('div');
  card.className = 'selected-card';

  const summary = document.createElement('div');
  summary.className = 'unit-summary';
  summary.style.cssText = 'margin-bottom: 8px; padding: 6px 8px; background: rgba(111, 178, 255, 0.08); border-radius: 5px; font-size: 11px; display: grid; grid-template-columns: 1fr 1fr; gap: 4px 10px; color: #cfd6e0; border: 1px solid rgba(111, 178, 255, 0.2);';

  summary.innerHTML = `
    <div><span style="color:#9aa2ad;">Width:</span> <b>${fmtAllUnits(o.widthFt)}</b></div>
    <div><span style="color:#9aa2ad;">Height:</span> <b>${fmtAllUnits(o.heightFt)}</b></div>
    <div><span style="color:#9aa2ad;">Offset:</span> <b>${fmtAllUnits(o.offsetFt)}</b></div>
    <div><span style="color:#9aa2ad;">Sill:</span> <b>${fmtAllUnits(o.sillFt)}</b></div>
  `;

  card.appendChild(summary);
  const r = row(o, cb);
  card.appendChild(r);
  return card;
}

/** Push current values into the existing rows without rebuilding them. */
export function syncOpeningValues(container, home, selectedId) {
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
    if (summary) {
      summary.innerHTML = `
        <div><span style="color:#9aa2ad;">Width:</span> <b>${fmtAllUnits(o.widthFt)}</b></div>
        <div><span style="color:#9aa2ad;">Height:</span> <b>${fmtAllUnits(o.heightFt)}</b></div>
        <div><span style="color:#9aa2ad;">Offset:</span> <b>${fmtAllUnits(o.offsetFt)}</b></div>
        <div><span style="color:#9aa2ad;">Sill:</span> <b>${fmtAllUnits(o.sillFt)}</b></div>
      `;
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
