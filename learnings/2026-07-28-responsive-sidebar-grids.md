# Responsive sidebar: opening values were being clipped

## What changed

`css/app.css` only — no JS.

- `#sidebar` was hard-pinned at `260px` / `flex: 0 0 260px`. It now uses
  `--side-w: clamp(248px, 21vw, 380px)` with `flex: 0 0 auto`, `min-width: 220px`,
  `max-width: 560px`, and `resize: horizontal` so the user can drag it wider. A
  `max-width: 1000px` media query drops the clamp to `clamp(220px, 32vw, 300px)`.
- Every dense grid switched from a fixed column count to `repeat(auto-fit, minmax(N, 1fr))`:
  opening rows and the group card's value grid at 70px (4 across when there is room, 2 when
  there isn't), `.grid2` at 96px, group actions at 90px, stair/railing sub-grids at 140px.
- Grid children got `min-width: 0` — without it a grid item refuses to shrink below its
  content width and the input overflows its track instead of narrowing.
- Number spin buttons hidden inside the opening / group value grids: they cost ~15px of a
  ~70px field. Values are typed, dragged in the viewport, or nudged from the group card;
  arrow keys still step by 0.25.
- Wall/type selects in the row and group footers are `flex: 1 1 120px` (`130px` in the group
  card) so they wrap to their own full-width line instead of clipping "Front (long wall)".
- `.group-nudge` is a fixed 4-column grid — the four ± steps always sit on one line.

## Why it mattered

At 260px the four value fields were ~49px each, so any offset over three characters
("46.83") was cut off, and the wall/type selects rendered as "Fr" and "W". The panel showed
labels but not the numbers they belonged to.

## Gotchas / pitfalls

- **`css/app.css?v=N` in `index.html` must be bumped** or Chrome serves the stale sheet and
  the new rules silently do nothing. Bumped `v=3` -> `v=6` across this work.
- `#sidebar` has `transition: width 0.2s`. Measuring `getBoundingClientRect()` right after
  setting a width returns the mid-animation value, which reads as "my CSS is being ignored".
  Set `transition: none` before probing widths from the console.
- `auto-fit` leaves collapsed 0px tracks in `getComputedStyle().gridTemplateColumns`; filter
  them out before counting columns.
- `min-width: 0` on grid/flex children is the actual fix for clipping. Changing only the
  track size moves the problem rather than solving it.

## Verification

- `npm test` — 23/23 pass (CSS-only change).
- Browser probe at sidebar widths 220 / 268 / 340 / 440 / 560px: zero inputs where
  `scrollWidth > clientWidth`, no horizontal overflow on `#openingList`, value grid goes
  2 -> 3 -> 4 columns as width allows. Screenshot confirms full values (5, 4, 3.58, 2.92,
  14, 3, 6.5, 0) and full select labels at the default width.
