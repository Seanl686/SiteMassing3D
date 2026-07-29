# The picker was right and the answer still looked wrong

## What changed

A report that the picked colours were "really off from what's actually there",
against a photo of a white trailer that came back as mid greys. Measuring the
screenshot settled it: the siding pixels in that photograph are `#a4a6a1`,
`#aaada6`, `#b0b2b1`, `#a9afaf`, `#a2a9ad`. The app reported `#acb1b1`. The
sampling was correct to within a few units.

Two real defects surfaced on the way to establishing that, plus the feature the
complaint was actually asking for.

**1. Palette entries were colours the photo did not contain** (`src/eyedrop.js`)

`quantize` returned the arithmetic mean of each median-cut box. A box straddling
white siding and blue sky averages to a lifeless grey. On the user's own lot
photo, every entry claiming 13% of the image matched under 2.3% of its pixels.

`representative()` now takes the per-channel median of the box and then
re-averages only the members within `tolerance` of it — one mean-shift step onto
the box's dominant cluster. Boxes that converge on the same cluster are merged.

**2. The percentages were fiction**

Weights were box sizes, and once entries could merge they no longer partitioned
anything — the swatch legend summed past 100%. Every sampled pixel is now
assigned to its nearest representative, so the numbers add up to 100.

**3. White balance — the thing actually being asked for**

New `whiteBalanceGains` / `applyWhiteBalance` (`REFERENCE_WHITE = 242`), and a
`⬜ Set white point` control in the picker: arm it, click something you know is
white, and every pick, the readout and the whole palette are corrected for the
light the photo was shot in. The readout shows the raw value alongside the
corrected one, and `✕` returns to raw. Already-assigned colours are left alone.

Tests 57 and 58 added.

## Why it mattered

The eye discounts the illuminant automatically and a sensor does not. A white
house shot against a bright sky, exposed for the sky, has siding pixels around
`#a5aaaa` — and reporting `#a5aaaa` is both correct and useless, because nobody
looking at that photo thinks the house is grey. Without a white point there was
no way to get from "what the camera recorded" to "what colour the paint is",
which is the question the whole feature exists to answer.

The palette defect was independent and worse than it looked: the suggested
colours were phantoms, so "Auto-assign all" was proposing finishes that appear
nowhere in the photograph.

## Gotchas / pitfalls

- **The mean of a cluster is not a member of it.** Median cut's boxes are
  rectangles in RGB, and a rectangle spanning two populations has its centre in
  the empty space between them. Take a median and mean-shift, or you ship
  colours that do not exist.
- **Check a palette by asking how many pixels are actually near each entry.**
  "This box holds 13% of the image" and "13% of the image is this colour" are
  different claims, and only the second one is what a legend means.
- **Overlapping tolerance counts do not sum to 100.** If a legend shows
  percentages, they have to come from a partition — nearest-representative
  assignment — not from a radius test.
- **A user reporting a wrong colour may be reporting a correct reading.**
  Measure the source pixels before changing the sampler. The fix here was not to
  the sampler at all.
- Cache the *raw* quantisation and apply the white point on the way out, so
  changing the reference does not re-quantise the photograph.
- A near-black reference carries no information about the illuminant; dividing
  by it scales everything to clipping. `whiteBalanceGains` returns null below 40.

## Verification

- Measured the user's screenshot directly: reported `#acb1b1` against actual
  siding pixels of `#a4a6a1`–`#b0b2b1`. The sampler was accurate.
- Their real lot photo, before: palette entries claiming 13% coverage matched
  0.2–2.3% of pixels. After: entries are real colours and weights partition.
- White point, end to end in the browser on a stand-in built from their measured
  values: siding `#A5ABAB` and trim `#CACECD` raw; after clicking the trim as the
  white reference, trim `#F2F2F2` and siding `#C6C9CA`, palette swatches
  corrected with it, percentages 48/30/20/2 summing to 100.
- `npm test` — 59 pass. No console errors.
