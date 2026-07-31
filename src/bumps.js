// Wall bump-outs, recesses and covered porches.
//
// A spec sheet is rarely a clean rectangle. The Redman 25610 is 58'-8" across
// the back and 56'-0" across the front because the last bay is a recessed 6'
// porch, and the dining and bedroom walls carry "+16"" box-outs. This module
// is the parametric description of those departures from the rectangle: pure
// data and pure math, so the footprint, the brief and the tests can all reason
// about them without touching three.js.
//
// A bump is always attached to ONE wall of the main rectangle:
//
//   offsetFt   along the wall, left->right as seen from OUTSIDE (same
//              convention as an opening's offset)
//   lengthFt   how much of the wall it takes up
//   depthFt    signed: positive projects OUT past the wall, negative cuts a
//              recess INTO the rectangle
//   kind       'wall'  — conditioned space: the wall moves, siding wraps it
//              'porch' — open covered deck: no outer wall, posts and railing
//
// The main rectangle stays the model's spine. Everything else in the app —
// wall frames, opening offsets, the plan plate — keeps measuring against it.

export const BUMP_KINDS = ['wall', 'porch'];
export const BUMP_ROOFS = ['none', 'flat', 'shed', 'gable'];
export const BUMP_WALLS = ['front', 'back', 'left', 'right'];
export const BUMP_END_WALL_OPTIONS = ['wall', 'open_railing', 'open_none'];
export const BUMP_FRONT_RAILING_OPTIONS = ['auto', 'gap', 'continuous', 'none'];

export const BUMP_KIND_LABEL = {
  wall: 'Wall bump (enclosed)',
  porch: 'Covered porch / deck',
};

export const BUMP_ROOF_LABEL = {
  none: 'None (under the main roof)',
  flat: 'Flat cap',
  shed: 'Shed roof',
  gable: 'Gable roof',
};

export const BUMP_END_WALL_LABEL = {
  wall: 'Solid Siding Wall',
  open_railing: 'Open with Railing',
  open_none: 'Open (No Railing)',
};

export const BUMP_FRONT_RAILING_LABEL = {
  auto: 'Auto (Gap at stairs/door)',
  gap: 'Open Gap for Stairs',
  continuous: 'Continuous Railing (No gap)',
  none: 'No Front Railing',
};

let bseq = 0;
export const nextBumpId = () => `b${(++bseq).toString(36)}${Date.now().toString(36).slice(-3)}`;

/** A 16" box-out is the commonest bump on a spec sheet, so that is the default. */
export function defaultBump(wall = 'front', kind = 'wall') {
  const porch = kind === 'porch';
  return {
    id: nextBumpId(),
    wall: BUMP_WALLS.includes(wall) ? wall : 'front',
    kind: porch ? 'porch' : 'wall',
    offsetFt: 0,
    lengthFt: porch ? 12 : 8,
    depthFt: porch ? 6 : 1.33,      // 16" box-out; a 6' porch off the sheet
    heightFt: null,                  // null = follow the wall it hangs on
    roof: porch ? 'shed' : 'flat',
    roofPitchFt: 2,                  // /12, for 'shed' and 'gable' caps
    deck: porch,
    railing: porch,
    endWallLeft: 'wall',             // 'wall' | 'open_railing' | 'open_none'
    endWallRight: 'wall',            // 'wall' | 'open_railing' | 'open_none'
    frontRailing: 'auto',            // 'auto' | 'gap' | 'continuous' | 'none'
    posts: porch ? 3 : 0,
    window: false,
    windowWidthFt: 3,
    windowHeightFt: 3.5,
    interiorWindow: false,
    interiorWindowWidthFt: 3,
    interiorWindowHeightFt: 3.5,
    interiorWindowSillFt: 3.5,
    label: porch ? 'Covered porch' : 'Bump-out',
  };
}

const num = (v, fallback) => (Number.isFinite(+v) ? +v : fallback);

