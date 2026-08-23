---
"paperlab": patch
---

The ribbon stage renders what it is for, and banner type is set to the measure.

**`ribbon`'s crease could not reach a right angle.** `foldAngle` was `62 + curl * 46`, so below curl 0.61 — including the default, and including the value the ribbon stage shipped — the pooled length was still travelling downward when it passed the crease and went through the floor. Above 0.61 it tilted back up and floated. A hinge turns through one angle and the flap holds that heading, so only 90° is the floor: it is fixed at 90 now, and `curl` drives the crease radius, which is what its own description always said it did. The crease is also placed a hinge-radius higher, because the flap leaves the hinge cylinder that much below the crease line — measured at ~9cm under the floor on the stage's own numbers.

**`ribbon` uses `drape` again.** It had been switched to `wave` to work around a report that `drape` rendered an invisible sheet on the CPU path. That report does not reproduce; it rested on counting colours in a screenshot, and a near-flat strip filling the frame has about as many colours as an empty one. `wave` was never the same picture either — a sine runs at one amplitude end to end, and a hung strip is flat where it is held and gathers as it falls.

**Banner type was sized by the drop and never by the measure.** On a tall narrow banner the chosen size was wider than the sheet, so every word was broken wherever the measure ran out and the column then overran the drop and was clipped. `bannerTextSize` now takes the longest word and the measure (`bannerMeasure` states how much room there is, once), and a single-word column is set one letter to a line on purpose (`letterColumn`) instead of being shattered at arbitrary points — `carried` reads down its banner rather than as `ca / rr / ie / d`. Columns are centred down the drop, since one size is shared by the whole rank. `splitAcrossBanners` also dealt with a stride that dropped banners: twenty words over twelve gave ten columns and left two blank.

**New: `deformers/draws.test.ts`** — every registered deformer, built into a real sheet on two aspect ratios, asserted to be finite, actually moved, still to have most of its area, and to have unit normals. A parity gate proves the two implementations agree, not that either one draws; this is the missing half, and a new deformer cannot skip it.
