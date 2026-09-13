---
'paperlab': minor
---

A burn can now dim the room it is burning in.

`DamageSource` takes an optional `firelight: { room }`: how much of the room's own light is left while the damage burns, from 0 to 1. `<Paper damage>` hands it to its lighting, and `PaperLighting` takes a new `damage` prop that does the same for your own scene. The key, the ambient fill and the studio light are scaled by it every frame, without rebuilding the environment map. Leave it out, and the lighting is exactly what it was.
