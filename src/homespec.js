// Reading a home out of its plan.
//
// Everything else in this app assumes the model already exists: you type the
// dimensions off the spec sheet, then trace the doors off the floor plan. That
// typing is the slowest and least reliable step in the whole workflow — it is
// where a 27'-7" becomes a 27', and every plate and every render inherits the
// error.
//
// The plan already contains all of it: the dimension line, the roof pitch, the
// wall thickness, and a door and window schedule drawn to scale. This module is
// the contract for handing that page to a vision model and getting the home
// back as data — the schema it must answer in, the prompt that tells it how to
// read the sheet, and the validator that refuses to trust the answer.
//
// The validator is the important half. A model reading a scanned plan will
// occasionally return a 270-foot-wide double-wide or a window on a wall that
// does not exist, and a silently applied wrong number is worse than no number
// at all — it looks authoritative. Every value is range-checked, every
// correction is reported, and the caller is expected to show that report next
// to the sheet before accepting anything.
//
// DOM-free and network-free so it can be unit-tested.

import { WALLS } from './defaults.js';
import { readBumps } from './bumps.js';

/**
 * The JSON Schema the model must answer in.
 *
 * Deliberately flat and fully `required` with `additionalProperties: false`
 * throughout — that is what structured outputs enforce, and it means a missing
 * field is a model error rather than a silent default. Numeric bounds are NOT
 * expressed here: the structured-output subset does not support `minimum` /
 * `maximum`, so range checking lives in validateHomeSpec() where it can report
 * what it changed instead of failing the whole call.
 */
export const HOME_SPEC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['modelName', 'confidence', 'readings', 'dimensions', 'openings'],
  properties: {
    modelName: {
      type: 'string',
      description: 'The model name exactly as printed on the sheet, e.g. "Redmond 25610".',
    },
    confidence: {
      type: 'string',
      enum: ['high', 'medium', 'low'],
      description: 'high = every value read directly off the sheet; low = mostly inferred.',
    },
    readings: {
      type: 'object',
      additionalProperties: false,
      required: ['dimensionLine', 'notes'],
      properties: {
        dimensionLine: {
          type: 'string',
          description: 'The overall dimension line copied verbatim, e.g. "27\'-7\\" X 48\'-0\\"". Empty string if the sheet has none.',
        },
        notes: {
          type: 'string',
          description: 'What was read directly versus assumed, and anything illegible. This is what the human checks against the sheet.',
        },
      },
    },
    dimensions: {
      type: 'object',
      additionalProperties: false,
      required: [
        'widthFt', 'lengthFt', 'wallHeightFt', 'floorHeightFt',
        'roofPitch', 'roofPitchBack', 'eaveOverhangFt', 'rakeOverhangFt', 'roofStyle',
      ],
      properties: {
        widthFt: { type: 'number', description: 'Overall width in feet — the SHORT side, the gable end.' },
        lengthFt: { type: 'number', description: 'Overall length in feet — the LONG side, the front wall.' },
        wallHeightFt: { type: 'number', description: 'Sidewall height. Use 8 if the sheet does not say.' },
        floorHeightFt: { type: 'number', description: 'Floor deck above grade. Use 2.5 if the sheet does not say.' },
        roofPitch: { type: 'number', description: 'Rise per 12 of run on the FRONT slope. Use 4 if the sheet does not say.' },
        roofPitchBack: {
          type: ['number', 'null'],
          description: 'Rise per 12 on the REAR slope, when the sheet says "split pitch" and states a second number. null when both slopes match — which is the normal case.',
        },
        eaveOverhangFt: { type: 'number', description: 'Overhang past the long walls. Use 1 if not stated.' },
        rakeOverhangFt: { type: 'number', description: 'Overhang past the gable ends. Use 0.75 if not stated.' },
        roofStyle: { type: 'string', enum: ['gable', 'flat'] },
      },
    },
    bumps: {
      type: 'array',
      description: 'Every place the outline is NOT the plain rectangle: a covered porch drawn inside or outside the footprint, and any wall section stepped in or out (a "+16\"" note on a plan is a 1.33 ft bump-out). Empty array when the outline is a clean rectangle.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'wall', 'offsetFt', 'lengthFt', 'depthFt', 'label'],
        properties: {
          kind: {
            type: 'string',
            enum: ['wall', 'porch'],
            description: '"porch" for a covered deck/porch drawn open to the outside; "wall" for enclosed living space stepped in or out.',
          },
          wall: { type: 'string', enum: ['front', 'back', 'left', 'right'] },
          offsetFt: { type: 'number', description: 'Distance from that wall\'s LEFT corner to where the section starts, seen from outside.' },
          lengthFt: { type: 'number', description: 'How much of the wall it runs along.' },
          depthFt: {
            type: 'number',
            description: 'POSITIVE if it projects OUT past the wall, NEGATIVE if it is recessed INTO the footprint. A porch tucked under the main roof inside the overall dimension is negative.',
          },
          label: { type: 'string', description: 'What the plan calls it, e.g. "6\' Porch".' },
        },
      },
    },
    openings: {
      type: 'array',
      description: 'Every exterior door and window on the plan. Interior doors are not exterior openings — leave them out.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'wall', 'offsetFt', 'widthFt', 'heightFt', 'sillFt', 'label'],
        properties: {
          type: { type: 'string', enum: ['door', 'slider', 'window'] },
          wall: {
            type: 'string',
            enum: ['front', 'back', 'left', 'right'],
            description: 'front/back are the LONG walls; left/right are the SHORT gable ends. Front is the wall with the main entry.',
          },
          offsetFt: {
            type: 'number',
            description: 'Distance in feet from that wall\'s LEFT corner to the opening\'s left edge, as seen standing outside facing the wall.',
          },
          widthFt: { type: 'number' },
          heightFt: { type: 'number', description: 'Doors are typically 6.67 (6\'-8"). Windows 3.5 unless the sheet says.' },
          sillFt: { type: 'number', description: 'Height above the floor deck. Doors are always 0.' },
          label: { type: 'string', description: 'The room it serves, e.g. "Kitchen", "Main entry".' },
        },
      },
    },
  },
};

