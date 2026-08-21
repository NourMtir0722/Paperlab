---
"paperlab": minor
---

The tone curve is part of the lighting rig, stage mode has a print pass, and the source is a real light instead of a decal.

Three changes that turned out to be one change, because each of the first two only works if the third is true.

### `light.film` — the curve, where `exposure` was already the stop

`<PaperStage>` pinned `ACESFilmicToneMapping` on its canvas in `onCreated`; `<Paper>` never set one and took whatever R3F defaults to. The two modes could disagree about the film while agreeing about everything else, and neither could be told otherwise without forking the component. It is `light.film` now, resolved by `resolveLighting` with everything else and applied by `PaperLighting` beside the exposure it already owned — so a stage and a lone `<Paper>` under the same preset are printed identically by construction.

**Every preset ships `neutral` — Khronos PBR Neutral — and the first attempt at this shipped `agx`, which was wrong.** The reasoning for AgX was sound and the render disagreed: rendered through all three on `nave`, AgX and ACES both bleach a warm clipping source toward grey-white, because both desaturate hard as they approach white. On a hall whose entire subject is warm light coming through paper, that removes the thing you came for. Neutral is built specifically to hold hue and saturation through the roll-off, and it is the only one of the three that keeps the light warm. `agx` and `filmic` remain selectable.

### `stage.grade` — bloom, tone curve, vignette, grain

`{ bloom, threshold, vignette, grain }`, serialized like everything else. It lives on the stage rather than on the lighting rig — the rig is read by `<Paper>` too, and `<Paper>` has no composer, so a grade in the rig would be a promise one of the two modes could not keep.

**A composer takes the tone curve away from the renderer, so the chain has to give it back.** `<EffectComposer>` sets `gl.toneMapping = NoToneMapping` for as long as it is mounted, and it is right to: tone mapping belongs at the end of a post chain, not the end of the scene pass, and a frame mapped twice is wrong twice. What that means is that a composer mounted *without* a `<ToneMapping>` effect silently discards `light.film` entirely. The chain is `Bloom → ToneMapping → Vignette → Noise` — bloom while the frame is still HDR, tone mapping to land it in display range, and the two darkroom moves on the finished print.

`threshold` is in **linear light and defaults to 1.6**, above 1.0 on purpose, and its bound is 4 rather than 1. Because bloom reads the scene before the curve, 1.0 means "as bright as white" rather than "the brightest thing on screen". Lit near-white stock sits near 1.0 unaided; a threshold under 1 blooms the *paper*, fogs the hall, and costs every sheet its edges.

### The source is an emitter now, not a decal

`Source` — the bright void the walk resolves toward — was a `meshBasicMaterial` with `toneMapped: false`. That is a workaround for not having a post chain, and it stops working the moment there is one: a composer maps the whole framebuffer at the end, so a material that opted out of the *renderer's* curve is not exempt from the *composer's*. The source came out crushed to a flat grey panel — the one thing in the scene that must never look like a panel.

It burns at `SOURCE_INTENSITY` (3.4× white, in linear light) and is tone-mapped like everything else. This is both the fix and the more honest description: light is brighter than white, that is what makes it light, a curve rolling off a value above 1.0 is what gives a source falloff instead of an edge, and it is the only thing bloom can key off. `Surround` has spent several versions fighting the same problem with a seven-stop alpha ramp, in geometry, which was the wrong layer.

### Two lighting presets built for paper as a material

`raking` and `lightbox` bring the set to eight.

**`raking`** puts a hard key eight degrees above the horizon and well off to one side, so it skims ACROSS a sheet rather than landing on it. It is how a paper merchant photographs a swatch book, and it is the only rig in the set that turns a fold, a crease or a crumple into relief instead of shading. Ambient and studio are the lowest in the set on purpose: raking light works by the shadows it casts, and fill is exactly what erases them. Measured against `studio` on `crumpled-note`, the difference is not subtle — every crease facet resolves as a distinct light or dark plane where `studio` renders a soft white sheet with a suggestion of texture. First cut had `ambient: 0.06`, which took the shadow side to near-black and made the relief read as holes; lifted to 0.09.

**`lightbox`** puts the lamp behind the sheet and level with it. Every other front-lit rig shows ink ON paper; this shows light THROUGH it, which `translucency` has been able to render since it became a per-stock number and which no preset had ever made the subject. Printed at `exposure: 0.85` for the same reason `nave` is under: a backlit sheet carries the lamp's whole intensity as transmission and clips to flat white at 1.0.

