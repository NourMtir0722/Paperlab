---
"paperlab": minor
---

New: `crumple` — paper that has been handled.

Seven deformers now, and the new one is the first that crushes a sheet. `wave` and `fold` were the nearest and neither reads as crumpled, which made this the biggest single gap in the set: a crumple is the most recognisable paper state there is.

It ships as the whole slice — the `crumple` deformer (JS `displace` plus its GLSL twin, held together by three new cases in `pnpm test:parity`), a `crumple` behavior (`progress`, `coarseness`, `ball`, `seed`), and a `crumpled-note` preset.

The field is the gap between the two nearest points of a jittered cell grid, signed per cell. It vanishes on every cell boundary, so the sheet stays continuous, and its gradient flips across one — which is a crease. What you get is an irregular polygonal network of facets alternating toward and away from you, rather than the periodic egg-crate or the smooth hammered-metal look the two earlier attempts produced. The normals are the point: a crumple that does not shade its own facets is a noisy sheet, not a crushed one.

It is the most expensive deformer in the set, and measurably so: `pnpm perf:field` puts a field of them about 45% longer per frame than the same field of an undeformed preset. Almost none of that is geometry — `segments: 'auto'` already gives every sheet 72 a side, so its `minSegments: 72` is a floor that only bites when a preset asks for a coarser grid by hand. The cost is the nine cell lookups per probe, three probes deep for the vertex normal.

Also: `describeConfig` now has a phrase for `crumple`, and a test asserts that *every* registered behavior has one, so a new behavior can no longer describe itself as nothing.
