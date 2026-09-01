---
'paperlab': patch
---

A cloth sheet no longer snaps flat when it is resized.

`sheet.width` and `sheet.height` are a geometry dependency: changing them builds a new mesh, and with it a new `ClothSim`. A new sim starts flat — so a sheet that had spent a second falling into a drape lost all of it the instant anyone touched the size, and came back rigid. Nothing about the physics required that. Nobody had carried the state over.

`ClothSim.adopt(previous)` does now, and `PaperMesh` calls it on every rebuild. The free particles are copied across scaled by how much the sheet grew, and their previous positions with them — velocity in a verlet integrator is the gap between the two, so carrying only the positions would have arrived at the new size perfectly still. The constraints are laid out afresh at the new dimensions, which is what makes the scaling exact rather than approximate: scaling the drape by the same ratio the rest lengths grew by leaves every constraint precisely as violated as it was, and the sim simply continues.

Pinned particles are the exception and keep the new layout's own positions. A pin holds a CORNER, and the corner of a resized sheet is where the resized sheet says it is; carrying the old one over would hang the new sheet from a point no longer on it.

It refuses in exactly one case: **a different grid.** The cloth grid is derived from the sheet's aspect, so a uniform resize keeps it and a lopsided one may not; with a different particle count there is no correspondence between the two sets of particles, and the nearest thing to one would be a guess. Everything else carries — a resize, a change of `pins`, a deformer arriving on top. The sheet's state belongs to the sheet, and none of those is a reason for it to have never fallen.

What this buys is a sheet that can be resized *while it hangs* — including, in `apps/editor`'s hands harness, by spreading two hands in front of a webcam. Resizing as a SHAPE was always free, because a deformer is a pure function of its options and the sheet just redraws at the new size; this closes the gap between the two modes.