**One honest limit, found by building `raking` and looking at it.** The surface effects — `grain`, `aging`, `deckle`, `creaseLines` — are albedo and alpha, not normal perturbation. There is no bump map anywhere in `surface/compose.ts`. So a grazing key reveals **geometry** beautifully and reveals **surface texture** not at all: a crumple lights up, a sheet of aged newsprint does not. The pitch for this preset was originally "it reveals fibre and deckle as relief", and that half is not true yet. Making it true means perturbing normals in the surface shader, which is its own piece of work.

### Depth falloff, off by default

`grade.depth` is a real optical blur, and it defaults to **0** as a considered answer rather than a stub. Depth in this scene is already staged by haze — one fragment instruction, and how a real hall does it — while optical blur is a second full-screen pass and the effect most likely to read as a video game rather than a photograph. Every paper installation worth copying is shot deep. It ships because a shallow frame is a legitimate look for a close shot on one banner, and the schema is the only place a look is allowed to live. The first mapping focused eight units out, which put the focal plane in the empty air past the paper and left nothing in frame sharp; it now focuses at roughly three units, where the banner you are standing in front of actually is.

### Calibration: the six original presets needed no numbers changed

Rendered under Neutral through the new `pnpm shot:light` harness. They hold, and the warm ones — `goldenhour`, `window`, `leaves` — actively **improve**, because the key colour ACES was desaturating now survives the roll-off. `noir` keeps its crushed shadows and its contrast. This is the answer to "re-calibrate against the new film": measured, and the answer is that the film change was in their favour.

### A harness for judging light, and a bug it found

`pnpm shot:light` photographs one paper preset under one lighting preset headless — `--all` sweeps every rig in one run. Nothing here could previously answer "what does this rig do to a sheet?" without a human opening the editor.

Building it surfaced a real defect in `apps/editor/media.html`: it drew the lamps with `<PaperLighting>` but never published the rig with `<LightRig>`, so every sheet computed its backlit transmission against its own `scene.lighting` — `studio`, a front key — while the actual lamp stood behind it. That is precisely the disagreement `resolveLighting` exists to prevent, and it is why `lightbox` first rendered as a flat grey sheet. The README's motion assets are recorded through that same entry.

### Shipping details

**BREAKING: stage mode moves to its own entry point.** `import { PaperStage } from 'paperlab/stage'` — likewise `getStagePreset`, `walks`, `stageSchema`, `buildStageAgentPayload` and the rest of the stage surface. The main entry is unchanged for `<Paper>` and `<PaperField>`.

This reverses the decision recorded in `docs/roadmap.md`, and the reason it is allowed to is that it is a **different argument**. That decision was about BYTES, and it was right about bytes: tree-shaking already kept stage code out of a `<Paper>` bundle, so a subpath saved nobody a byte. This is about RESOLVABILITY, which tree-shaking cannot fix. Tree-shaking removes the *code*; it cannot remove the *import specifier*. While the main entry named `@react-three/postprocessing`, a consumer who installed paperlab for `<Paper>` alone — and believed the word "optional" — got an unresolvable module at build time. The peers were briefly shipped as `optional` on exactly that false premise.

Measured on the built package, which is the only way this claim is worth anything:

| | occurrences of `postprocessing` |
| --- | ---: |
| `dist/index.js` (main, ESM) | **0** |
| `dist/index.cjs` (main, CJS) | **0** |
| `dist/stage.js` | 4 |

And end to end: with both packages **uninstalled**, bundling `export { Paper } from 'paperlab'` now succeeds and contains zero references. Before the split the same build failed to resolve. `@react-three/postprocessing` and `postprocessing` are `peerDependenciesMeta.optional` again, and this time it is true.

**`three` peer floor rises to `>=0.162`.** `NeutralToneMapping` landed in r162 and is now the default film, so `>=0.160` would have handed r160/r161 users `undefined`.

**The print runs on the `high` tier only, measured rather than assumed.** `pnpm perf --soft` (SwiftShader, the weak-machine floor): switching it on at `medium` took the frame 51.0 ms → 92.2 ms, 20 fps to 11, while `low` — which never had it — held at 26.1 → 28.4 ms. The control is what makes the ~40 ms readable as the grade and not the weather. `medium` is the tier `auto` *starts* at, so paying it there pushes weak machines down to `low`, where they lose the environment light and the shadow map to buy a bloom. Switching it back off returned `medium` to 52.9 ms.

`filmNames`, `FilmName`, `stageGradeSchema`, `StageGradeConfig` and `SOURCE_INTENSITY` are exported. `pnpm shot` takes `--film`, `--bloom`, `--threshold`, `--vignette` and `--grain`.
