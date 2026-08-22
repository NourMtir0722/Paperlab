---
"paperlab": minor
---

The Ribbon: a strip hung the full drop of a room, pooling where it lands.

The strongest image in the reference set, and the payoff for the four phases before it — it needs a room with a ceiling to hang from, hardware to hang by, type that can be set down a length without reading as a caption, and a crease that begins at the floor line rather than at the sheet's centre. Ships as the `ribbon` behavior, the `paper-ribbon` preset, and the `ribbon` stage.

### What it is made of, and two things the render corrected

A ribbon is folds down its length plus a hinge where it meets the ground. Both already existed, so it is a behavior rather than a deformer — but neither of the obvious choices survived contact with a render.

**`wave`, not `drape`.** `drape` is the obvious deformer for folds down a hanging sheet, and it renders an **invisible sheet on the hero (CPU) path** — at any grid, including an explicitly fixed one. See below; it is written up as an open bug. `wave` pinned at the top is the same picture by another road, and is proven on both paths.

**`fold`, not `roll`.** A roll wraps the pooled length around a cylinder, so it curls up and over and finishes in mid-air: a hook, not a pool. Paper meeting a floor does not wrap — it creases and lies down. A soft hinge at the floor line does exactly that, and the length below it runs out flat along the ground.

The hinge is placed from the **sheet**, which makes this the one behavior that genuinely needs the second argument to `stack()`: "a pool-length above the bottom edge" is meaningless without a height. Its radius scales with the sheet too, because a fixed hinge that reads as a fold on a short strip reads as a knife-edge on a long one.

`progressParam` is `curl` rather than `pool`, and for a mechanical reason: the grid is sized by sampling that parameter from 0 to 1, so it has to *be* a 0..1 parameter — a `pool` bounded at 0.5 would be sampled across a range it rejects — and it should be the one that drives the geometry hardest.

### `colonnade.hover` may go below zero now

Its own comment claimed "0 = they pool on it", and at 0 a banner's bottom **edge** sits on the floor, which is not the same thing at all. A ribbon creases a pool-length *above* its bottom edge, so it has to hang that much lower for the crease to land on the ground — otherwise the slack lies flat in mid-air, parallel to a floor it never touches.

The bound was `min(0)`, so the one thing the option documented itself as doing was the one thing it could not do. It is `min(-0.5)` now, and the `ribbon` stage sets `hover` to exactly minus its pool fraction.

### An open bug this turned up

**`drape` renders nothing on the hero path.** Not faintly — the frame contains one colour, the background. Ruled out in order: the math (swept across its whole option range, every vertex finite and bounded), tessellation (an explicit `segments: 96` renders the same blank), and the sheet and content (identical ones render fine under `hang`). Isolated by bisecting the stack: `roll` alone renders, `drape` alone is blank, both together blank.

Nobody had hit it because `drape` had exactly one caller in the library — the stage banner — and that runs the field/GPU path and its GLSL twin. No behavior and no paper preset had ever put it on the CPU side. **Which is worth stating plainly: a parity gate proves the two implementations agree, not that either one draws.** Written up in `docs/roadmap.md`.

### The stage

Tighter than the banner stages and hung lower, with a raised camera and a short look-ahead — pooled paper lies *flat*, so from standing height it foreshortens to a sliver and the shot has to get above it for the thing this stage is about to read at all. Twelve strips, a low ceiling so the drop reads as the height of the room rather than as a short thing in a tall one, and the suspension threads finally in frame where they were built to be.
