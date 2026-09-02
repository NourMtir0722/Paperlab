# Paperlab — for coding agents

Paperlab renders physical, realistic paper as a React component. Content is a texture on a mesh that genuinely bends — text and imagery curl with perfect continuity. This file is the dense reference for agents integrating Paperlab into a project or contributing to this repo.

> Reading as a human rather than as an agent? The [reference](https://paperlab.nawwara.studio/docs/) is the same catalogue with everything rendering live.

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
  physics="none"           // 'none' | float | tumble | dangle | taped | breeze | 'cloth' | 'strip' | {type:…}
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

`stage.room` is `{ enabled, height, color, columns, doorway }` and
`stage.ground.slab` is the width of one poured floor slab. Together they are
the scale of the hall.

A ceiling and floor seams are both **boundaries** — they say where the room
stops, not how big it is. The two pieces that stand IN it are off by default,
because either one is a strong compositional claim and a stage that did not
ask for one should not grow one:

- **`room.columns`** `{ enabled, spacing, width, offset, color }` — square
  piers with a base plate and a capital, down both sides of the walk, spaced
  by arc length so a bend or a spiral still gets even bays. The base plate is
  the part doing the work: it is the only element in the scene that puts a
  hard horizontal edge at a **known height off the floor**, which is what
  makes a floor read as a floor. They stand outside the paper (`offset`
  clears a colonnade's widest aisle) and they are darker than paper on
  purpose — the light is the brightest thing in these frames, the paper is
  second, and a column at paper value reads as more paper. `nave` uses them.
- **`room.doorway`** `{ enabled, opening, color }` — a wall at the end of the
  walk with the source shining through an opening in it. Without it the
  source is a bright rectangle in a void: it reads as light, but not as light
  coming from anywhere. With it the walk resolves toward an opening in a
  surface, and the room gets the corner it never had. `threshold` uses it.

`stage.suspension` is `{ type, color, hardware }`. `type` is what carries the
load — `'thread'` (one line per sheet to the ceiling), `'rod'` (a dowel across
the sheet's top edge, hung at both ends), or `'none'`. `hardware` is what
grips the sheet — `'clip'` (wide and shallow, across the edge), `'peg'`
(narrow and deep, down the face), or `'none'`. They are told apart by
silhouette, which is all that survives the distance this scene works at.
`archive` hangs on rods; `cloister` uses pegs.

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

### Interaction states, the stamp sheet, and drop zones

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

`play()`, `pause()`, `playing`, `set('progress', 0.5)` (maps to any behavior's progress param), `getProgress()`, `snapshot()` (current state as a preset object), `toJSON()`, `handlePoint(id?, target?)` (where a behavior's grab point is in world space this frame — it rides the deformed surface, so nothing outside the render can compute it; null when the behavior has no handles).

### Behaviors (the `behavior` prop, discriminated on `type`)

| type | params (all optional, sensible defaults) | reads as |
|---|---|---|
| `peel` | progress, corner, radius | a corner lifts and curls back |
| `unroll` | progress (0=rolled, 1=flat), tightness, sway, from, core, tail, fixed, floor | paper coming off a roll that shrinks as it pays out. `from:'top'` hangs the paper below the roll, `fixed` keeps the roll on its holder and moves the paper instead, `tail` leaves a leaf already out, `floor` gives the drop somewhere to land |
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

### Memory — the paper keeps what you do to it

Paper is plastic where cloth is elastic: fold it and the fold stays. Every deformer is a pure function of its options, so without this a sheet folded to 180° and back to 0° comes out pristine — right for cloth, wrong for paper.

```tsx
<Paper
  preset="letter-fold"
  memory={{
    set: 0.6,                                          // how much of a fold this paper keeps, 0..1
    creases: [{ angle: 270, offset: 0.23, depth: 13 }] // and the creases it already has
  }}
/>
```

`set` is an override on the stock's own `takesSet` — kraft 0.85 holds a crease hard, vellum 0.25 springs back. Leave it out and the stock decides. `memory: { set: 0 }` is the opt-out, and it is exactly how every sheet behaved before this existed.

A **crease** names its line the way `fold` does: `angle` is the direction the fold travels, the crease line runs perpendicular to it, `offset` is the signed distance of that line from the sheet's centre. `depth` is the signed residual fold angle — the whole of what a crease is, read by both the geometry and the shading. Four maximum, which is what the crease shader carries.

Creases are **recorded by folding the paper**: a fold that closes past `CREASE_MIN_GROWTH` (45°) at a line that stays put leaves one, at `peak × set × MAX_SET`. A fold whose line *travels* leaves nothing — `unroll`'s landing hinge sits at 90° forever while it walks down the sheet, and paper coming off a roll is bent at the floor, not creased. `onCrease` fires when the set changes so a host can persist it; the sheet applies its own creases immediately either way.

Applied, a crease is a **floor on the fold at its line, never an addition**. While the behavior folds that line further the crease is invisible; as it lets go the angle falls to the crease's depth and stops. That is what makes a crease appear on the way *out* of a fold with nothing detecting the release.

Hero path only — a crease is per-sheet state and the field is one instanced draw call.

### Physics

- Idle presets (`physics: 'float' | 'tumble' | 'dangle' | 'taped' | 'breeze'`): cheap curated motion, composes WITH a behavior.
- Cloth (`physics: 'cloth'` or `{ type:'cloth', pins, wind, stiffness, gravity, floor }`): verlet simulation, pins = 'top-edge' | 'top-corners' | 'corner' | 'none'. **A resize keeps the drape.** Sheet dimensions are a geometry dependency, so changing them builds a new mesh and a new sim — and a new sim starts flat, which snapped a hanging sheet rigid the moment it was resized. `ClothSim.adopt` now carries the free particles (and their velocity) across the rebuild, scaled by how much the sheet grew, while pins take the resized layout's own corners. It refuses a different grid, because the particles do not correspond, and it refuses a rebuild at the SAME size, because that was a change of pins or of physics — a restructuring — and those still reset the sheet by design.
- Strip (`physics: 'strip'` or `{ type:'strip', scroll, tightness, core, tail, perforation, crease, stiffness, drag, gravity, floor, inertia }`): a roll paying paper out, and the pile it makes when it lands. See below.

**Cloth HOSTS a shape; `strip` does not.** `physics: 'cloth'` composes with `behavior`/`deformers`: the sim writes the vertices and the deformer stack runs over what it wrote, so you can fold, peel or crush the sheet that is hanging there — and it stays grabbable while you do. It works because a deformer is a pure map from a point to a point and never asked where its input came from. `strip` stays exclusive: its 2×N ribbon has chain nodes for rows, so its uv runs along a length of paper that is partly wound on a roll, and a fold placed by uv lands somewhere the sheet is not. Idle presets compose with anything — they are a whole-object transform.

Three consequences worth knowing. The cloth grid honours the stack's `minSegments` (a `fold` needs 48 to bend through rather than crease along), still capped at 28. A grab finds the nearest RENDERED vertex rather than the nearest particle — same index either way, because a deformer never reorders points — and carries the displacement at grab time as a constant offset. And `memory.creases` bends a cloth sheet now instead of only shading it, which is what a crease was always defined to do.

#### `strip` — the one simulation with a driving body

Cloth is a passive grid. `strip` is a *kinematic roll* that the host turns,
extruding a verlet chain that is then left to fall:

```tsx
const [scroll, setScroll] = useState(0)
useEffect(() => {
  const onScroll = () => setScroll(window.scrollY / 120)
  window.addEventListener('scroll', onScroll, { passive: true })
  return () => window.removeEventListener('scroll', onScroll)
}, [])

<Paper preset="toilet-roll" physics={{ type: 'strip', scroll }} />
```

**`scroll` is a monotonic world-unit figure, not a 0..1 progress.** The sim
differentiates it and only ever reads the delta, so the absolute value never
matters, a big `scrollY` on the first frame is read as an origin rather than
as one enormous delta, and scrolling back up rewinds the roll — dragging the
pile taut before it lifts.

Three things follow from the physics and are the reason to reach for it:

- **The roll shrinks as it empties**, by area conservation, down to `core`.
  `ΔL = R·Δθ` at the *current* radius, so a nearly-empty roll spins fast and
  gives up very little paper. That is how a roll reads as running out.
- **It buckles at the perforations.** Every joint wants to be straight;
  a joint at a perforation wants it far less and may remember a fold
  (`crease`). Once the tip is grounded and paper keeps feeding, compression
  builds and the strip folds back on itself in alternating directions.
- **Folds stack instead of passing through**, via a spatial hash. Without
  self-collision the pile flattens into nothing, which is the entire effect.
  Two details are load-bearing and both were learned the hard way: collision
  tests SEGMENT against segment rather than node against node, and it is
  interleaved with the last few constraint passes rather than run once after
  them. Point collision leaks — paper is thinner than the chain is finely cut,
  so a sphere per node leaves gaps between the beads and another fold threads
  through one — and separating folds after the last iteration leaves nothing
  to restore their rest lengths, so the next substep pulls them back through.
- **The roll never leaves its holder.** One wrap is held back as `tubeStub` —
  a real roll's inner end is glued down — so paying out the last of the paper
  cannot free the nodes the roll is made of and drop the whole roll onto its
  own pile. What is left is a cylinder at the core radius, which is as close to
  a cardboard tube as one sheet of geometry gets.

**It folds in DEPTH, and a head-on camera cannot see that.** The chain
simulates two dimensions — it hangs in y, folds in z, keeps its full width in
x, and never twists — which is what keeps self-collision a cheap 2D query. But
every camera in the library is fixed and head-on, so without help the roll is
framed end-on and the whole accordion edge-on, and the preset renders as a
blank white column. `scene.turn` (degrees about the vertical axis, additive
with the `rotation` prop rather than overriding it) is the answer, and
`toilet-roll` carries 25. Raising it is not free: turning trades the pile's
depth for WIDTH, and width is the axis a fixed camera has least of — at the
pile's measured worst-case depth the budget runs out around 28°.

**Tune a pile by worst case, never by one good-looking run.** It is chaotic:
the same config fed a slightly different scroll ramp lands 2.0 panel-widths
wide or 4.2, and stacking two individually-good parameter values can be worse
than either alone. `strip.test.ts` scores the preset over nine trajectories for
this reason, and the numbers in `toilet-roll` were chosen against fifteen.

**It is grabbable.** With `interactive`, pointer-drag the paper and the roll
turns. The pull is driven by TENSION rather than by mapping hand travel to an
angle: paper does not stretch, so if the hand is further from the roll than
there is paper to reach it, the only way to satisfy the constraint is for the
roll to give up more. A slow pull feeds smoothly, a yank spins the roll and it
carries on after release, and pushing the paper back does nothing — slack does
not rewind a roll, only scrolling up does. `grabNearest`/`moveGrab` speak the
mesh's own coordinates, not the solver's.

`drag` is broadside-only — resistance along the segment normal, not along its
length. That is the difference between paper that floats and sways down and a
rope that drops: at `drag: 0` every unit paid out becomes a unit straight
down; at `drag: 1` the tip sits about two thirds of that.

The roll's tessellation is set by the ROLL, not the pile: the same nodes that
fold on the floor draw the spiral, and a wound turn is only as round as the
nodes spanning it. At five nodes to a panel — plenty for buckling — a full roll
is a visible sixteen-sided polygon and its innermost turn is drawn with four
nodes at 85° a step, coarse enough that the chords cut through the wrap beneath
and the spiral comes apart into a sawtooth. Hence sixteen to a panel, and a
`core` big enough that the tightest wrap is still round. It is affordable
because the chain is one-dimensional: 198 nodes, 0.13 ms a frame.

Two deliberate limits. The chain **simulates two dimensions** — it hangs in y,
folds in z, and keeps its full width in x with no twist, which is what keeps
self-collision a cheap 2D query. And **the node count is fixed**: nodes are
never spawned, only reclassified between "wound on the roll" (placed
analytically on the spiral) and "free". `stripNodeCount()` sizes the mesh and
the chain from the same function, so the 2×N quad strip always agrees.

`paper-roll` draws a similar object with a deformer stack and is cheaper; use
it when the paper never reaches the ground. Use `strip` for the pile.

### Presets

Built-ins: `receipt-unroll`, `letter-fold`, `washed-letter`, `vintage-note`, `hero-peel`, `page-flip`, `hanging-poster`, `pinned-sheet`, `flying-note`, `blank-sheet`, `photo-print`, `typed-note`, `postage-stamp`, `crumpled-note`, `settled-sheet`, `paper-ribbon`, `paper-roll`, `toilet-roll`. A preset is a `.paper` JSON object validated by `paperConfigSchema`; `getPreset(name)`, `parsePreset(json)`, `serializePreset(config)`, `diffConfig(config)` (non-default values only).

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
3. **`physics: 'strip'` + `behavior` throws a zod error** → the roll owns its vertices and its rows are chain nodes, not the sheet's grid. Cloth + behavior is fine and composes.
4. **Reduced motion**: with `prefers-reduced-motion: reduce`, behaviors freeze at their configured pose and physics/entrances are disabled. Override per-instance with `reducedMotion={false}` only when you have a good reason.
5. **No WebGL** → `<Paper>` renders a flat DOM fallback automatically; don't build your own.

### Verification recipe

Run the dev server and look at the canvas: `describeConfig(config)` (exported) generates the one-line expected visual for any config. `<Paper>` also renders a hidden DOM mirror of its content — asserting on that text is a cheap smoke test in E2E suites.

## Working in this repo

pnpm + Turborepo. `packages/paperlab` is the library; `apps/` holds three Vite apps that consume it **through its public API only** — if an app needs a private hook, the API is wrong.

| | |
|---|---|
| `packages/paperlab` | the library. Folders are domains: `core` (sheet + tessellation), `deformers`, `behaviors`, `field`, `stage`, `surface`, `scene`, `content`, `physics`, `states`, `config`, `a11y` |
| `apps/editor` | every knob in the schema, the preset library, and the export. Also hosts the browser harnesses on their own HTML entry points (see below) |
| `apps/playground` | one input, one scene, a link. The launch surface |
| `apps/docs` | the documentation site, every behavior running live |
| `tools/` | Node scripts that boot one of those apps headless and measure or photograph it |

```sh
pnpm install
pnpm dev            # editor at localhost:5173
pnpm test           # vitest: deformer math, schema, layouts, cloth, exports
pnpm typecheck
pnpm build          # tsup (library) + vite (apps)
pnpm lint           # biome
pnpm knip           # dead code and unused exports
```

**The browser harnesses.** Anything that needs a real GPU, real pointer events or a second browser profile lives here rather than in vitest. Each one boots a Vite dev server on its own port and drives an HTML entry point in `apps/editor`. All of them are dev-only — `pnpm build` emits `index.html` and nothing else — with one exception: `hands/index.html` also ships, as the site's `/hands` route, built in a second pass (`PAPERLAB_HANDS=1`) so the default build stays lean.

| | | |
|---|---|---|
| `pnpm test:parity` | `parity.html` | every deformer's GLSL twin vs its JS twin. **CI gate** |
| `pnpm test:drive` | the editor | the stage really walks when you drag, wheel or arrow it. **CI gate** |
| `pnpm test:share` | the editor | sculpt → copy a link → open it in a browser that has never seen the paper. **CI gate** |
| `pnpm test:dropdown` | the editor | every option list is reachable — including the ones below the fold. **CI gate** |
| `pnpm test:hands` | `/hands` | scripted gestures really reach the paper — grab, score, paint, tear, crush, blow, pointer capture, and that the page talks to nobody. Runs `pnpm hands:setup` for you |
| `pnpm test:route` | `tools/site-root.html` | the site root sends desktops to the editor and everything else to the playground, and its nav names every route `pages.yml` deploys. **CI gate** |
| `pnpm perf` / `perf:field` | `stage.html` / `field.html` | frame cost. `--gpu` for the platform GPU, `--soft` for the SwiftShader floor |
| `pnpm shot` / `shot:ui` / `shot:play` / `shot:light` | stage, editor, playground, one rig | PNGs into `.shots/` |
| `pnpm media` | `media.html` | the README's GIFs and MP4s, stepped frame-exact |

**`/hands` is a real page on the site, and it is linked like one.** The
signpost at the root names it, and so does the reference's rail — it shipped
without either for its first weeks, deployed and unreachable, which is why
`pnpm test:route` now reads the routes out of `pages.yml` and fails if the
signpost does not name one. It is never a redirect TARGET: it wants a camera
and two model files before it does anything, so it is somewhere you choose to
go, not somewhere you are sent.

**Run `pnpm hands:setup` before the page will start.** The tracker's wasm is
served from our own origin — it is executable code in a page holding a camera
stream, and as `@mediapipe/tasks-vision` it is
Apache-2.0, so there is no question about hosting it. `tools/hands-assets.mjs`
copies it out of `node_modules` (already a declared dependency, so the same
bytes at the same version) into `apps/editor/.hands/`, which is gitignored:
12 MB of runtime is not something a library repo should make anyone clone.

**The model weights are loaded from Google, deliberately.** Google publishes no
licence for them — not on the task's docs page, not on the models page, and the
model card those link to is a 404. The code is Apache-2.0; the weights are
covered by nothing anyone can point at, so serving them from our origin would
be redistribution under terms nobody can read. Linking is not. That costs one
third-party request, which the page's own copy discloses. If the terms ever
become clear, self-hosting is a two-line change and a better page.

**The route is a directory, not a file.** `apps/editor/hands/index.html`, served
at `/hands` — `/hands.html` is a file someone left lying around, `/hands` is a
route. It also makes the dev URL and the deployed one identical, which is what
lets the page resolve its wasm against `document.baseURI` and be right both
times. It is built in a SECOND pass over the editor app (`PAPERLAB_HANDS=1`,
its own base, `dist-hands/`) so the route is self-contained rather than reading
its JavaScript out of `/editor/assets`, and so the ordinary `pnpm build` stays
3.7 MB instead of carrying 12 MB it does not emit.

**The page talks to its own origin and one other, and that took two layers.**
MediaPipe POSTs a usage log to `https://odml.pa.googleapis.com/v1/log` with an
API key, from inside the task runner, with no documented way to turn it off. A
`connect-src` CSP stops it. That policy does NOT stop the wasm loader fetching
its own glue from a CDN — that happens in a worker and sails straight through —
so the harness asserts separately that the only stranger the page reaches is
the model host. Neither layer alone is enough, and the assertion is the one
that found the telemetry in the first place.

**The harness starts the camera for real, once.** Chromium's fake capture
device answers `getUserMedia` with a test pattern, which is enough to prove the
wasm and both models load the way a viewer would load them. It has no hands in
it, so everything after that goes back to scripted ones.

Two traps in that, both of which cost an afternoon. **Wait on the BUTTON.** The
obvious waits are vacuous — the readout says "hand" whether or not a camera is
running, and `(model loading)` is absent before a camera starts as well as
after the model arrives — so both passed instantly and the stop click found no
button. **And stopping is not optional:** the detection loop calls the same
`step()` sixty times a second with no hands in frame, which resets every
gesture between one scripted frame and the next. Thirteen unrelated checks
failed and none of them was broken.

**`/hands` — handling the paper with a camera.** Ten files, none of which
`packages/paperlab` knows about: `landmarks.ts` is the hand as geometry (every
measurement normalised by the palm, so leaning toward the camera is not a
gesture), `gestures.ts` names the pose, `roles.ts` decides which of two hands
is holding and which is acting, `marks.ts` turns a drag across the sheet into a
crease, `flick.ts` turns a snap of the fingers into a watercolour, `dial.ts`
turns a wrist into a stock selector, `breath.ts` turns a puckered mouth into
wind, `span.ts` turns the gap between two hands into a size, `handPointer.ts` turns a gesture into a synthetic `PointerEvent` at the
canvas — which R3F raycasts exactly as it does a mouse, so it reaches the cloth
grab the paper already had — and `hands-main.tsx` is the page. Press *start the
camera* to use it; `pnpm test:hands` drives the same paths with scripted hands
and no camera, because the tracking is not the part that can break and the rest
is.

Twelve effects, each mapped onto something the library could already do:

| | | |
|---|---|---|
| pinch | take hold and pull | the cloth sim's own grab |
| point | score a line | `memory.creases` — the sheet keeps it |
| flick | throw a watercolour at it | `content.wash` |
| turn an open palm | change the stock under your hand | `stock`, swapped live |
| blow at it | the wind rises | `cloth.wind`, driven continuously |
| fist | fold along the line you scored | the `fold` deformer, over the sim |
| fist | crush, with nothing scored | the `crumple` behavior, over the sim |
| open palm | let go of the fold or the crush | — |
| pull an edge | tear it ragged | `surface.deckle` |
| pull apart, two hands | rip along the dotted line | `surface.perforation` |
| two open palms, spread | resize the sheet | `sheet.width/height` |
| pinch a CORNER and lift | it peels and curls back | the `peel` behavior, over the sim |
| flick with the sheet in hand | it comes off its pins and flies | `pins`, and the sim's own throw |

**The rule that decides how all of it feels: surface and memory changes are
free, structural changes reset the sheet.** `surface.*`, `memory.creases`,
`stock` and the live cloth parameters (`wind`, `stiffness`, `gravity`, `floor`)
all update in place. That is the single most useful thing to know before
designing a new gesture — and since cloth started hosting a shape, and
`ClothSim.adopt` started carrying the particles across a rebuild, there is no
gesture here left on the wrong side of it.

**Two things used to be on the wrong side of that line and are not any more.**
A fist swapped the simulation out for a behavior and snapped the sheet flat;
cloth hosts a shape now, so it folds or crushes what is hanging there.
`sheet.width/height` still rebuild the mesh, but `ClothSim.adopt` carries the
drape across, so a hanging sheet can be resized while it hangs. As a SHAPE it
was always free — a deformer is a pure function of its options, so the sheet
simply redraws at the new size with the fold or the crush where it was.

Five more things are worth knowing before extending it.

**A fist is not a pinch, and the aperture cannot tell you which.** A closed
fist puts the thumb against the index just as tightly as a pinch does, so
anything thresholding thumb-to-index alone grabs the paper every time you try
to crush it. The discriminator is the curl of the three fingers a pinch does
not use; `gestures.test.ts` pins it.

**A closed hand folds what you scored, or crushes what you did not.** This
used to be a MODE swap and the seam in the whole harness: a fist replaced
cloth with `crumple`, threw away the drape, and crushed a flat sheet. Cloth
hosts a shape now, so a fist runs `fold` or `crumple` over the sheet that is
actually hanging there and the sheet stays grabbable throughout. The fold is
aimed at a line the sheet is already carrying — `creaseFromDrag` produced that
`{ angle, offset }` when a fingertip scored it, and `fold` takes the identical
pair, which is the tidiest join in this harness.

**`fold` moves everything BEYOND its hinge**, so which half of the sheet
swings is decided by which way `angle` points — and `creaseFromDrag` wraps into
a canonical half-turn that is blind to that. A line scored below the centre
comes back with a negative offset and folds the whole sheet about a line near
its bottom edge, which reads as the paper swinging off its pins. `marks.foldAlong`
picks the equivalent naming with a non-negative offset, so the flap is the side
a person would actually lift.

**A debounced gesture keeps firing after the hand has left it.** The reader
holds a pose for a few frames so a dropped fingertip does not drop the paper,
which means `point` is still being reported while the hand is already moving
away — and the score followed it there, collapsing the line you drew to
wherever you relaxed. `marks.continuesScore` rejects the jump. Anything else
that accumulates while a gesture is held needs the same guard.

**The second hand is not a second grab.** `ClothSim.grabbedIndex` is one
`int`, so two hands pulling the sheet is not something the library can be asked
for. What two hands unlock is the posture every physical thing you do to paper
actually uses — one hand steadies it while the other acts — and that works
today precisely because holding is the one grab and acting (scoring, flicking,
turning a dial) never touches the vertices. The acting hand gets its own
raycast through `hitUV`, which needs no pointer event at all.

**The vocabulary ran out of POSES long before it ran out of things to do, and
the way out was to stop looking for new ones.** A hand has about five shapes a
tracker can tell apart reliably, and there are twelve effects here. What makes
that work is that a pose is not a verb on its own:

- **Where it lands.** A pinch on a CORNER peels; on an EDGE it tears; anywhere
  else it takes hold. Same pose, three meanings, and nothing to learn — that is
  how paper works.
- **What the sheet already is.** A fist on a scored sheet folds along the
  score; on an unmarked one it crushes.
- **What is in your hand.** A fast release throws whatever you are holding —
  the sheet if you had hold of it, paint if you did not.
- **How many hands.** Two pinches rip along a perforation; two open palms
  resize. That second one outranks both the stock dial and the single open palm
  that means "put the paper back", or a resize would change the material and
  drop you out of a crush on its way.

`marks.ts` is where most of this lives, because most of it is a question about
a point on the sheet rather than about a hand.

**A pinch decides what it is when it LANDS, and never again.** A grab that
turned into a peel because the drag pulled a corner under the hand would let go
of the paper half way through the pull — which is what tearing an edge is, so
it took the tear with it. `wasPinchingRef` makes the peel a rising-edge
decision; `pnpm test:hands` catches the regression because the tear stops
working.

**The harness can drive its own clock, and a tracker has to survive that.**
`__HANDS__.drive(hands, aspect, face, now)` takes a timestamp, because a flick
is DEFINED by how fast it is and a test measured against wall time passes on a
laptop and fails on a loaded CI box. The cost is that the clock can jump
backwards between a wall-time run and a scripted one — and trimming a sample
window by age cannot see that, because the differences come out negative and
nothing is dropped. `FlickTracker` starts again when it sees time go backwards.

**The pinch is measured in three dimensions and the curls are not.** The
tracker reports a `z` per landmark and nothing read it. That is a live bug in
exactly one place: a span pointing at the camera projects SHORT, so a hand
turned side-on puts the thumb behind the finger, the aperture collapses, and
the sheet is grabbed by a hand that never closed. `spatialDistance` fixes it
for the aperture, where depth is also safe — a 3D distance is never shorter
than its own projection, so a noisy `z` can only make a pinch harder to
register, never invent one. The curls have the same geometry and the opposite
risk: they drive continuous values through a ratchet (the crush only climbs),
so inflation is the harm and they stay in the image plane. A finger pointed
straight at the camera still reads as curled.

**A prop written every frame re-renders the tree that owns the canvas.** The
wind a blow drives is continuous, so `breath.ts` quantises it to steps of 0.05
with a deadband and publishes only a step change — thirty renders a second
becomes one or two. The same reason the crush drives `ref.set('progress')`
imperatively rather than through a prop.

**A page turn was declined, not missed.** It is the fourth behavior the plan
listed for this batch and the one that does not survive contact with a single
hanging sheet: a page turns ONTO something, and with nothing behind it a `flip`
reads as a peel that went too far. It wants the field, not the hero path.

Still out of reach: punch and cut. The sheet is a fixed-topology grid and
deformers are pure vertex maps, so a hole in the middle or a split into two
sheets needs real work in the library. A torn EDGE is reachable only because
it is alpha on the existing mesh rather than a change to it. Burning is a
third: `aging` is yellowing and foxing, not char, and there is no burn effect
to drive.

### The editor, structurally

`apps/editor/src` is grouped by what a file is for. Anything that is not one of these five things belongs at the root of `src` (there are four files there, and that is the budget).

| | |
|---|---|
| `state/` | zustand stores and everything they persist to: `store.ts` (one write path — `writeConfig` — so state-override recording cannot be bypassed), `history.ts`, `session.ts`, `userPresets.ts`, `paperShare.ts`, `keys.ts` |
| `controls/` | the schema→UI machinery. `controlModel.ts` is a **pure** function from a zod schema to a `Control[]` — no React, no DOM, and unit-tested as such; `controls.tsx` renders that tree; `Select.tsx` and `ui.tsx` are the shared primitives |
| `panels/` | the inspectors that assemble a `Control[]` for one mode and hand it to `<Panel>` |
| `chrome/` | everything around the canvas that is not an inspector — the view cluster, transport, coach mark, crash and small-screen screens |
| `harness/` | the entry points `tools/` drives. Dev-only and out of `pnpm build`'s output, except `hands/`, which ships as the site's `/hands` route |

Two things about the control layer are load-bearing and easy to undo by accident:

- **The panel derives its rows from the config on every render.** There is no "structural" remount when the control *set* changes (toggling deckle, swapping physics). Remounting would be actively wrong — it collapses the folder the toggle lives in.
- **The `Control` tree keeps hierarchy, so duplicate leaf names are fine.** A stage whose `shot` and `figure` both carry `height` renders both. Do not reintroduce name-prefixing to work around a flattening that no longer happens; `controlModel.test.ts` pins this.

Label **drag-to-scrub** is the interaction worth preserving: full range in ~300px, shift for a 4× finer pass, click the readout to type an exact value. Text commits on blur/Enter rather than per keystroke, because the canvas rebuilds its content texture on every change.

Architecture invariants (violating these is a bug, not a style choice):

- **The zod schema (`config/schema.ts`) is the single source of truth.** If a feature can't serialize into a preset, it waits.
- **Paper memory lives ABOVE the deformer stack, never inside it.** `deformers/memory.ts` watches the stack a behavior built and rewrites it before it runs; no deformer knows memory exists. Deformer purity is what the GLSL twins are identical *to* — put state in a `displace` and `test:parity` has nothing left to check.
- **Deformers are pure vertex functions with dual JS + GLSL implementations.** Any change to one side must change the other; `pnpm test:parity` enforces it. JS runs the hero path (CPU, ≤10 papers, interactive); GLSL runs the field path (instanced).
- **GSAP owns animated values; `useFrame` owns uniform uploads and geometry writes.** Never both on one property.
- **Behaviors are 3–5 human-named params** ('tightness', not 'cylinderRadius') expanding to deformer stacks.
- Deformer loops are allocation-free; content canvases re-render only on content change.

Contribution ladder (easiest first): presets (JSON only) → behaviors (~50 lines over existing deformers) → layouts (~30-line pure function) → deformers (dual-implementation + parity cases in `field/parity.ts`) → surface effects (GLSL chunks in `surface/compose.ts`). See CONTRIBUTING.md.