/**
 * The instructions that go with the plan image.
 *
 * Written for any vision model, not just the one this app can call directly —
 * the paste-back path hands this same text to whatever the user already has
 * open. The recurring theme is: read, do not estimate, and say which is which.
 */
export function buildSpecPrompt({ knownWidthFt, knownLengthFt } = {}) {
  const L = [];
  const w = (line = '') => L.push(line);

  w(`# Read this floor plan and return the home as data`);
  w();
  w(`Attached is one page of a manufactured-home floor plan or spec sheet. Read`);
  w(`the home off it and answer with JSON matching the schema below. This feeds a`);
  w(`3D massing model that a render is built from, so a wrong number is not a`);
  w(`cosmetic problem — it propagates into every plate and every render after it.`);
  w();
  w(`## The one rule`);
  w();
  w(`**Read what is printed. Do not estimate what is not.** Where the sheet states`);
  w(`a value, use it exactly. Where it does not, use the stated default from the`);
  w(`schema and say so in \`readings.notes\`. A default you declared is recoverable;`);
  w(`a guess presented as a reading is not.`);
  w();

  w(`## Overall size`);
  w();
  w(`Find the overall dimension line — usually \`W' x L'\` near the title block or`);
  w(`along the plan edges. Copy it **verbatim** into \`readings.dimensionLine\`,`);
  w(`including inches, before you convert anything.`);
  w();
  w(`- \`widthFt\` is the **smaller** number: the short side, the gable end.`);
  w(`- \`lengthFt\` is the **larger** number: the long side the front wall runs along.`);
  w(`- Convert inches to decimal feet: 27'-7" is 27.58, not 27.7.`);
  w(`- These are **exterior** dimensions. If the sheet dimensions to interior faces,`);
  w(`  add the wall thickness and note that you did.`);
  if (knownWidthFt && knownLengthFt) {
    w();
    w(`For reference, the current model in the app is ${knownWidthFt} × ${knownLengthFt} ft.`);
    w(`If the sheet disagrees, **the sheet is right** — return what the sheet says.`);
  }
  w();

  w(`## Which wall is which`);
  w();
  w(`The model has four exterior walls and the names are fixed:`);
  w();
  w(`| Name | Which wall |`);
  w(`|---|---|`);
  w(`| \`front\` | a LONG wall — the one with the main entry |`);
  w(`| \`back\` | the opposite LONG wall |`);
  w(`| \`left\` | a SHORT gable end |`);
  w(`| \`right\` | the other SHORT gable end |`);
  w();
  w(`Orient yourself once and stay consistent: decide which long wall has the main`);
  w(`entry, call it \`front\`, and derive the other three from it. \`left\` is the gable`);
  w(`end on your left **when you are outside, facing the front wall**.`);
  w();

  w(`## Where each opening sits`);
  w();
  w(`\`offsetFt\` is measured **along the wall, from that wall's left corner to the`);
  w(`opening's left edge, standing outside and facing that wall.** Read it off the`);
  w(`plan by scaling against the overall dimension — the plan is drawn to scale even`);
  w(`where it is not dimensioned.`);
  w();
  w(`Because the walls face outward in different directions, "left" rotates as you`);
  w(`walk around the home. Work wall by wall rather than reading everything off the`);
  w(`page's left edge — that is the single most common way this goes wrong.`);
  w();
  w(`- Include every **exterior** door and window. Exclude interior doors, closets,`);
  w(`  and pass-throughs.`);
  w(`- A patio or glass door two panels wide is \`slider\`, not \`door\`.`);
  w(`- \`sillFt\` is measured above the floor deck. Doors are always 0.`);
  w(`- Label each one with the room it serves, from the plan's room names.`);
  w();

  w(`## Roof and heights`);
  w();
  w(`Take \`roofPitch\` from the pitch triangle or a note like "4/12". Take`);
  w(`\`wallHeightFt\` from a section or elevation if one is on the page. If either is`);
  w(`absent, use the schema default and record that in \`readings.notes\`.`);
  w();

  w(`## Before you answer`);
  w();
  w(`Check that \`lengthFt\` is greater than \`widthFt\` — if it is not, you have them`);
  w(`swapped. Check that every \`offsetFt\` plus its \`widthFt\` fits inside the wall it`);
  w(`is on. Set \`confidence\` honestly: \`high\` only if the dimension line and the`);
  w(`openings were all legible.`);
  w();
  w();
  w(`## Where the outline is not a rectangle`);
  w();
  w(`Two dimension lines that disagree — 58'-8" across one side and 56'-0" across`);
  w(`the other — mean the footprint steps. So does a "+16\"" note against a wall,`);
  w(`and so does a porch drawn inside the outline. Put each one in \`bumps\`:`);
  w(`\`depthFt\` positive if it projects out, **negative if it is recessed in**. A`);
  w(`porch printed inside the overall dimension is recessed; a porch drawn hanging`);
  w(`off the front of it projects. Read the offset the same way as an opening's —`);
  w(`from that wall's left corner, standing outside.`);
  w();
  w(`If the sheet says "split pitch", the two roof slopes have different pitches.`);
  w(`Put the front slope in \`roofPitch\` and the rear slope in \`roofPitchBack\`.`);
  w(`If only one number is printed, leave \`roofPitchBack\` null.`);
  w();
  w(`Return only the JSON object.`);

  return L.join('\n');
}

