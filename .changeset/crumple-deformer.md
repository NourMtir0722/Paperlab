---
"paperlab": minor
---

New: `crumple` — paper that has been handled.

Seven deformers now, and the new one is the first that crushes a sheet. `wave` and `fold` were the nearest and neither reads as crumpled, which made this the biggest single gap in the set: a crumple is the most recognisable paper state there is.

It ships as the whole slice — the `crumple` deformer (JS `displace` plus its GLSL twin, held together by three new cases in `pnpm test:parity`), a `crumple` behavior (`progress`, `coarseness`, `ball`, `seed`), and a `crumpled-note` preset.

The field is the gap between the two nearest points of a jittered cell grid, signed per cell. It vanishes on every cell boundary, so the sheet stays continuous, and its gradient flips across one — which is a crease. What you get is an irregular polygonal network of facets alternating toward and away from you, rather than the periodic egg-crate or the smooth hammered-metal look the two earlier attempts produced. The normals are the point: a crumple that does not shade its own facets is a noisy sheet, not a crushed one.

It asks for `minSegments: 72` and is by some distance the most expensive deformer in field mode — a crease the grid cannot resolve is just a smooth bump.

Also: `describeConfig` now has a phrase for `crumple`, and a test asserts that *every* registered behavior has one, so a new behavior can no longer describe itself as nothing.
