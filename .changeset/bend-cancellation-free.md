---
"paperlab": patch
---

Fix: `bend` and its GLSL twin disagreed at low curvature, and the parity gate never looked there.

The arc's in-plane shift is `r·sin θ − d`, and `d` **is** `r·θ` — so for a gentle bend it is a difference of two nearly-equal large numbers, and the answer is whatever bits survive. `r(1 − cos θ)` has the same problem. JS computes both in float64 and gets away with it; the GLSL twin computes them in float32 and does not. The two paths were **6.1e-4 apart** at `curvature: 0.35` — past the parity gate's 5e-4 epsilon — meaning hero mode and field mode were rendering measurably different arcs.

It went unnoticed because the gate only ever exercised `|curvature| ≥ 0.6`, while `photo-print` — the field starter preset, and the one every gallery layout is demoed with — bends at `0.35`, squarely inside the untested band.

`bend` is now written in its cancellation-free form on both sides: `r(1 − cos θ)` as `2r·sin²(θ/2)`, and the in-plane shift through a `sin(x) − x` helper that uses a series below |x| = 1 and the direct form above it. Same arc to sixteen places — only the float32 half could tell the difference, and that is exactly the half that was wrong. Worst-case parity error at 0.35 drops from 6.1e-4 to 2.1e-5, and the *existing* bend cases improved by an order of magnitude too. Two permanent low-curvature parity cases now cover the band, including the gentlest arc the schema allows.
