# Make the exported wording say what this is, who owns what, and when to polish

## What changed

The brief was a good prompt with no framing around it. It now opens by stating
the job and closes with the polish step as a first-class section.

**`src/brief.js`** — restructured, sections renumbered 1–10:

- `## What you are making` — one photorealistic image of this home on this lot,
  and explicitly *a repeatable pattern, not a one-off*.
- `## How to run it — the order matters` — a six-step table: attach → understand
  authority → Turn 1 → check → correct → polish.
- `## 2. Which attachment is the authority on what` — the three-column table that
  is now the load-bearing paragraph of the document, plus per-photo pairing,
  blind-wall handling, and `### Running this on any image model`.
- `## 7. Check the result before you go any further` — a seven-point acceptance
  list, each row naming the correction that fixes it.
- `## 9. The polish pass — run this ONCE, and only last` — its own section with
  *What it is / When to run it / Run it once / Paste this / If the polish drifts
  / Done*, and a fuller polish prompt (grain and depth of field added).
- Turn 1 now branches on which home photos exist, and names the unphotographed
  walls in the prompt itself.

**`src/homephotos.js`** (new) — `HOME_PHOTO_SLOTS`: front, rear, left end, right
end, ¾ catalogue. Each carries the `wall` it shows and the `plate` it pairs with.
`readHomePhotos`, `filledHomePhotos`, `unphotographedWalls`.

**`HOM` panel**, `home.homePhotos`, package entries `40-home-<key>.*` whose
manifest role names the plate to overlay, README purpose/polish/authority
sections, and a `pk_homePhotos` package option.

Also fixed two defects found while testing: `"1 render passes"`, and a single
saved site view producing an `01-INDEX.md` pointing at one folder. `multi` is now
`length > 1`; with exactly one view the package stays flat and renders from that
view. The quota alert now names all the asset classes that can be dropped.

Tests 40–42. 43 pass.

## Why it mattered

Two failures, both from wording rather than code.

**Nobody knew what the polish step was.** It was one bullet in a list of six
corrections labelled "final realism pass". So it got run early, or run three
times. Running it early is the one unrecoverable mistake in the whole workflow:
polish does not fix wrong proportions, it makes them *believable*. An obviously
wrong picture gets caught; a convincing wrong one gets shown to a client. That
argument is now in the document three times — in the run order, in the
acceptance gate, and in the polish section itself.

**Home photos and lot photos were being conflated.** The brief said "use the home
photos (if attached) as the source of truth for finish" and left it there —
nothing said which photo went with which wall, and nothing said that the plate
and the photograph describe the same home and are meant to be used *one over the
other*. That is the actual mental model: the plate is the measured drawing
underneath, the photograph is the finish laid on top. Stating it as a table of
what each asset is *not* authority on turned out to matter as much as what it is.

## Gotchas / pitfalls

- **The pairing has a tie-breaker, and it must favour the plate.** A photograph
  is taken at an angle and foreshortens; the plate is measured. So: appearance
  from the photo, position from the plate, and if they seem to disagree about
  whether an opening exists, the plate wins. Without that sentence the model
  "corrects" the plate to match a perspective illusion.
- **Blind walls are the point, not an omission.** A dealer lot gives you two or
  three sides. The brief names the missing walls explicitly and says extend the
  siding plainly and invent nothing — the hallucinated window wall on an
  unphotographed gable end is the failure the whole package exists to prevent.
- **Model-agnostic means naming roles, not tools.** The adaptation guidance
  degrades gracefully (many-image → few-image → prompt-and-reference) and says
  what carries the dropped information: the tables in sections 3–5 say in text
  what the extra images would have shown.
- **Section numbers are referenced from several places** — the run-order table,
  the acceptance rows, the polish cross-references, and the package README's
  step list. Renumbering means updating all four. Test 41 asserts the acceptance
  check precedes the polish section by index, which catches a reorder.
- **One saved site view should not create folders.** Folders and an index earn
  their keep from two passes up; with one, a flat package with a single
  `01-BRIEF.md` is what the user expects. `ctx.applyView` is still called for
  that single view so its photo and camera are what get rendered.
- **Browser storage fills faster than it looks now.** Four lot-photo slots, a
  site-plan PNG plus its PDF, up to five home photos and a panorama are all
  base64 in localStorage. The lean-save fallback silently drops images; the alert
  now names them all and says to Save JSON. A real fix is IndexedDB — not done.

## Verification

- `npm test` — 43/43 (3 new).
- Brief generated for three states and inspected: no home photos → "No
  photographs of the home are attached"; two → pairing table naming
  `31-front-elevation.png` plus the blind-wall paragraph listing the other three
  walls; all five → pairing table and no blind-wall warning.
- Driven in Chrome: the `HOM` panel renders five cards, a photo loaded through
  the real file input showed "pairs with 31-front-elevation.png", and the package
  emitted `40-home-front.jpg` with the overlay role text.
- One saved view → flat `01-BRIEF.md`, ten numbered sections in order. Two →
  `01-INDEX.md` titled "2 render passes", both per-pass briefs carrying the
  authority table and the polish section.
- **Storage note:** during this session the site plan was silently dropped from
  the browser autosave once the test site views and home photos were added — the
  lean-save path doing its job. It was re-attached and verified (1.6 MB stored,
  photo + plan + PDF all present). Save JSON after loading images.
