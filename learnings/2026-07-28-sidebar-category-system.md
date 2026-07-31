# Sidebar visual system: category colour, spine, and discipline codes

## What changed

- `index.html` — each panel header's emoji is replaced by a fixed-width three-letter
  discipline code (`BLD`, `DRM`, `MAT`, `OPN`, `STR`, `PHT`, `PLN`, `OUT`), the way a sheet
  set numbers its drawings. Every inline-styled `<h3>` became `<h3 class="subhead">`. The two
  openings hints were shortened and rewritten in the interface's own voice.
- `css/app.css` — a `--cat` custom property per panel id carries one colour through the whole
  section: a 3px spine on the left edge (stub when collapsed, full height when open), the code
  chip, the open-header gradient, a 5% body wash, the chevron, subhead ticks, checkbox and
  range `accent-color`, focus rings, and the selected-row border. Colours: azure BLD, violet
  DRM, coral MAT, teal OPN, green STR, pink PHT, vellum PLN, graphite OUT.
- Opening rows now read as three distinct states — hairline (idle), category-lit (selected),
  gold (in a group, solid gold for the anchor) — and the type tag is colour-coded per type
  (door amber, slider violet, window teal).
- Every number field is set in `ui-monospace`, matching the HUD and the code chips, so digits
  line up column to column.
- `.hint` blocks are dimmer and indented off a hairline so instructions sit behind the controls.

## Why it mattered

Eight identical dark panels with emoji icons gave no way to tell sections apart while
scrolling, and the subheads used four different inline styles. This is the CRAP pass the
sidebar was missing: contrast (open vs closed, idle vs selected vs grouped), repetition (one
subhead shape, one code chip, one spine), alignment (header and body share a 15px left edge
so codes, labels and fields sit on one line), proximity (checkbox settings tightened, value
grids kept apart, wall groups separated by a hairline).

## Gotchas / pitfalls

- `--cat` is declared on the `.panel` and inherited, so anything rendered into a panel — the
  JS-built opening rows included — picks up the right colour for free. Any new colour rule
  should use `var(--cat, var(--accent))` rather than a literal.
- Gold (`#ffd479`) is reserved for multi-selection and deliberately is not a category colour;
  it matches the ghost outlines the gizmo draws in the viewport. Do not reuse it for a panel.
- `color-mix(in srgb, ...)` is used for tints. Fine in current Chrome; if an older browser
  matters, precompute the rgba values instead.
- The `?v=N` stylesheet cache-buster in `index.html` still has to be bumped on every CSS edit
  (now `v=9`).

## Verification

- `npm test` — 24/24 pass (presentation-only change; one test was added by concurrent work).
- Screenshots at the default sidebar width with all panels open, with two panels open among
  collapsed ones, and with a two-unit group selected: category colour reads correctly on
  spine, chip, chevron, checkboxes and focus rings; codes and titles align on one column; no
  clipped values.
