---
"paperlab": minor
---

The room gets architecture that stands in it, and paper gets more than one way to hang.

**`stage.room.columns`** — square piers with a base plate and a capital, down both sides of the walk, spaced by arc length so a bend or a spiral gets even bays. Three instanced meshes, so length is free. A ceiling and floor seams are *boundaries*: they say where the room stops, not how big it is. A base plate is the only element in a scene that puts a hard horizontal edge at a known height off the floor, which is what makes a floor read as a floor — and it is the reading the walking figure was retired for giving. Off by default; `nave` turns it on. Columns stand outside the paper and are darker than it on purpose: the light is the brightest thing in these frames and the paper is second.

**`stage.room.doorway`** — a wall at the end of the walk with the source shining through an opening in it. Without it the source is a bright rectangle in a void: it reads as light, but not as light coming from anywhere. It also gives the room the corner it never had. Off by default; `threshold` turns it on.

**`stage.suspension` now names the hardware properly.** `type` is what carries the load — `'thread'` (one line per sheet), the new `'rod'` (a dowel across the sheet's top edge, hung at both ends so it cannot tip), or `'none'`. `hardware` is what grips the sheet — `'clip'` (wide and shallow, across the edge), the new `'peg'` (narrow and deep, down the face), or `'none'`. Hardware also scales with the sheet it holds now, which it did not.

**Breaking:** `suspension.clips: boolean` is replaced by `suspension.hardware: 'none' | 'clip' | 'peg'`. `clips: true` becomes `hardware: 'clip'`, which is the default, so a stage that never mentioned it is unchanged. A boolean was the reason two of the four pieces of hardware the plan named had no way to be asked for.