/** Coerce whatever a save or a spec file carries into a clean bump list. */
export function readBumps(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((b) => {
    if (!b || typeof b !== 'object') return null;
    const kind = BUMP_KINDS.includes(b.kind) ? b.kind : 'wall';
    const base = defaultBump(b.wall, kind);
    const heightRaw = b.heightFt;
    return {
      id: b.id || nextBumpId(),
      wall: BUMP_WALLS.includes(b.wall) ? b.wall : 'front',
      kind,
      offsetFt: num(b.offsetFt, base.offsetFt),
      lengthFt: Math.max(0.5, num(b.lengthFt, base.lengthFt)),
      depthFt: num(b.depthFt, base.depthFt),
      heightFt: heightRaw === null || heightRaw === undefined || heightRaw === ''
        ? null
        : Math.max(1, num(heightRaw, base.heightFt ?? 8)),
      roof: BUMP_ROOFS.includes(b.roof) ? b.roof : base.roof,
      roofPitchFt: Math.max(0, num(b.roofPitchFt, base.roofPitchFt)),
      deck: b.deck === undefined ? base.deck : !!b.deck,
      railing: b.railing === undefined ? base.railing : !!b.railing,
      endWallLeft: BUMP_END_WALL_OPTIONS.includes(b.endWallLeft) ? b.endWallLeft : base.endWallLeft,
      endWallRight: BUMP_END_WALL_OPTIONS.includes(b.endWallRight) ? b.endWallRight : base.endWallRight,
      frontRailing: BUMP_FRONT_RAILING_OPTIONS.includes(b.frontRailing) ? b.frontRailing : base.frontRailing,
      posts: Math.max(0, Math.round(num(b.posts, base.posts))),
      window: b.window === undefined ? base.window : !!b.window,
      windowWidthFt: Math.max(1, num(b.windowWidthFt, base.windowWidthFt)),
      windowHeightFt: Math.max(1, num(b.windowHeightFt, base.windowHeightFt)),
      interiorWindow: b.interiorWindow === undefined ? base.interiorWindow : !!b.interiorWindow,
      interiorWindowWidthFt: Math.max(1, num(b.interiorWindowWidthFt, base.interiorWindowWidthFt)),
      interiorWindowHeightFt: Math.max(1, num(b.interiorWindowHeightFt, base.interiorWindowHeightFt)),
      interiorWindowSillFt: Math.max(0, num(b.interiorWindowSillFt, base.interiorWindowSillFt)),
      window: !!b.window,
      windowWidthFt: Math.max(0.5, num(b.windowWidthFt, base.windowWidthFt)),
      windowHeightFt: Math.max(0.5, num(b.windowHeightFt, base.windowHeightFt)),
      label: typeof b.label === 'string' ? b.label : base.label,
    };
  }).filter(Boolean);
}

/** The span of the wall a bump hangs on. Gable ends are the width. */
export function wallSpan(wall, dim) {
  return wall === 'left' || wall === 'right' ? dim.widthFt : dim.lengthFt;
}

/**
 * Keep a bump inside the wall it is attached to, and keep a recess from eating
 * more than three-quarters of the way through the home. Mutates and returns.
 */
export function clampBump(b, dim) {
  const span = wallSpan(b.wall, dim);
  const across = b.wall === 'left' || b.wall === 'right' ? dim.lengthFt : dim.widthFt;
  b.lengthFt = Math.min(Math.max(0.5, b.lengthFt), span);
  b.offsetFt = Math.min(Math.max(0, b.offsetFt), span - b.lengthFt);
  const maxIn = across * 0.75;
  b.depthFt = Math.max(-maxIn, Math.min(b.depthFt, 40));
  if (Math.abs(b.depthFt) < 0.05) b.depthFt = b.depthFt < 0 ? -0.05 : 0.05;
  return b;
}

export const bumpsOnWall = (bumps, wall) => (bumps || []).filter((b) => b.wall === wall);
export const isRecess = (b) => b.depthFt < 0;
export const isProjecting = (b) => b.depthFt > 0;

/** Effective top of a bump, in feet above the floor deck. */
export function bumpHeight(b, wallHeightFt) {
  const h = b.heightFt === null || b.heightFt === undefined ? wallHeightFt : b.heightFt;
  return Math.min(Math.max(1, h), wallHeightFt);
}

