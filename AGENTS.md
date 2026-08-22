# Paperlab — for coding agents

Paperlab renders physical, realistic paper as a React component. Content is a texture on a mesh that genuinely bends — text and imagery curl with perfect continuity. This file is the dense reference for agents integrating Paperlab into a project or contributing to this repo.

> Reading as a human rather than as an agent? The [reference](https://nourmtir0722.github.io/Paperlab/docs/) is the same catalogue with everything rendering live.
>
> Working *on* Paperlab rather than *with* it? Read [docs/roadmap.md](docs/roadmap.md) first — it carries the project's intent, the decisions already settled (and why), and what we plan to build next.

## Integrating Paperlab into a project

```sh
npm i paperlab three @react-three/fiber gsap
```

Peer requirements: React ≥ 19, three ≥ 0.160. TypeScript types ship with the package.

```tsx
import { Paper } from 'paperlab'

// Simplest: a built-in preset. <Paper> owns its own <Canvas> and fills its
// parent — THE PARENT MUST HAVE A HEIGHT or the canvas renders 0px tall.
<Paper preset="receipt-unroll" />

// Or configure inline (all fields optional, validated by zod):
<Paper
  sheet={{ width: 1, height: 2.6, thickness: 0.3 }}
  stock="thermal"          // printer | thermal | kraft | newsprint | vellum | photo-gloss | sticker
  content={{ type: 'receipt', store: 'acme.dev', items: [{ name: 'Widget', price: 9.99 }] }}
  behavior={{ type: 'unroll', progress: 0.6, tightness: 0.5, sway: 0.3 }}
  surface={{ grain: 0.3, deckle: { edges: ['bottom'], roughness: 0.5 } }}
  physics="none"           // 'none' | float | tumble | dangle | taped | breeze | 'cloth' | {type:'cloth',...}
  interactive              // drag handles / grab cloth
  autoplay                 // play the behavior loop on mount
/>
```

Inside an existing React Three Fiber scene use `<PaperMesh />` (same props, no Canvas). For galleries use `<PaperField />`:

```tsx
import { PaperField } from 'paperlab'

<PaperField
  images={['/a.jpg', '/b.jpg', '/c.jpg']}
  preset="photo-print"
  layout="ring"            // ring | fan | spread | pile | wall | spill | sweep | book | accordion | rack | colonnade | sheet
  layoutOptions={{ radius: 3, tiltDeg: 8 }}
  motion={{ driver: 'autoplay', speed: 0.5 }}   // autoplay | drag | none
  entrance={{ type: 'rise', stagger: 0.06 }}    // rise | scatter | none
/>
```

### Stage mode — paper as architecture

`<PaperStage>` builds a *space* out of paper: banners hung along a walk, with
a figure walking down it. It is the one mode where the paper is the room
rather than the object, and it is what the playground is built on.

```tsx
import { PaperStage } from 'paperlab/stage'

<PaperStage
  text="the paper remembers every hand that folded it"   // split across banners, a line each
  count={18}
  stage={{
    path: getWalk('straight'),   // straight | bend | ess | ring | spiral
    shot: { shot: 'follow' },    // follow | lead | low | wide
    lighting: 'nave',            // stage mode is built for this one; the rest are front-lit
    light: { exposure: 0.9, direction: 180, height: 24, studio: 0.55 },  // overrides on the preset
    figure: { model: '/figure/walking.glb', finish: 'shaded' },          // your asset, your URL
    showFigure: true,
  }}
  progress={scrollProgress}      // 0..1 — omit it and the figure walks on its own clock
  quality="auto"                 // auto | low | medium | high — auto adapts to the machine
/>
```

### Content types

`blank`, `image`, `text`, `card`, `receipt` — and any of them can also sit on
the reverse via `content.back`.

**`card` is the paper-artifact type.** One composition — a tracked label, a
hairline rule, a body, and a line of small print — covering the index card,
the library due-date card, the museum wall label, the telegram slip and the
gallery quote sheet, because those are the same object with different parts
present. `{ title, body, note, rule, ruled, align, size, font, color,
padding }`. It exists because `text` sets a block of prose in one size and
one weight, and every artifact above is a *hierarchy*; composing one out of
plain text meant hand-placing newlines and hoping.

**`text` gained `tracking` and `valign`.** Tracking is the control display
type cannot do without — a line set to be read across a room needs it pulled
in, small uppercase needs it pushed out, and neither is reachable by changing
the size. `valign: 'center'` optically centres the block instead of hanging
it from the top edge, which is what a label or a poster wants and what a
letter does not.

**`image.src` may be empty**, and empty renders as bare stock rather than as
a failure. That is what lets `photo-print` and `postage-stamp` be image
presets without the library shipping — or fetching — a photograph; both are
containers for the caller's own art. **No built-in preset touches the network.**

### Lighting is data, not an enum

Eight rigs: `studio`, `window`, `leaves`, `goldenhour`, `noir`, `nave`, and
two built for paper as a material rather than as a surface to print on —

- **`raking`** — a hard key eight degrees above the horizon and well off to
  one side, so it skims ACROSS the sheet instead of landing on it. This is
  how paper is photographed for a swatch book, and it is the only rig that
  turns a crease, a fold or a crumple into relief rather than shading.
  Ambient and studio are deliberately the lowest in the set: raking light
  works by the shadows it casts, and fill is what erases them.
- **`lightbox`** — the lamp behind the sheet and level with it. Every other
  front-lit rig shows you ink ON paper; this one shows light THROUGH it,
  which is what `translucency` has always been able to render and what no
  preset ever made the subject. Printed a stop under for the same reason
  `nave` is.

**Caveat worth knowing before reaching for `raking`:** the surface effects
(`grain`, `aging`, `deckle`, `creaseLines`) are albedo and alpha, not normal
perturbation — there is no bump map. So raking light reveals *geometry*
beautifully and reveals *surface texture* not at all. Making grain read as
fibre under a grazing key needs the shader to perturb normals, which it does
not yet do.

`lighting` names a preset; `light` moves it. Every field is optional and
means "leave this one alone", so a stage serializes the sliders you moved
and nothing else:

| field | what it is |
|---|---|
| `exposure` | tone-mapping exposure — the stop the whole picture is printed at |
| `film` | the tone curve — the *film*, where `exposure` is the stop. `neutral` (**default** — Khronos PBR Neutral, the only one that keeps a clipping warm source warm), `agx` (long graceful roll-off, but desaturates hard toward white), `filmic` (ACES: high contrast, drifts bright neutrals toward yellow-green) |
| `key` | key light intensity |
| `color` | key light colour |
| `direction` | degrees around the room. 0° in front of the paper (+Z), 90° right, ±180° behind — which is what makes `nave` backlit |
| `height` | degrees above the horizon |
| `ambient` | flat fill from everywhere. Cheap, and it kills form — reach for `studio` first |
| `studio` | the room itself, as an environment map. Directional fill, and the only thing paper's sheen has to reflect |
| `haze` | distance haze, as a multiple of the preset's own |

The rig resolves ONCE per scene and everything reads that one object — the
lamps, the environment, the cyclorama, and the transmission through every
sheet. That last one is the point: `translucencyValues()` measures a sheet's
backlit glow against the key light's own position, so a hand-moved lamp
moves the glow with it. Inside your own R3F scene, wrap the paper in
`<LightRig rig={resolveLighting('nave', { direction: 40 })}>` to get the same
guarantee; `<PaperStage>` does it for you.

`resolveLighting(name, overrides)`, `lightAngles(position)` and
`lightPosition(angles)` are exported and pure — the angles round-trip
exactly, which is what lets a slider read the rig and write an override
without drifting.

### The room, and why there is no figure in it

`stage.room` is `{ enabled, height, color }` — a ceiling — and
`stage.ground.slab` is the width of one poured floor slab. Together they are
the scale of the hall.

Stage mode used to be a void with a horizon: a graded dome, a flat plane, and
a bright rectangle at the end, none of it a knowable size. That is why the
walking figure was carrying the entire scale burden alone. Architecture does
the job better — a concrete bay is about two and a half metres and a ceiling
is about three up, and a viewer knows both without being told. They are also
flat surfaces under good light, which is the one thing a renderer never gets
wrong, where a human mesh is the one thing it always does.

**`showFigure` therefore defaults to `false`.** The deciding argument is not
that the model looked cheap; it is that the stage is NAVIGABLE — drag, wheel,
arrow-step, click-to-approach — so there is already a person in the hall and
it is the viewer. A second one walking the same aisle on its own clock
competes for that role. Pass `showFigure: true` to bring it back.

`threshold` is the one preset with a colour in its room. White paper against
warm neutral is white paper against nothing; against a saturated ground it
sings, and `source.color` / `source.zenith` / `ground.color` are the same
three stops that build the environment map, so the bounce is the room's own
colour and cannot disagree with the walls in shot.

### The print (stage mode only)

`stage.grade` is what happens to the frame after the scene is drawn:
`{ bloom, threshold, vignette, grain }`. It lives on the stage rather than on
the lighting rig because `<Paper>` has no composer, and a grade in the rig
would be a promise one of the two modes could not keep.

It needs `@react-three/postprocessing` and `postprocessing`, declared as
**optional peer dependencies** — and that is only honest because stage mode
is its own entry point. `import { PaperStage } from 'paperlab/stage'`. The
main entry never names those modules, so a consumer who imports only
`<Paper>` neither ships their bytes nor has to resolve them. Tree-shaking
alone was not enough: it removes the code but not the import specifier.

`threshold` is in **linear light and defaults to 1.6**, above 1.0 on purpose.
Bloom reads the scene BEFORE the tone curve, so 1.0 means "as bright as
white" rather than "the brightest thing on screen". Lit near-white stock
sits near 1.0 by itself; the source burns several times that. A threshold
under 1 blooms the paper, fogs the hall, and costs the sheets their edges.

**A composer mounts without a tone curve, so `Grade` supplies one.**
`<EffectComposer>` sets `gl.toneMapping = NoToneMapping` while mounted —
tone mapping belongs at the end of a post chain, not the end of the scene
pass — so the chain ends `Bloom → ToneMapping → Vignette → Noise` and reads
`light.film`. Without that effect the whole `high` tier would render
untone-mapped and `light.film` would silently do nothing.

The grade runs on the `high` quality tier only. Measured on the SwiftShader
floor: switching it on at `medium` took the frame 51.0 ms → 92.2 ms (20 fps
→ 11) while `low`, which never had it, held at 26.1 → 28.4 ms.

### Moving through it

The stage was a picture you watched. `motion` is who drives the walk:

```tsx
<PaperStage
  motion={{ driver: 'drag', speed: 1, capture: true }}   // the default
  onVisit={(paper) => console.log('standing at banner', paper)}
  onProgress={(walk) => { scrubRef.current.value = String(walk) }}
/>
```

| driver | who moves it |
|---|---|
| `drag` (default) | the viewer — pointer drag with inertia, wheel, arrow keys, or a click on a paper. **Drifts on the clock until the first time they touch it**, then it is theirs for good |
| `autoplay` | the clock, and only the clock |
| `none` | nobody |

`capture` (default true) is whether the walk takes the WHEEL and TOUCH away
from the page. True for a stage that fills the screen; **false for one
sitting in a column of prose**, where capturing them eats a reader's scroll
and traps a finger on a phone. Mouse drag and arrow keys work either way.
Even when captured, the wheel is handed back at the ends of an open walk.

Arrow keys / PageUp / PageDown step between the papers, Home and End go to
the ends. The stops come from the layout — `Layout.walkStops(n, options)`,
which only a layout that arranges along a path can answer — so a step lands
on a banner rather than near one. The canvas is made focusable and labelled
when a driver is listening.

**Supplying `progress` outranks `motion` entirely.** A stage bound to page
scroll is a controlled component, and a driver writing the same number the
page is writing is a fight rather than a feature.

### The figure

`stage.figure` takes `height`, `speed`, `stride`, `swing`, `gait`, `color`,
`finish`, and `model`. Without `model` it is procedural capsules with a real
gait; with one it is a rigged glTF whose clip is **scrubbed by distance
walked**, not played on a clock, so the feet cannot skate however the walk is
paced. `finish: 'shaded'` (the default) hands the rig to the scene's light —
in a backlit hall that means a rim down one edge and the studio light filling
the other; `'silhouette'` flattens it to one unlit colour.

**The library ships no asset.** `model` is a URL your app hosts. The demo apps
serve a CC0 rig from their own `public/`; installing `paperlab` gets the
capsules and you bring your own. Clips are matched by name — walk, run, idle —
and the shortest matching name wins, so `Man_Run` beats `Man_RunningJump`.

The load-bearing invariant: **every part of the scene reads the same walk.**
The layout arranges along it, the figure follows it, the camera is stationed
on it, and the light source stands at the end of it. Handing any of those its
own copy of a path is the bug this component exists to prevent.

Binding `progress` to scroll is the primary use — the page scroll walks the
figure through the space. That's what `buildStageComponentSource({ …, scroll:
true })` emits, and what the editor's **Copy for AI** offers first in stage
mode. `<PaperStageScene>` is the canvas-less twin for an existing R3F scene.

Stage presets — `nave`, `procession`, `cloister`, `threshold`, `archive`, `ribbon` —
come from `getStagePreset(id)` / `listStagePresets()`. The whole thing
serializes through `stageSchema`, same contract as `.paper`.

Note `quality` is deliberately NOT part of `stageSchema`: it describes the
*device*, not the artwork, so it never travels in a preset or a shared link.
The scene's own parts (the figure, the surround, the gait and camera math)
are not exported — `<PaperStage>` is the composition, and its insides are
free to change.

### Interaction states, the stamp sheet, and drop zones (M6)

A preset may carry `states` — overrides-on-base diffs, never separate presets:

```tsx
// One stamp of a block: hover peels its outward corner, pressing deepens it.
states: {
  initial: 'rest',
  states: {
    hover:   { overrides: { behavior: { progress: 0.22 } }, transition: { duration: 0.25, ease: 'power2.out' } },
    pressed: { overrides: { behavior: { progress: 0.5 } } },
    placed:  { overrides: {}, onEnter: ['emit:postmark'] },   // v1 actions: 'emit:<event>'
  },
  pickThreshold: 0.08,   // world-units drag that tears it off the sheet
}
```

Triggers are built in (rest ↔ hover ↔ pressed; drag past `pickThreshold` →
picked; release over a zone → placed, elsewhere → return). A field whose
slots carry states renders interactive (per-paper hero path) automatically.
The full stamp flow:

```tsx
<PaperField
  papers={Array.from({ length: 10 }, () => ({ preset: 'postage-stamp' }))}
  layout="sheet"                       // rows × columns on a shared backing
  layoutOptions={{ rows: 2, columns: 5 }}
