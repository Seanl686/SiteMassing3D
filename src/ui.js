// Openings list. Rows are built once per structural change (add / delete /
// wall / type) and updated in place otherwise — re-rendering on every select or
// drag would destroy the element the user is currently interacting with, which
// is what makes selects refuse to open and number fields refuse to accept input.

import { WALLS, WALL_LABEL } from './defaults.js';

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

  const byWall = new Map(WALLS.map((w) => [w, []]));
  for (const o of home.openings) {
    if (!byWall.has(o.wall)) byWall.set(o.wall, []);
    byWall.get(o.wall).push(o);
  }

  for (const wall of WALLS) {
    const list = (byWall.get(wall) || []).slice().sort((a, b) => a.offsetFt - b.offsetFt);
    if (!list.length) continue;

    const h = document.createElement('h3');
    h.textContent = WALL_LABEL[wall];
    h.style.cssText = 'margin:10px 0 6px;font-size:11px;color:#9aa2ad;font-weight:600;';
    container.appendChild(h);

    for (const o of list) container.appendChild(row(o, cb));
  }
  syncOpeningValues(container, home, cb.selectedId);
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
  tsel.addEventListener('change', () => { o.type = tsel.value; cb.onRestructure(o.id); });
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
  return el;
}
