# Paperlab — for coding agents

Paperlab renders physical, realistic paper as a React component. Content is a texture on a mesh that genuinely bends — text and imagery curl with perfect continuity. This file is the dense reference for agents integrating Paperlab into a project or contributing to this repo.

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

### Physics

- Idle presets (`physics: 'float' | 'tumble' | 'dangle' | 'taped' | 'breeze'`): cheap curated motion, composes WITH a behavior.
- Cloth (`physics: 'cloth'` or `{ type:'cloth', pins, wind, stiffness, gravity, floor }`): verlet simulation, pins = 'top-edge' | 'top-corners' | 'corner' | 'none'. **Cloth and `behavior` are mutually exclusive** — the schema rejects both together (cloth owns the vertices).

### Presets

Built-ins: `receipt-unroll`, `letter-fold`, `vintage-note`, `hero-peel`, `page-flip`, `hanging-poster`, `pinned-sheet`, `flying-note`, `blank-sheet`, `photo-print`, `typed-note`, `postage-stamp`. A preset is a `.paper` JSON object validated by `paperConfigSchema`; `getPreset(name)`, `parsePreset(json)`, `serializePreset(config)`, `diffConfig(config)` (non-default values only).

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
