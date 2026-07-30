# Accessories come off the home photographs, not off the model's taste

## What changed

`src/brief.js` now states, explicitly and in five places, that shutters, exterior
light fixtures and the rest of the mounted accessories are read off the attached
home photographs — and that an accessory the photographs do not show must not
appear in the render.

- New exported `ACCESSORIES` list (shutters, exterior lights, gutters/downspouts,
  roof and gable vents, railings/posts/columns, and mounted hardware such as
  address numbers and meters), each entry worded as an instruction rather than a
  noun, so it survives being pasted into a prompt.
- Section 2 gains "Accessories are read off the photographs — copy them, do not
  invent them", with the both-ways rule: photographed means present,
  unphotographed means absent.
- The photograph/plate pairing paragraph now says appearance **and every
  accessory** comes from the photo, and to count them.
- Turn 1 (section 6) repeats the list inside the pasted block-quote.
- Acceptance list gains row 8 (accessories), and the gate reads "All eight pass".
- Section 8 gains an **Accessories** correction, wired to row 8.
- Polish pass explicitly forbids adding or removing accessories.
- The unphotographed-walls paragraph extends "invent nothing" to accessories.

Fixed while in there: the `### No photographs of the home are attached` section
was written as `else if (!shot.length)` after `if (blindWalls.length)`. With no
photographs every wall is blind, so that branch was unreachable in exactly the
case it was written for. It is now its own `if`.

## Why it mattered

The plates are untextured geometry and sections 3–4 describe surfaces only.
Nothing in the package told the image model where shutters or porch lights come
from, so it treated them as styling — inventing shutters on a home that has none,
dropping the lights on a home that has them. A buyer does not read a siding hex
code; they notice their porch light is gone. Naming each accessory class is what
turns it from a stylistic choice into a copy job.

## Gotchas / pitfalls

- The absence rule needs saying as loudly as the presence rule. "Match the
  photographs" alone reads as permission to embellish; "if the photographs show
  no shutters, the render has no shutters" does not.
- Row numbering in section 7 is hand-written in the table and referenced twice in
  prose ("All eight pass", "When all eight checks in section 7 pass"). Adding a
  row means updating both.
- The accessory list is emitted twice with different prefixes — bare `- ` in
  section 2, `> - ` inside Turn 1's block-quote. Keep both when editing.

## Verification

`npm test` — 60 tests, 60 pass. New test 59 asserts every accessory word reaches
the brief, that `ACCESSORIES` lands verbatim, that the no-shutters rule and the
row-8 check are present, and that with `homePhotos = {}` the brief says the home
carries **none** (which is what caught the dead `else if`).