>
  <DropZone id="envelope" accept={['postage-*']}
            bounds={{ position: [3, 0, 0], size: [1.6, 1] }}
            onPlace={(paper, zone) => console.log(paper.presetName, '→', zone)} />
</PaperField>
```

Dragging a stamp past the threshold tears its perforation (edges facing
neighbors flip to 'torn' automatically — torn stays torn), it carries with
the cursor fluttering from drag velocity, the zone glows on approach, and
release settles it with a snap → press → flatten choreography before
`onPlace` fires. Released elsewhere it flutters back to its silhouette on a
curved path. Keyboard flow ships automatically: focus a paper, Enter picks,
arrows move between zones, Enter places, Esc returns. Per-slot state
overrides ride on the slot: `papers: [{ preset, states: { states: { hover:
{ overrides: … } } } }]`.

### Imperative API (`ref` on Paper/PaperMesh)

`play()`, `pause()`, `playing`, `set('progress', 0.5)` (maps to any behavior's progress param), `getProgress()`, `snapshot()` (current state as a preset object), `toJSON()`.

### Behaviors (the `behavior` prop, discriminated on `type`)

| type | params (all optional, sensible defaults) | reads as |
|---|---|---|
| `peel` | progress, corner, radius | a corner lifts and curls back |
| `unroll` | progress (0=rolled, 1=flat), tightness, sway | receipt unrolling from a roll |
| `flip` | progress, spine ('left'/'right'), radius | page turn |
| `letter-fold` | progress, crease | tri-fold letter |
| `hang` | wind, sag | poster pinned at top, rippling |
| `fly` | flutter, curve | airborne note |
| `fall` | flutter, curl | dropped sheet |
| `carry` | grab, stiffness, flutter, lag, drive | held paper drooping from its pinch point |
| `flight` | wind [x,y,z], gustiness, tumble, path, respawn, range | free paper travelling across the scene on the wind |
| `crumple` | progress, coarseness, ball, seed | a sheet crushed in a fist — an irregular network of creases |
| `ribbon` | pool, curl, drape | a strip hung the full drop of a room, pooling where it lands. The one behavior that reads its sheet: the pool begins a fraction above the BOTTOM edge, not at the centre |
| `settle` | relax, lift, corner, slack | a sheet that has landed and relaxed. The pose AFTER `fall`, and everything in it is static — a settled sheet that ripples is one nobody believes |

### Physics

- Idle presets (`physics: 'float' | 'tumble' | 'dangle' | 'taped' | 'breeze'`): cheap curated motion, composes WITH a behavior.
- Cloth (`physics: 'cloth'` or `{ type:'cloth', pins, wind, stiffness, gravity, floor }`): verlet simulation, pins = 'top-edge' | 'top-corners' | 'corner' | 'none'. **Cloth and `behavior` are mutually exclusive** — the schema rejects both together (cloth owns the vertices).

### Presets

Built-ins: `receipt-unroll`, `letter-fold`, `vintage-note`, `hero-peel`, `page-flip`, `hanging-poster`, `pinned-sheet`, `flying-note`, `blank-sheet`, `photo-print`, `typed-note`, `postage-stamp`, `crumpled-note`, `settled-sheet`, `paper-ribbon`. A preset is a `.paper` JSON object validated by `paperConfigSchema`; `getPreset(name)`, `parsePreset(json)`, `serializePreset(config)`, `diffConfig(config)` (non-default values only).

**If the user hands you a `.paper` file** (they made it in the editor, or someone sent it to them), it is already a preset object — import the JSON and pass it straight through. Do NOT translate it into individual props; the whole point of the format is that it round-trips.

```tsx
import theirPaper from './their-paper.paper.json'