// Plausible ranges for a manufactured home. Anything outside is a misread, not
// a design choice, so it is clamped and reported rather than accepted.
const RANGES = {
  widthFt: [8, 40],
  lengthFt: [16, 100],
  wallHeightFt: [6, 14],
  floorHeightFt: [0, 8],
  roofPitch: [0, 12],
  eaveOverhangFt: [0, 4],
  rakeOverhangFt: [0, 4],
};

const DEFAULTS = {
  widthFt: 27,
  lengthFt: 56,
  wallHeightFt: 8,
  floorHeightFt: 2.5,
  roofPitch: 4,
  eaveOverhangFt: 1,
  rakeOverhangFt: 0.75,
};

const OPENING_RANGES = {
  widthFt: [0.5, 20],
  heightFt: [0.5, 12],
  sillFt: [0, 12],
};

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : (Number.isFinite(+v) ? +v : null));
const round2 = (v) => Math.round(v * 100) / 100;

/**
 * Turn whatever the model returned into a home spec that cannot break the app,
 * and report every correction made on the way.
 *
 * Returns `{ ok, spec, issues, summary }`. `ok` is false only when the answer is
 * unusable — `issues` is populated either way and is the thing the user reads
 * next to the sheet. Nothing here trusts the input: a string where a number
 * belongs, a wall name that does not exist, an opening wider than its wall, and
 * a swapped width/length are all expected inputs.
 */
