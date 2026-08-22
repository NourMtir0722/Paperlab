---
"paperlab": minor
---

Paper hangs from something now, and it can have landed.

Two primitives, shared by three of the four gallery stages still to come — built once here rather than three times later.

### `settle` — the pose after the fall

The library could drop paper (`fall`), fly it (`fly`, `flight`), heap it (`pile`) and catch it mid-air (`spill`), and had no way at all to show a sheet that has **arrived**. Every reference installation worth copying has paper on the floor: sheets settled on concrete after the fall, ribbons pooling where they meet the ground. It is the most beautiful detail in the set and it appears there twice.

**The distinction from `fall` is not the shape, it is the clock.** `fall` flutters — its wave carries `speed: 1.3`, because it is a sheet still arguing with the air. This one is over. Everything in `settle` is static, and that is the point: a settled sheet that ripples is a settled sheet nobody believes. It also costs a per-frame re-deform forever, for motion that should not be there. A test asserts it at every setting.

`{ relax, lift, corner, slack }`. `relax` is how long ago it landed; `lift` is how hard the stock resists lying flat, and it is the floor under the relaxing — tissue surrenders completely, card never does. Relaxing subtracts; stiffness is what it will never give back.

It is a **behavior**, not a deformer, because a landed sheet is a gentle curl the stiffness held on to plus a long slack undulation where it bridges the floor — and both already exist. A deformer that can be spelled out of the ones we have does not earn a GLSL twin and a parity case.

**The first version rendered a flat rectangle**, which is the one outcome it exists to avoid: the corner lift was scaled *below* `fall`'s, when a settled sheet should keep more than a falling one — that corner is the thing gravity could not take from it. Recalibrated against `fall`'s own numbers and pinned by a test.

Ships with a `settled-sheet` preset.

### Suspension — what holds the paper up

Every paper installation shows its hardware: monofilament from a ceiling grid, steel wire, bulldog clips, a rod. In the scattered-sheet pieces the threads are half the composition. Stage mode's banners hung from **nothing at all**, which is a larger realism gap than any shader in the backlog and closes for a few thin lines of geometry — a hung thing that shows what suspends it stops reading as a rectangle that happens to float.

`stage.suspension` is `{ type: 'thread' | 'none', color, clips }`.

**Both halves are one draw call each.** The threads are a single `LineSegments` buffer rather than N line meshes, and the clips are an `InstancedMesh`, because a field of forty banners is drawn in one call and it would be absurd for the string holding them up to cost eighty more.

Two details that are easy to get wrong and are pinned by tests. A thread attaches to the sheet's **own top edge**, rotated the way the pose rotates it — so a tilted banner's thread follows its top rather than rising from a point above its centre. And the clips are sized off the sheet rather than in world units, so a clip on a postage stamp and a clip on an eight-metre banner both look like a clip.

The threads deliberately cast no shadow: a shadow map at this scale renders monofilament as a black bar across the floor, far more visible than the thread itself and completely wrong.

**Worth knowing where you will and will not see it.** The colonnade stages are framed at eye level down an aisle, and the banners are tall enough that their tops — and therefore their threads — sit above the frame. It reads in a `wide` or raised shot, and it will matter properly in the gallery stages, where paper hangs at varying heights in view. That is what it was built for.
