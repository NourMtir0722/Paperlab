---
'paperlab': minor
---

A simulation and a shape are no longer alternatives. Cloth hosts a deformer stack.

`physics: 'cloth'` and `behavior` / `deformers` used to be mutually exclusive, rejected by the schema with *the sim owns the vertices*. It was the largest single constraint in the library. Twelve behaviors ship and exactly one of them — `crumple` — could be reached from a sheet anyone could touch, and only by swapping the simulation out first: the drape the sim had spent a second building was thrown away, and the crush started from a flat sheet. Everything about holding a piece of paper and then doing something to it was out of reach, because holding it and doing something to it were different modes.

They compose now. The sim writes the vertices and the stack runs over what it wrote:

```tsx
// Fold the sheet that is hanging there, while it hangs there.
<Paper
  physics={{ type: 'cloth', pins: 'top-corners', wind: 0.3 }}
  deformers={[{ type: 'fold', options: { angle: 90, offset: 0.2, foldAngle: 120 } }]}
  interactive
/>
```

The change is smaller than the constraint it lifts, which is the good news and was also the reason to look: **a deformer is a pure map from a point to a point.** It never asked where its input came from. `applyDeformerStack` already took the base array to start from, so handing it the simulation's live particles instead of the flat rest pose is the whole of the composition. What made this an invariant rather than an omission was three copies of the same early return — in the schema, in `buildStack`, and in `withMemory` — and one of those had already left a note anticipating the day it stopped being the only reader.

Four things had to move with it:

- **The grab has to speak in rendered space.** A pointer hits the sheet you can see, and with a shape running over the simulation that is not where the particles are. It now finds the nearest RENDERED vertex — which is the particle of the same index, because a deformer maps points and never reorders them — and carries the displacement at the moment of the grab as a constant offset. Exact when the grab lands, and honest as the deformation changes under it. Unchanged when nothing is deforming the sheet, where the offset is zero.
- **The cloth grid honours the stack's floor.** `fold` needs 48 segments to bend through rather than crease along. A shape running over a simulation is no less entitled to the grid it needs than one running over a flat sheet — still capped, because every particle is a constraint solve five times a frame.
- **A rebuild keeps the simulation's state.** A stack arriving over a sheet rebuilds the mesh without touching anything the physics knows, so `ClothSim.adopt` carries the particles across. Otherwise the sheet snapped flat at the exact moment you tried to fold the one you were holding.
- **`memory.creases` now bends a cloth sheet, not only shades it.** A crease was always meant to be read by the geometry and the shading both; on a simulated sheet only the shading ran, because the geometry half needed a deformer stack the sheet was not allowed to have. Paper remembers a fold whether or not it is being simulated.

**`strip` stays exclusive, and not out of caution.** Cloth simulates the sheet's OWN grid, so a deformer's uv means on the sim what it means everywhere else. A strip is a 2×N ribbon whose rows are chain nodes: its uv runs along a length of paper that is partly wound on a roll, so a fold placed by uv would land somewhere the sheet is not. The schema says so in those terms now.

**The GPU path is unaffected**, which is worth stating because it is the first question the parity gate raises. Deformers run on the GPU in field mode, and a field has no simulation in it — cloth is hero-path only. All 37 parity cases compare the same JS and GLSL twins over the same flat input they always did.

One limit to know about: `fold` places its hinge by POSITION, not by uv, so over a draped sheet it folds along a line in space rather than along a line in the material. On a sheet that is roughly planar — which is most of what cloth does — those are the same line. On a deeply crumpled one they are not.