export function validateHomeSpec(raw) {
  const issues = [];
  const note = (level, text) => issues.push({ level, text });

  if (!raw || typeof raw !== 'object') {
    return { ok: false, spec: null, issues: [{ level: 'error', text: 'That is not a JSON object.' }], summary: '' };
  }
  if (!raw.dimensions || typeof raw.dimensions !== 'object') {
    return { ok: false, spec: null, issues: [{ level: 'error', text: 'No `dimensions` object in the answer.' }], summary: '' };
  }

  const dim = {};
  const clamp = (key, v) => {
    const [lo, hi] = RANGES[key];
    if (v === null) {
      note('warn', `${key} was missing or not a number — used the default ${DEFAULTS[key]}.`);
      return DEFAULTS[key];
    }
    if (v < lo || v > hi) {
      const out = Math.min(hi, Math.max(lo, v));
      note('error', `${key} came back as ${v}, which is outside the plausible range ${lo}–${hi}. Clamped to ${out} — check this against the sheet.`);
      return out;
    }
    return round2(v);
  };

  // Width and length are settled together and BEFORE either is clamped. A
  // double-wide is longer than it is wide, so a reversed pair is a misread of
  // the dimension line — and clamping first would destroy the good value: a
  // valid 48-ft length read into `widthFt` gets pinned to the 40-ft width
  // ceiling, and the swap then has nothing left to recover.
  let rawWidth = num(raw.dimensions.widthFt);
  let rawLength = num(raw.dimensions.lengthFt);
  if (rawWidth !== null && rawLength !== null && rawLength < rawWidth) {
    note('error', `Width and length came back swapped (${rawWidth} × ${rawLength}). Exchanged them so the long wall is the length — confirm against the dimension line.`);
    const t = rawWidth; rawWidth = rawLength; rawLength = t;
  }
  dim.widthFt = clamp('widthFt', rawWidth);
  dim.lengthFt = clamp('lengthFt', rawLength);

  for (const key of Object.keys(RANGES)) {
    if (key === 'widthFt' || key === 'lengthFt') continue;
    dim[key] = clamp(key, num(raw.dimensions[key]));
  }

  dim.roofStyle = raw.dimensions.roofStyle === 'flat' ? 'flat' : 'gable';

  // A split-pitch rear slope is optional by design: null means "same as the
  // front", which is what all but a handful of sheets mean.
  const backPitch = num(raw.dimensions.roofPitchBack);
  if (backPitch === null) {
    dim.roofPitchBack = null;
  } else if (backPitch <= 0 || backPitch > 12) {
    dim.roofPitchBack = null;
    note('warn', `roofPitchBack came back as ${backPitch}, which is not a pitch — treated the roof as a single ${dim.roofPitch}/12.`);
  } else {
    dim.roofPitchBack = round2(backPitch);
    if (Math.abs(dim.roofPitchBack - dim.roofPitch) < 0.01) dim.roofPitchBack = null;
  }

  const rawBumps = Array.isArray(raw.bumps) ? raw.bumps : [];
  const bumps = [];
  rawBumps.forEach((b, i) => {
    if (!b || typeof b !== 'object') {
      note('warn', `Bump ${i + 1} was not an object — skipped.`);
      return;
    }
    const wall = WALLS.includes(b.wall) ? b.wall : 'front';
    if (wall !== b.wall) note('error', `Bump ${i + 1} named wall "${b.wall}", which does not exist — put on the front wall.`);
    const kind = b.kind === 'porch' ? 'porch' : 'wall';
    const span = wall === 'front' || wall === 'back' ? dim.lengthFt : dim.widthFt;
    const across = wall === 'front' || wall === 'back' ? dim.widthFt : dim.lengthFt;
    const len = Math.min(Math.max(0.5, num(b.lengthFt) ?? 6), span);
    const offset = Math.min(Math.max(0, num(b.offsetFt) ?? 0), span - len);
    let depth = num(b.depthFt);
    if (depth === null || Math.abs(depth) < 0.05) {
      depth = kind === 'porch' ? -6 : 1.33;
      note('warn', `Bump ${i + 1} had no usable depth — assumed ${depth} ft. Check it against the sheet.`);
    }
    depth = Math.max(-across * 0.75, Math.min(depth, 40));
    bumps.push({
      kind,
      wall,
      offsetFt: round2(offset),
      lengthFt: round2(len),
      depthFt: round2(depth),
      label: typeof b.label === 'string' ? b.label.slice(0, 60) : (kind === 'porch' ? 'Covered porch' : 'Bump-out'),
    });
  });

  const rawOpenings = Array.isArray(raw.openings) ? raw.openings : [];
  if (!Array.isArray(raw.openings)) note('warn', 'No `openings` array — the model read no doors or windows.');

  const openings = [];
  rawOpenings.forEach((o, i) => {
    if (!o || typeof o !== 'object') {
      note('warn', `Opening ${i + 1} was not an object — skipped.`);
      return;
    }
    const type = ['door', 'slider', 'window'].includes(o.type) ? o.type : 'window';
    if (type !== o.type) note('warn', `Opening ${i + 1} had an unknown type "${o.type}" — treated as a window.`);

    const wall = WALLS.includes(o.wall) ? o.wall : 'front';
    if (wall !== o.wall) note('error', `Opening ${i + 1} named wall "${o.wall}", which does not exist — put on the front wall. Move it yourself.`);

    const out = { type, wall, label: typeof o.label === 'string' ? o.label.slice(0, 60) : '' };
    for (const [key, [lo, hi]] of Object.entries(OPENING_RANGES)) {
      const v = num(o[key]);
      out[key] = v === null ? null : round2(Math.min(hi, Math.max(lo, v)));
      if (v !== null && (v < lo || v > hi)) {
        note('warn', `Opening ${i + 1} (${out.label || type}) had ${key} = ${v}; clamped to ${out[key]}.`);
      }
    }
    if (out.widthFt === null) out.widthFt = type === 'window' ? 4 : type === 'slider' ? 6 : 3;
    if (out.heightFt === null) out.heightFt = type === 'window' ? 3.5 : 6.67;
    // A door sits on the floor by definition; a sill on one is a misread.
    out.sillFt = type === 'window' ? (out.sillFt ?? 3.5) : 0;

    const offset = num(o.offsetFt);
    // The wall an opening is on decides how much room it has.
    const wallRun = wall === 'front' || wall === 'back' ? dim.lengthFt : dim.widthFt;
    const maxOffset = Math.max(0, wallRun - out.widthFt);
    if (offset === null) {
      out.offsetFt = round2(maxOffset / 2);
      note('warn', `Opening ${i + 1} (${out.label || type}) had no offset — centred on its wall.`);
    } else if (offset < 0 || offset > maxOffset) {
      out.offsetFt = round2(Math.min(maxOffset, Math.max(0, offset)));
      note('error', `Opening ${i + 1} (${out.label || type}) was placed at ${offset} ft on a ${round2(wallRun)} ft wall, where it does not fit. Moved to ${out.offsetFt} — check it.`);
    } else {
      out.offsetFt = round2(offset);
    }
    openings.push(out);
  });

  if (!openings.some((o) => o.type !== 'window')) {
    note('warn', 'No exterior doors were found. Every home has at least one — check the plan for an entry the model missed.');
  }

  const confidence = ['high', 'medium', 'low'].includes(raw.confidence) ? raw.confidence : 'low';
  if (confidence === 'low') {
    note('warn', 'The model reported LOW confidence in its own reading. Treat every number as unverified.');
  }

  const finishes = {};
  if (raw.finishes && typeof raw.finishes === 'object') {
    const tex = raw.finishes.sidingTexture;
    if (['lap', 'board-batten', 'panel', 'shingle'].includes(tex)) finishes.sidingTexture = tex;

    const parseColor = (c) => parseHexColor(c);
    if (raw.finishes.sidingColor) {
      const col = parseColor(raw.finishes.sidingColor);
      if (col) finishes.sidingColor = col;
    }
    if (raw.finishes.trimColor) {
      const col = parseColor(raw.finishes.trimColor);
      if (col) finishes.trimColor = col;
    }
    if (raw.finishes.roofColor) {
      const col = parseColor(raw.finishes.roofColor);
      if (col) finishes.roofColor = col;
    }
    if (raw.finishes.doorColor) {
      const col = parseColor(raw.finishes.doorColor);
      if (col) finishes.doorColor = col;
    }
  }

  const spec = {
    name: typeof raw.modelName === 'string' && raw.modelName.trim() ? raw.modelName.trim() : 'Untitled double-wide',
    dimensions: dim,
    bumps,
    openings,
    confidence,
    finishes: Object.keys(finishes).length > 0 ? finishes : null,
    readings: {
      dimensionLine: typeof raw.readings?.dimensionLine === 'string' ? raw.readings.dimensionLine : '',
      notes: typeof raw.readings?.notes === 'string' ? raw.readings.notes : '',
    },
  };

  const doors = openings.filter((o) => o.type !== 'window').length;
  const summary =
    `${spec.name} — ${round2(dim.widthFt)} × ${round2(dim.lengthFt)} ft, `
    + `${dim.roofStyle === 'flat' ? 'flat roof' : `${dim.roofPitch}/12${dim.roofPitchBack ? `-${dim.roofPitchBack}/12 split-pitch` : ''} gable`}, `
    + `${bumps.length ? `${bumps.length} bump/porch section${bumps.length === 1 ? '' : 's'}, ` : ''}`
    + `${doors} door${doors === 1 ? '' : 's'} and ${openings.length - doors} window${openings.length - doors === 1 ? '' : 's'}`
    + `${spec.finishes?.sidingColor ? `, ${spec.finishes.sidingTexture || 'lap'} siding (${spec.finishes.sidingColor})` : ''}`;

  return { ok: true, spec, issues, summary };
}