/**
 * Where a bump lands in world XZ. Wall frames run left->right as seen from
 * outside, which is -X on the front wall and +X on the back — the same
 * convention `wallFrames()` uses, restated here so this module stays pure.
 */
export function bumpFootprint(b, dim) {
  const { widthFt: W, lengthFt: L } = dim;
  const d = b.depthFt;
  const o = b.offsetFt;
  const len = b.lengthFt;
  switch (b.wall) {
    case 'front': {
      const x1 = L / 2 - o, x0 = x1 - len;
      return { minX: x0, maxX: x1, minZ: -W / 2 - Math.max(0, d), maxZ: -W / 2 + Math.max(0, -d) };
    }
    case 'back': {
      const x0 = -L / 2 + o, x1 = x0 + len;
      return { minX: x0, maxX: x1, minZ: W / 2 - Math.max(0, -d), maxZ: W / 2 + Math.max(0, d) };
    }
    case 'left': {
      const z0 = -W / 2 + o, z1 = z0 + len;
      return { minX: -L / 2 - Math.max(0, d), maxX: -L / 2 + Math.max(0, -d), minZ: z0, maxZ: z1 };
    }
    default: {
      const z1 = W / 2 - o, z0 = z1 - len;
      return { minX: L / 2 - Math.max(0, -d), maxX: L / 2 + Math.max(0, d), minZ: z0, maxZ: z1 };
    }
  }
}

/**
 * The home's real ground extents, bumps included. Framing, the footprint
 * outline and the view presets all measure the picture off this rather than
 * off `lengthFt × widthFt`, or a 6' porch hangs outside the frame.
 */
export function footprintExtents(dim, bumps = []) {
  const rake = dim.rakeOverhangFt || 0;
  const eave = dim.eaveOverhangFt || 0;
  const box = {
    minX: -dim.lengthFt / 2 - rake,
    maxX: dim.lengthFt / 2 + rake,
    minZ: -dim.widthFt / 2 - eave,
    maxZ: dim.widthFt / 2 + eave,
  };
  for (const b of bumps) {
    if (!isProjecting(b)) continue;
    const f = bumpFootprint(b, dim);
    box.minX = Math.min(box.minX, f.minX);
    box.maxX = Math.max(box.maxX, f.maxX);
    box.minZ = Math.min(box.minZ, f.minZ);
    box.maxZ = Math.max(box.maxZ, f.maxZ);
  }
  return box;
}

const WALL_WORD = { front: 'front wall', back: 'rear wall', left: 'left gable end', right: 'right gable end' };

/** One sentence a render brief can print verbatim. */
export function describeBump(b, dim, fmt = (v) => `${v} ft`) {
  const where = WALL_WORD[b.wall] || b.wall;
  const depth = fmt(Math.abs(b.depthFt));
  const dir = isRecess(b) ? 'recessed into' : 'projecting out from';
  if (b.kind === 'porch') {
    const roof = b.roof === 'none'
      ? 'covered by the main roof overhead'
      : `under its own ${BUMP_ROOF_LABEL[b.roof].toLowerCase().replace(' roof', '')} roof`;
    const rail = b.railing ? ', railed' : '';
    return `${fmt(b.lengthFt)} × ${depth} covered porch ${dir} the ${where}, `
      + `starting ${fmt(b.offsetFt)} from that wall's left corner as seen from outside, `
      + `${roof}${rail}, open on the outer sides with ${b.posts || 0} posts`;
  }
  return `${fmt(b.lengthFt)} wide wall section ${dir} the ${where} by ${depth}, `
    + `starting ${fmt(b.offsetFt)} from that wall's left corner as seen from outside`;
}

/**
 * Bump intervals along a wall, merged and sorted, in the wall's own left->right
 * coordinate. The wall builder cuts its siding into bands on these boundaries
 * rather than punching holes: a hole whose edge touches the outline of the
 * shape triangulates badly, a band does not.
 *
 * A porch that projects OUT is the one bump that leaves the wall alone — it is
 * a covered deck standing in front of a wall that is still there, doors and
 * windows and all. Everything else moves the wall.
 */
