---
"paperlab": minor
---

`segments: 'auto'` now sizes the grid from the active deformers, which is what the schema always claimed it did.

It did not. It gave the long side a flat 72 whatever was on the sheet, and a deformer's `minSegments` was only ever a floor — so nothing could raise a grid that already started at the highest number anyone asked for, and nothing ever lowered it. A blank sheet was tessellated exactly as finely as a crumpled one, and `crumple`'s `minSegments: 72` was a no-op except against a hand-picked coarser grid.

**The distinction the fix rests on:** `minSegments` is a correctness floor — the density below which a deformer stops working. What `'auto'` needed is a quality target, and a target has to depend on the options, because a bend at `curvature: 0.05` and a roll at `radius: 0.02` are not remotely the same request and one constant per deformer cannot answer for both. So deformers now declare `geometry.autoSegments(options, sheet)` alongside their floor, and six of the seven derive it from the same place: a mesh is a piecewise-linear stand-in for a curved surface, the error is the sagitta `h²/8r`, and inverting that turns "how many segments?" into arithmetic on the radius the options imply.

The tolerance is calibrated rather than picked. At the old flat 72 the default `roll` already ran at a sagitta of 3.9e-4, so that is the tolerance — the tightest configuration in common use keeps exactly the density it ships with, and everything gentler stops paying for precision it was not using.

**This subdivides both ways.** A blank sheet drops to 8 a side; a tight fold rises to 128, which the flat 72 could never give it however much the crease needed. Per preset, in hero mode:

| preset | before | after |
| --- | --- | --- |
| `typed-note`, `blank-sheet` (no deformer) | 7,344 tris | 96 (−99%) |
| `photo-print` (the field starter, a gentle bend) | 7,776 | 512 (−93%) |
| `page-flip` | 7,344 | 4,608 (−37%) |
| `postage-stamp` | 8,496 | 6,784 (−20%) |
| `vintage-note`, `crumpled-note` | — | unchanged |
| `hero-peel`, `flying-note`, `receipt-unroll` | 6,912–7,200 | +78–81% |
| `letter-fold`, `hanging-poster` | 7,344 | 23,296 (+217%) |

Across all presets that is +24% triangles: the library trades geometry away from sheets that were not using it and spends it on creases that were short of it. If the presets that went up are not worth their cost to you, the ceiling is one constant in `core/tessellation.ts`.

The ceiling is 128, and it is a measured CPU budget rather than a round number. Hero mode re-deforms every vertex in JS on the main thread every frame for any animated stack, and `wave` is animated, so a hanging poster pays it permanently rather than only while something plays. One sheet, one re-deform of `drape + wave`: 0.67 ms at 72, 2.05 ms at 128, 4.53 ms at 192, 7.89 ms at 256. 256 is half a 60 fps frame on one sheet on a fast machine; 128 is the last step that leaves room for a scene around it.

In a field (`pnpm perf:field --soft`): `typed-note` goes from 98.3 ms to 23.5 ms a frame at ×20, and 261.5 ms to 37.8 ms at ×60 — 4 fps to 26, at 1.3% of the triangles. `crumpled-note` is unchanged to the triangle, deliberately (below).

**Two things worth knowing before relying on this.**

`crumple` is the one deformer that gets no `autoSegments`, and that is the honest answer rather than an omission: every other deformer approximates a smooth surface, so its density falls out of a radius, but a crumple's creases are exactly where the gradient is meant to break and there is no sagitta to bound. What it wants is segments per cell, which at the default `scale: 3` is the 72 its floor already asks for.

A field is capped separately and lower, at the old flat 72, because it draws that buffer once per instance — the hero ceiling of 128 would be paid sixty times over. `FIELD_SEGMENT_CAP` keeps its original and only job of capping the FLOOR a stack may demand; it explicitly does not cap the target. Capping both looked tidy and was a visual regression, because it is the one thing that could hold `crumple` — which has no target, only a floor of 72 — down to 48 in a field, coarser than the deformer says it needs to read as a crumple at all. Field geometry is therefore unchanged to the triangle from before this release.

Also: the grid is built once, but a behavior's stack is not the same shape throughout — an unroll is a tight roll at one end of its progress and a flat sheet at the other. Sizing to the configured moment would leave the sheet under-tessellated for the rest of the play, so both the hero and field paths sample the behavior's progress across 0→1 and keep the densest answer. That sampling assumes every behavior's `progressParam` runs 0..1, which is true of all ten and is now pinned by a test, because it fails silently otherwise.

`core/tessellation.test.ts` measures the sagitta directly rather than trusting the arithmetic: for every edge of the resolved grid it compares the deformed chord midpoint against the deformer's own answer there, across each deformer's real option range. It also asserts the measure has teeth by forcing a tight bend onto the coarsest grid the ladder allows and requiring it to fail.

Two configurations still do not meet the tolerance and are honest about it: `wave` at `amplitude: 0.3` asks for 272 segments and `drape` at its default depth asks for 154, against a ceiling of 128. They pass the suite on a "no worse than the flat 72 this replaced" clause, which documents a real remaining gap rather than creating slack — closing it costs more CPU per frame than the budget above allows. Recorded in `docs/roadmap.md`.