const COLOR_MAP = {
  white: '#f5f5f2', 'off-white': '#e9e7df', 'light grey': '#c7ccd1', grey: '#8d9299',
  'medium grey': '#8d9299', 'slate grey': '#5b636d', charcoal: '#3a3d42', black: '#17191c',
  'warm beige': '#d8c9ab', beige: '#d8c9ab', tan: '#b99f72', brown: '#6d543a',
  'barn red': '#8c3a33', red: '#8c3a33', terracotta: '#b5603f', 'sage green': '#8a9a7b',
  green: '#3c5140', 'forest green': '#3c5140', 'navy blue': '#2b3a55', blue: '#2b3a55',
  'sky blue': '#7d9dc0', 'steel blue': '#4d6070', cream: '#f0e6cf',
};

export function parseHexColor(c) {
  if (!c || typeof c !== 'string') return null;
  const str = c.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/i.test(str)) return str;
  if (/^#[0-9a-f]{3}$/i.test(str)) {
    return `#${str[1]}${str[1]}${str[2]}${str[2]}${str[3]}${str[3]}`;
  }
  return COLOR_MAP[str] || null;
}

/** Pull the JSON object out of a paste that may be wrapped in prose or a fence. */
export function extractJson(text) {
  if (typeof text !== 'string') throw new Error('nothing pasted');
  const trimmed = text.trim();
  if (!trimmed) throw new Error('nothing pasted');
  // A fenced block wins if there is one; models add prose around it constantly.
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const body = fenced ? fenced[1] : trimmed;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no JSON object found in that text');
  return JSON.parse(body.slice(start, end + 1));
}

