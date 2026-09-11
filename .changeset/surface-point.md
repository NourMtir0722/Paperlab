---
'paperlab': minor
---

**`PaperHandle.surfacePoint(u, v, target?)`** returns where a point of the sheet is in world space this frame: on the drawn surface, after the simulation and the deformer stack have run, and interpolated across the triangle the GPU draws so the point is on the paper rather than behind it. `v = 0` is the sheet's bottom edge, the same UV the `damage` grid is laid out on, so a cell of damage can be asked where it is. That is what effects need to emit from a sheet that is draped, blown or crumpled. It returns null before the sheet mounts, and it writes into `target` when you pass one, so reading it every frame doesn't allocate.
