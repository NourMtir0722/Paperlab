---
"paperlab": minor
---

`segments: 'auto'` now sizes the grid from the active deformers, which is what the schema always claimed it did.

It did not. It gave the long side a flat 72 whatever was on the sheet, and a deformer's `minSegments` was only ever a floor — so nothing could raise a grid that already started at the highest number anyone asked for, and nothing ever lowered it. A blank sheet was tessellated exactly as finely as a crumpled one, and `crumple`'s `minSegments: 72` was a no-op except against a hand-picked coarser grid.

**The distinction the fix rests on:** `minSegments` is a correctness floor — the density below which a deformer stops working. What `'auto'` needed is a quality target, and a target has to depend on the options, because a bend at `curvature: 0.05` and a roll at `radius: 0.02` are not remotely the same request and one constant per deformer cannot answer for both. So deformers now declare `geometry.autoSegments(options, sheet)` alongside their floor, and six of the seven derive it from the same place: a mesh is a piecewise-linear stand-in for a curved surface, the error is the sagitta `h²/8r`, and inverting that turns "how many segments?" into arithmetic on the radius the options imply.

The tolerance is calibrated rather than picked. At the old flat 72 the default `roll` already ran at a sagitta of 3.9e-4, so that is the tolerance — the tightest configuration in common use keeps exactly the density it ships with, and everything gentler stops paying for precision it was not using. `'auto'` is also capped at 72, the value it used to hand out flat, so **it can only ever subdivide less than before**: nothing gets coarser than it needs, nothing gets finer than it already was.

What that is worth, per preset:

| preset | before | after |
| --- | --- | --- |
| `typed-note`, `blank-sheet` (no deformer) | 7,344 tris | 96 (−99%) |
| `photo-print` (the field starter, a gentle bend) | 7,776 | 512 (−93%) |
| `page-flip` | 7,344 | 4,608 (−37%) |
| `postage-stamp` | 8,496 | 6,784 (−20%) |
| `receipt-unroll`, `letter-fold`, `hanging-poster`, `crumpled-note` | — | unchanged |

And in a field (`pnpm perf:field --soft`, 20 and 60 papers): `typed-note` goes from 98.3 ms to 23.5 ms a frame at ×20, and from 261.5 ms to 37.7 ms at ×60 — 4 fps to 27. `crumpled-note` goes from 131.9 ms to 94.3 ms and from 360.4 ms to 240.0 ms.

**Two things worth knowing before relying on this.**

`crumple` is the one deformer that gets no `autoSegments`, and that is the honest answer rather than an omission: every other deformer approximates a smooth surface, so its density falls out of a radius, but a crumple's creases are exactly where the gradient is meant to break and there is no sagitta to bound. What it wants is segments per cell, which at the default `scale: 3` is the 72 its floor already asks for.

Its field-mode numbers still moved, though, and for a separate reason: `FIELD_SEGMENT_CAP` was a no-op for `'auto'` sheets in the same way `minSegments` was. Field mode capped the deformer floor at 48 and then `'auto'` handed out 72 regardless. The cap now applies to the target too, so a field of crumples renders at 48 × 48 rather than 57 × 72 — visibly slightly coarser creases in field mode only, and a third off the frame time. Hero mode is untouched.

Also: the grid is built once, but a behavior's stack is not the same shape throughout — an unroll is a tight roll at one end of its progress and a flat sheet at the other. Sizing to the configured moment would leave the sheet under-tessellated for the rest of the play, so both the hero and field paths sample the behavior's progress across 0→1 and keep the densest answer. That sampling assumes every behavior's `progressParam` runs 0..1, which is true of all ten and is now pinned by a test, because it fails silently otherwise.

`core/tessellation.test.ts` measures the sagitta directly rather than trusting the arithmetic: for every edge of the resolved grid it compares the deformed chord midpoint against the deformer's own answer there, across each deformer's real option range. It also asserts the measure has teeth by forcing a tight bend onto the coarsest grid the ladder allows and requiring it to fail.
