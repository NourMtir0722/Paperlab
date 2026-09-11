---
'paperlab': minor
---

**Paper can be damaged, and `paperlab/fx` is what damages it.**

`<Paper damage={source}>` is a new prop on the main entry: a grid of char, saturation, heat and missing paper over the sheet's UV, which the sheet draws and simulates without knowing what caused it — the same split `content` already has. `DamageSource` is the whole seam (see `DAMAGE_CHANNELS`), so a baked texture or a recorded burn played back works as well as a live simulation. An untouched field draws byte-identical to no field at all, which a render, not an argument, is what settles.

What the sheet does with it:

- **Shading** — a brown scorch going black, wet paper darker and smoother, holes cut at half presence (in the shadow map too, through a custom depth material), the burning line drawn as light, and a per-fragment fray that makes a burnt edge ragged rather than a staircase. How ragged is `DamageSource.detail`, which a source can turn down.
- **Physics**, on a cloth sheet — char shrinks the paper and curls it toward the flame, saturation makes it heavier, and paper that has burnt away leaves the solve, so a sheet whose lower half is gone stops hanging off the weight of nothing. A hand cannot take hold of paper that is not there.
- **`PaperHandle.surfacePoint(u, v)`** answers where a point of the sheet is in world space this frame, on the drawn surface — which is how anything can emit from a sheet that is draped, blown or crumpled.

`paperlab/fx` is a new subpath, and it holds the causes: `DamageField` (a CPU, untiered, fixed-timestep simulation of heat, water, char and presence, with the paper's own grain and fibre direction in it), the particle pool with ember, smoke and ash presets, `FireEmitter`, `FxParticles` to draw them, and `FxAudio` + `FireSound`, which synthesises a fire from the same numbers the picture is drawn from — a bed on the length of the burn front, a crackle on the rate paper chars. Its own subpath so that a `<Paper>` consumer never resolves any of it.

A stated limit: a cut narrower than a cloth cell separates the picture, not the paper. Splitting a sheet in two needs a second mesh, and this is not that.