<Paper preset={theirPaper} autoplay />
// or, to name it once and reuse it:
import { registerPreset } from 'paperlab'
registerPreset('their-paper', theirPaper)
```

`preset` takes a name (string) or a config object, so both forms are first-class. `describeConfig(theirPaper)` returns the one-line visual to check you rendered what they meant.

### Common pitfalls (check these before debugging anything else)

1. **Blank canvas** → the parent container has no height. `<Paper>` fills its parent.
2. **Text content invisible on first frame** → fonts load async; Paperlab waits for `document.fonts.ready` internally, so give it a beat before screenshotting.
3. **`physics: 'cloth'` + `behavior` throws a zod error** → they're exclusive by design. Pick one.
4. **Reduced motion**: with `prefers-reduced-motion: reduce`, behaviors freeze at their configured pose and physics/entrances are disabled. Override per-instance with `reducedMotion={false}` only when you have a good reason.
5. **No WebGL** → `<Paper>` renders a flat DOM fallback automatically; don't build your own.

### Verification recipe

Run the dev server and look at the canvas: `describeConfig(config)` (exported) generates the one-line expected visual for any config. `<Paper>` also renders a hidden DOM mirror of its content — asserting on that text is a cheap smoke test in E2E suites.

## Working in this repo

pnpm + Turborepo. `packages/paperlab` is the library (the editor consumes it through its public API only — if the editor needs a private hook, the API is wrong). `apps/editor` is the Vite editor.

```sh
pnpm install
pnpm dev            # editor at localhost:5173
pnpm test           # vitest: deformer math, schema, layouts, cloth, exports
pnpm test:parity    # GPU golden-vector gate: GLSL twins vs JS deformers (headless Chromium)
pnpm build          # tsup (library) + vite (editor)
pnpm typecheck
```

Architecture invariants (violating these is a bug, not a style choice):

- **The zod schema (`config/schema.ts`) is the single source of truth.** If a feature can't serialize into a preset, it waits.
- **Deformers are pure vertex functions with dual JS + GLSL implementations.** Any change to one side must change the other; `pnpm test:parity` enforces it. JS runs the hero path (CPU, ≤10 papers, interactive); GLSL runs the field path (instanced).
- **GSAP owns animated values; `useFrame` owns uniform uploads and geometry writes.** Never both on one property.
- **Behaviors are 3–5 human-named params** ('tightness', not 'cylinderRadius') expanding to deformer stacks.
- Deformer loops are allocation-free; content canvases re-render only on content change.

Contribution ladder (easiest first): presets (JSON only) → behaviors (~50 lines over existing deformers) → layouts (~30-line pure function) → deformers (dual-implementation + parity cases in `field/parity.ts`) → surface effects (GLSL chunks in `surface/compose.ts`). See CONTRIBUTING.md.