/**
 * Merge a validated spec onto a home, keeping everything the plan cannot know:
 * colours, the site photo, the saved site views, the panorama, the site plan.
 * `nextId` is passed in so this stays pure.
 */
export function applySpecToHome(home, spec, nextId) {
  const colors = { ...home.colors };
  const dimensions = { ...home.dimensions, ...spec.dimensions };

  if (spec.finishes) {
    if (spec.finishes.sidingColor) colors.siding = spec.finishes.sidingColor;
    if (spec.finishes.trimColor) colors.trim = spec.finishes.trimColor;
    if (spec.finishes.roofColor) colors.roof = spec.finishes.roofColor;
    if (spec.finishes.doorColor) colors.door = spec.finishes.doorColor;
    if (spec.finishes.sidingTexture) dimensions.sidingTexture = spec.finishes.sidingTexture;
  }

  // A spec that read no bumps says nothing about bumps — it does not wipe the
  // porch someone already placed by hand. An empty array from a plan that HAS
  // been read for bumps is indistinguishable from that, so the sheet wins only
  // when it found something.
  const bumps = Array.isArray(spec.bumps) && spec.bumps.length
    ? readBumps(spec.bumps.map((b, i) => ({ ...b, id: nextId('b', i) })))
    : (home.bumps || []);

  return {
    ...home,
    name: spec.name,
    colors,
    dimensions,
    bumps,
    openings: spec.openings.map((o, i) => ({
      id: nextId(o.type[0], i),
      type: o.type,
      wall: o.wall,
      offsetFt: o.offsetFt,
      widthFt: o.widthFt,
      heightFt: o.heightFt,
      sillFt: o.sillFt,
      label: o.label,
      headFree: false,
    })),
  };
}