export function cutsWall(b) {
  return isRecess(b) || b.kind !== 'porch';
}

function adjacentCornerCuts(bumps, wall, dim, wallHeightFt) {
  const cuts = [];
  const wSpan = wallSpan(wall, dim);
  const isOpen = (val) => val === 'open_railing' || val === 'open_none' || val === 'open';

  for (const b of bumps || []) {
    if (b.kind !== 'porch' || !isRecess(b)) continue;
    const depth = Math.abs(b.depthFt);
    const bSpan = wallSpan(b.wall, dim);
    const top = bumpHeight(b, wallHeightFt);

    // Corner 1: front (u=span) / left (u=0)
    if (wall === 'front' && b.wall === 'left' && b.offsetFt <= 0.01 && isOpen(b.endWallLeft)) {
      cuts.push({ x0: Math.max(0, wSpan - depth), x1: wSpan, top, bump: b, adjacentCorner: true });
    }
    if (wall === 'left' && b.wall === 'front' && b.offsetFt + b.lengthFt >= bSpan - 0.01 && isOpen(b.endWallRight)) {
      cuts.push({ x0: 0, x1: Math.min(wSpan, depth), top, bump: b, adjacentCorner: true });
    }

    // Corner 2: front (u=0) / right (u=span)
    if (wall === 'front' && b.wall === 'right' && b.offsetFt + b.lengthFt >= bSpan - 0.01 && isOpen(b.endWallRight)) {
      cuts.push({ x0: 0, x1: Math.min(wSpan, depth), top, bump: b, adjacentCorner: true });
    }
    if (wall === 'right' && b.wall === 'front' && b.offsetFt <= 0.01 && isOpen(b.endWallLeft)) {
      cuts.push({ x0: Math.max(0, wSpan - depth), x1: wSpan, top, bump: b, adjacentCorner: true });
    }

    // Corner 3: back (u=0) / left (u=span)
    if (wall === 'back' && b.wall === 'left' && b.offsetFt + b.lengthFt >= bSpan - 0.01 && isOpen(b.endWallRight)) {
      cuts.push({ x0: 0, x1: Math.min(wSpan, depth), top, bump: b, adjacentCorner: true });
    }
    if (wall === 'left' && b.wall === 'back' && b.offsetFt <= 0.01 && isOpen(b.endWallLeft)) {
      cuts.push({ x0: Math.max(0, wSpan - depth), x1: wSpan, top, bump: b, adjacentCorner: true });
    }

    // Corner 4: back (u=span) / right (u=0)
    if (wall === 'back' && b.wall === 'right' && b.offsetFt <= 0.01 && isOpen(b.endWallLeft)) {
      cuts.push({ x0: Math.max(0, wSpan - depth), x1: wSpan, top, bump: b, adjacentCorner: true });
    }
    if (wall === 'right' && b.wall === 'back' && b.offsetFt + b.lengthFt >= bSpan - 0.01 && isOpen(b.endWallRight)) {
      cuts.push({ x0: 0, x1: Math.min(wSpan, depth), top, bump: b, adjacentCorner: true });
    }
  }

  return cuts;
}

export function wallBands(bumps, wall, dim, wallHeightFt) {
  const ownSpans = bumpsOnWall(bumps, wall)
    .filter(cutsWall)
    .map((b) => ({
      x0: Math.max(0, b.offsetFt),
      x1: Math.min(wallSpan(wall, dim), b.offsetFt + b.lengthFt),
      top: bumpHeight(b, wallHeightFt),
      bump: b,
      adjacentCorner: false,
    }))
    .filter((s) => s.x1 - s.x0 > 0.01);

  const cornerSpans = adjacentCornerCuts(bumps, wall, dim, wallHeightFt);

  const spans = [...ownSpans, ...cornerSpans].sort((a, b) => a.x0 - b.x0);

  // Overlapping bumps would double-cut the wall; the first one wins the overlap.
  const cut = [];
  for (const s of spans) {
    const prev = cut[cut.length - 1];
    if (prev && s.x0 < prev.x1) s.x0 = prev.x1;
    if (s.x1 - s.x0 > 0.01) cut.push(s);
  }
  return cut;
}
