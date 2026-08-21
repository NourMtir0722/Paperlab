---
"paperlab": minor
---

**Lighting is data now.** A preset names a starting point; `stage.light` moves it.

Every other axis of this library is parametric — sheet, stock, surface, deformer stack, layout, walk, shot — and lighting was an enum of six strings. You could not place a light, warm one, or turn the room down. `light` is the missing half, in the terms a person would actually say them in:

```tsx
<PaperStage
  stage={{
    lighting: 'nave',
    light: { exposure: 0.9, key: 3.2, direction: 180, height: 24, ambient: 0.03, studio: 0.6, haze: 1.2 },
  }}
/>
```

`direction` and `height` are **degrees around the room and degrees above the horizon**, not a position vector, because "where is the light" is a question about the room rather than about the coordinate system. `lightAngles()` and `lightPosition()` are exported, pure, and exact inverses — which is what lets a slider read the resolved rig and write back a single field without drifting a millimetre per drag.

Every field is optional, and that is load-bearing: an unset field means *whatever the preset says*, so a shared stage carries the two sliders you moved rather than a frozen copy of a rig you never touched, and re-basing onto another preset keeps your intent instead of your numbers.

**`studio` is new light, not a new slider.** It is the room itself — the same three colours as the cyclorama, plus a soft disc of the key's own colour where the key stands — built procedurally into an equirectangular image and prefiltered through PMREM. No HDRI, nothing fetched, nothing added to the tarball. Flat `<ambientLight>` adds brightness with zero direction, which is the single biggest reason a surface reads flat; this is the same brightness with a shape. Every preset's `ambient` came down accordingly, and paper finally has something for its sheen to reflect.

**And it uncovered a real bug.** `translucencyValues()` reads the key light's own position so a sheet's backlit glow can never disagree with the lamp casting its shadow — but it read it from *the paper's own* `scene.lighting`, and no stage banner ever carried one. **Every banner in every stage computed its glow from `studio`, a lamp up and to the right, while the hall was lit by `nave` from behind.** The coupling was right; the wire was missing. Scenes now publish the rig they resolved through a `<LightRig>` context and the paper reads that in preference to its own name — exported, so a hand-built R3F scene gets the same guarantee. Moving a light writes four uniforms in place rather than rebuilding a shader program, so dragging a slider does not recompile per frame.

Retuned along with it, all of it visible in the README's stage loop: the source at the end of the walk was a hundred units across and filled the frame behind the colonnade, so `source.spread` now sizes it as an opening rather than a wall; its falloff runs from a held core into a long tail instead of dropping to nothing over the last 45%, which had put a visible rim on it like a moon hanging in the room; the nave prints a stop under, because a backlit sheet carries its lamp's whole intensity as transmission and at the old exposure every banner clipped to flat white and lost the folds it was draped for; and the haze reaches past the end of the walk instead of saturating halfway down it.

New in `figure`: **`finish: 'silhouette' | 'shaded'`**, defaulting to `shaded`. A rigged model keeps its own materials and takes the scene's light — in a backlit hall, a rim down one edge and the studio light filling the other. Two clip fixes came with it: `pickClip` now takes the **shortest** matching name, so `Man_Run` wins over `Man_RunningJump` (taking the first match meant a pack that happened to list the jump first put the figure into it for the whole walk), and a frozen figure — which is what `prefers-reduced-motion` produces — stands in an idle clip instead of holding frame 0 of a stride with one leg out.

**What it costs, measured** (`pnpm perf`, native GPU, nave at medium): 44ms → 68ms a frame, all of it the environment sampling in a scene with heavy overdraw, and `pnpm perf` gained a case so the trade stays visible. The `low` tier swaps the environment for a hemisphere light rather than dropping it, so a weak machine still gets light with a top and a bottom; `light: { studio: 0 }` turns it off at any tier without moving the tier.
