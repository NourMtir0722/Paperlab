# Paperlab

**Physical, realistic paper as a React component.**

[![npm](https://img.shields.io/npm/v/paperlab.svg)](https://www.npmjs.com/package/paperlab)
[![CI](https://github.com/NourMtir0722/Paperlab/actions/workflows/ci.yml/badge.svg)](https://github.com/NourMtir0722/Paperlab/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](https://github.com/NourMtir0722/Paperlab/blob/main/LICENSE)

A hero image that peels, a receipt that unrolls, a letter that folds, a poster rippling in wind, a gallery ring of prints — and a sheet that burns. A sheet is real 3D geometry, not a CSS trick and not a video — content is a texture on a mesh that genuinely bends, so text and imagery curl with perfect continuity.

**[Try it →](https://paperlab.nawwara.studio/)**  ·  [the editor](https://paperlab.nawwara.studio/editor/) (desktop)  ·  [the reference](https://paperlab.nawwara.studio/docs/)  ·  [with your hands](https://paperlab.nawwara.studio/hands/) (webcam)  ·  [the FX Lab](https://paperlab.nawwara.studio/fx-lab/)  ·  [for coding agents](https://github.com/NourMtir0722/Paperlab/blob/main/AGENTS.md)

| | |
|---|---|
| ![A thermal receipt unrolling from a paper roll](https://paperlab.nawwara.studio/media/receipt-unroll.gif) | ![A gloss card with its corner peeling up off the page](https://paperlab.nawwara.studio/media/hero-peel.gif) |
| ![A letter folding itself into thirds](https://paperlab.nawwara.studio/media/letter-fold.gif) | ![A page turning on its spine](https://paperlab.nawwara.studio/media/page-flip.gif) |

Every frame above is real geometry — no video, no sprite sheet.

## Install

```sh
npm i paperlab three @react-three/fiber gsap
```

Requires React ≥ 19 and three ≥ 0.162. TypeScript types ship with the package; both ESM and CJS builds are published.

> **npm users:** `@react-three/fiber@9.7.0` caps React at `>=19 <19.3`, and npm installs React 19.3 by default, so the line above can fail with `ERESOLVE`. Ask for a React the renderer accepts — `npm i paperlab three @react-three/fiber gsap react@19.2 react-dom@19.2` — until fiber widens its range. pnpm and yarn resolve it without complaint. This is upstream's ceiling, not Paperlab's: the library itself supports any React ≥ 19.

Paperlab has three entry points, and a bundle only resolves the ones it imports:

| | |
|---|---|
| `paperlab` | `<Paper>`, `<PaperMesh>` and `<PaperField>` — the sheet, and many sheets |
| `paperlab/stage` | `<PaperStage>` — paper as architecture |
| `paperlab/fx` | what happens **to** the paper — the fire, and everything it throws off |

Stage mode and the fire's glow need two more peers:

```sh
npm i @react-three/postprocessing postprocessing
```

They are genuinely optional, in both directions. `<Paper>` and `<PaperField>` never reach for them, so a bundle that does not import `paperlab/stage` or `paperlab/fx` contains none of it — the subpath keeps the import specifier itself out of your build graph. And both load their print pass on demand rather than at module scope, so they render without the peers too: you lose the tone curve, bloom, vignette and grain, and the console says so once.

## Quick start

```tsx
import { Paper } from 'paperlab'

// One line. (The parent element needs a height — <Paper> fills it.)
<Paper preset="receipt-unroll" autoplay />
```

Or configure it yourself:

```tsx
<Paper
  sheet={{ width: 1, height: 2.6 }}
  stock="thermal"
  content={{ type: 'receipt', store: 'your.store', items: [{ name: 'Thing', price: 12 }] }}
  behavior={{ type: 'unroll', progress: 0.6, tightness: 0.5 }}
  surface={{ deckle: { edges: ['bottom'] } }}
  interactive
  autoplay
/>
```

## The four components

| | |
|---|---|
| `<Paper>` | one sheet, owns its own `<Canvas>`, fills its parent |
| `<PaperMesh>` | the same sheet without a canvas, for an existing React Three Fiber scene |
| `<PaperField>` | many sheets in **one instanced draw call**, arranged by a layout |
| `<PaperStage>` | paper as architecture — a room of hanging banners you can walk through (`paperlab/stage`) |

A gallery is one component:

```tsx
import { PaperField } from 'paperlab'

<PaperField images={photos} preset="photo-print" layout="ring" />
```

And a space built out of a sentence is one component:

```tsx
import { PaperStage } from 'paperlab/stage'

<PaperStage text="the paper remembers every hand that folded it" progress={scroll} />
```

## The catalogue

Everything below is rendered by the library itself and regenerated from the
registries — `pnpm media`, `pnpm shot:catalogue`, `pnpm sheet`. No mockups.

### Behaviors — 12

- **Behaviors** — `peel`, `unroll`, `flip`, `letter-fold`, `hang`, `fly`, `fall`, `carry`, `flight`, `crumple`, `settle`, `ribbon`, `sticker`: human-named params ("tightness", not "cylinderRadius") over a stack of pure geometry deformers. Each behavior nominates the two or three params that *are* it, so tools can lead with those. Draggable handles when `interactive`.

Underneath them are seven **deformers** — `roll`, `curl`, `bend`, `fold`, `wave`, `drape`, `crumple` — each a pure vertex mapping written twice: a JS implementation for the CPU/hero path and a GLSL twin for the GPU/field path. A 37-case golden-vector gate holds the two identical, and a separate test asserts each one actually draws a surface. All arc-length preserving, because paper does not stretch.

### Stocks — 7

![The same letter on all seven paper stocks, side by side](https://paperlab.nawwara.studio/media/stocks.jpg)

One sheet of words, seven papers. Stock is not a colour swap: thermal takes on banding, newsprint takes grain, vellum goes translucent and lets the light through it. On top of stock sit composable surface effects — grain, torn deckle edges, crease lines, perforation, aging — as shader chunks. Alpha-affecting effects use `alphaTest` rather than blending, so shadows stay correct.

### Memory — the paper keeps what you do to it

Paper is plastic where cloth is elastic. Every deformer here is a pure function of its options, so a sheet folded to 180° and back to 0° used to come out pristine — right for cloth, wrong for the one material this library models. Now it creases.

A fold that closes past 45° at a line that stays put leaves a crease behind at `peak × set`, where `set` is how much that paper keeps: kraft holds one hard, vellum springs back. A fold whose line *travels* leaves nothing, which is why paper coming off a roll is bent at the floor rather than creased along it. Creases bend the sheet as well as marking it, they can be handed to a paper that was never folded (a letter that arrives having been folded once), and they serialize — into a preset, and down a share link.

```tsx
<Paper preset="letter-fold" memory={{ set: 0.6 }} onCrease={save} />
```

### Fire — paper that burns

`<Paper damage={source}>` hands a sheet a grid of char, water, heat and missing paper over its own UV, and the sheet draws it without knowing what caused it — the same split `content` already has. So a live simulation, a baked texture and a recorded burn played back all work the same way.

A burnt edge is drawn in the layers a real one has, measured in millimetres from the cut: a pale ash lip, a beaded ember line (the only part of the sheet that gives off light), a black char band, and a scorch with a steep edge into clean paper. On a cloth sheet the same grid reaches the physics too — char shrinks the paper and curls it toward the flame, wet paper gets heavier, and paper that has burnt away leaves the simulation, so a piece the fire cuts loose falls away with its own burnt edge.

What *causes* the damage lives in `paperlab/fx`:

- **`DamageField`** — heat, water, char and presence, simulated on the CPU with the paper's grain and fibre direction in it. It is untiered, so the same seed burns the same way on any device, and it burns at the speed real paper does: a few millimetres a second.
- **`FxFireFluid`** — the flames: a small GPU fire simulation fed from the hot rim in uneven clusters. Fuel burns where air reaches it, so a tongue has a pale core, a yellow body and a torn tip, and every zone of it is an option.
- **`FxFireLight`** — the burn is a light source. It lights the sheet, glows through it, and through `DamageSource.firelight` the room it burns in dims around it.
- **The rest of a fire** — embers, smoke and ash (`FxParticles`), a match held in a hand (`FxMatchFlame`), the thread of smoke from a smouldering bead (`FxWisps`), the embers left after the flames (`Afterglow`), and the bloom and heat haze (`FxPost`).

Every default is a tune made in the [FX Lab](https://paperlab.nawwara.studio/fx-lab/), and every one of them is an option you can set. See [AGENTS.md](https://github.com/NourMtir0722/Paperlab/blob/main/AGENTS.md) for the wiring.

### Layouts — 12

![All twelve field layouts rendered side by side](https://paperlab.nawwara.studio/media/layouts.jpg)

Every layout names somewhere paper actually sits: `book` (pages splayed from a spine — `split: 0` makes it a swatch deck), `accordion` (one continuous concertina strip), `fan` (a hand of cards), `spread` (a stack slid sideways), `pile` (a heap on a desk), `rack` (prints stood in a row, leaning back), `wall` (a pinned studio wall), `spill` (a dropped stack mid-air), `colonnade` (banners along a walk, for stage mode), `ring`, `sheet`, and `sweep` — a specimen chart of one sheet at ten stages of the same curl.

Each pose also carries a **bias**: how strongly that one sheet takes the deformation. So the top of a pile curls while the sheets pressed underneath lie flat — in the same draw call. A whole field is **one instanced draw call** with the deformers running on the GPU, and the camera frames itself from the layout's own poses, so a wide `wall` and a deep `ring` both land without hand-tuning.

![Twelve cards standing in a ring, each with its corner peeling, rotating slowly](https://paperlab.nawwara.studio/media/field-ring.gif)

Twelve sheets, twelve peeled corners, **one draw call** — the deformers run on the GPU and the text curls with the mesh.

### Lighting — 8 rigs

![The same letter under all eight lighting rigs](https://paperlab.nawwara.studio/media/lighting.jpg)

A rig is the starting point, not the ceiling. `light={{ exposure, film, key, color, direction, height, ambient, studio, haze }}` moves the lamp in the terms a person would say it in — degrees around the room, degrees above the horizon — and **studio** is the room itself as an environment map, which is what gives paper directional fill and something for its sheen to reflect. `window` and `leaves` carry a gobo; `lightbox` puts the source behind the sheet and lets you read it through the paper.

Overrides serialize *as* overrides, so a shared scene carries the two sliders you moved rather than a frozen copy of a rig you never touched.

### Stage — paper as architecture

![Printed banners hung down both sides of a colonnade, lit from an opening at the far end](https://paperlab.nawwara.studio/media/stage-nave.gif)

Banners hung the height of a room along a walk you travel, with light coming through the paper from an opening at the far end. `<PaperStage text="…" />` builds the whole space out of a sentence, and binding `progress` to scroll makes the page scroll the walk.

The room is real — a ceiling, poured floor slabs, columns with base plates, and a doorway the source shines through — because **architecture carries scale better than a figure does**. There is a walking figure, and it is off by default: the stage is navigable, so the person in the hall is the viewer.

**Six rooms ship**, and they are not variations on a theme — the walk changes shape, the paper changes proportion, the light changes where it comes from:

![The six stage presets — nave, procession, cloister, threshold, ribbon and archive](https://paperlab.nawwara.studio/media/stages.jpg)

Every one of those is built from the same two things: sheets of paper, and words printed on them. No imagery, no textures from anywhere else.

**Four camera shots** frame any of them, each reading the same walk as the arrangement and the light, so they cannot drift apart:

![The four stage camera shots — follow, lead, low and wide](https://paperlab.nawwara.studio/media/camera.jpg)

And it is navigable rather than a video. It drifts on its own until you touch it, then drag it (with inertia), wheel it, step banner to banner with the arrow keys, or click the paper you want to stand in front of. The stops come from the layout, so a step lands *on* a banner. `motion={{ capture: false }}` for a stage inside a scrolling page, so it never eats a reader's scroll. Quality adapts to the machine on its own across four tiers.

### The rest

- **Content** — `blank`, `image`, `text`, `card` and `receipt`, any of which can also sit on the reverse of the sheet via `content.back`. Text is measured and wrapped with real tracking applied *before* measurement, so the painted line matches the line it was broken to.
- **Physics** — curated idle motion (`float`, `tumble`, `dangle`, `taped`, `breeze`) that composes with behaviors, and a verlet **cloth** mode: pin the top edge, add wind, grab the sheet and pull. Cloth and behaviors are mutually exclusive by schema — cloth owns the vertices.
- **A floor** — `scene.floor` puts dark, matte ground under the paper. The contact shadow, a simulated sheet and anything the paper lets go of all meet at the same height, so a falling piece lands on the thing casting its shadow instead of through it.
- **Interaction states** — a preset can carry `states`: overrides-on-base diffs keyed `rest` / `hover` / `pressed` / `picked` / `placed`, with the triggers built in. Drag a stamp past its threshold and it tears off its sheet (the perforation edges facing its neighbours flip to torn), release it over a `<DropZone>` and it settles, release it anywhere else and it flutters home. The whole flow is reachable from the keyboard: focus a paper, Enter picks, arrows move between zones, Enter places, Escape returns it.
- **Hardware that holds the paper up** — thread to the ceiling or a rod across the top edge, gripped by a clip or a peg. A hung thing that shows what holds it stops reading as a rectangle that happens to float.
- **Presets** — 19 paper presets and 6 stage presets, and everything serializes to `.paper` JSON validated by a zod schema. Diffable, forkable, shareable.
- **Agent-first export** — the editor's **Copy for AI** produces a self-contained brief you paste into a coding agent: install line, inlined component, placement contract, and a verification step the agent can self-check. See [AGENTS.md](https://github.com/NourMtir0722/Paperlab/blob/main/AGENTS.md) and [docs/llms.txt](https://github.com/NourMtir0722/Paperlab/blob/main/docs/llms.txt).
- **Accessible by default** — `prefers-reduced-motion` freezes behaviors at their pose and disables physics, entrances and the fire's simulations, a hidden DOM mirror carries the content for screen readers and find-in-page, and a flat DOM fallback renders when WebGL isn't available.

The zod schema in `config/schema.ts` is the single source of truth: it validates the API, generates the editor's controls, defines the file format and feeds the docs. If a feature can't serialize into a preset, it doesn't ship. (Damage is the one deliberate exception: it is live state, so it is a prop and never part of a preset or a share link.)

## Papers are made to be passed around

A paper is data — a `.paper` JSON object validated by a zod schema — so it travels without asking anyone's permission. **You do not need to fork this repo to share one.**

**Sending one.** Sculpt a paper in the [editor](https://paperlab.nawwara.studio/editor/) and pick **Export → Copy share link**: you get a link with the whole paper packed into it. Anyone who opens that link lands in their own editor with your paper loaded and *editable* — a fork, not a read-only view. (Uploaded images are too big for a URL; use the ⬇ download and send the `.paper` file instead.)

**Receiving one.** Open the link, or drag a `.paper` file onto the preset panel. Either way it lands in your library next to the built-ins.

**Using one in your project.** A `.paper` file *is* a preset object, so it goes straight in:

```tsx
import alice from './alice-note.paper.json'

<Paper preset={alice} autoplay />
```

Or register it once by name and refer to it everywhere:

```tsx
import { registerPreset } from 'paperlab'

registerPreset('alice-note', alice)
<Paper preset="alice-note" />
```

That's the whole loop: **make → send → remix → ship.** If you'd rather your paper shipped *with* the library so everyone gets it by name, that's the first rung of [CONTRIBUTING.md](https://github.com/NourMtir0722/Paperlab/blob/main/CONTRIBUTING.md) — a preset PR is JSON and no code.

## The apps

Three sites ship alongside the library, all built on its public API only.

**[The playground](https://paperlab.nawwara.studio/playground/)** — one input, one scene, shareable by link. Type a sentence and it builds you a room out of it. Built for a phone.

**[The editor](https://paperlab.nawwara.studio/editor/)** — a three-rail canvas tool: presets on the left, sculpt on canvas, inspector on the right, transport at the bottom (space = play/pause), undo and redo on ⌘Z. One switch along the top moves between five surfaces that all wear that same frame — **Paper · Field · Stage · Hands · FX Lab** — and the top-right holds a single button, **Export**.

![The Paperlab editor in paper mode, showing a thermal receipt on the canvas with the inspector open](https://paperlab.nawwara.studio/media/editor.jpg)

The inspector is generated from the zod schema, so it can never drift from the API. Each behavior nominates the two or three params that *are* it — `unroll` opens on progress and tightness, and folds sheet, stock, content, surface, physics and scene away behind their own headings. Labels drag to scrub: full range in ~300px, shift for a 4× finer pass, click the readout to type an exact value.

![The editor in field mode, fourteen cards arranged in a ring with the layout panel open](https://paperlab.nawwara.studio/media/editor-field.jpg)

Field mode composes galleries against the same panel — swap the layout, watch fourteen papers rearrange in one draw call. **Export** ends the session wherever you are going next: a share link, an image framed for a post, a story or a slide, the component or its JSON for your codebase, or **Copy for AI** for a coding agent. It wants a real screen: under about 900px it says so and points you at the playground.

- **[FX Lab](https://paperlab.nawwara.studio/fx-lab/)** — every knob behind the burn, around the sheet it is burning: the flame's zones, the fluid, the bloom, the light it throws, the ash lip and the char, how fast it eats and how much of the sheet it takes. The library's defaults are a tune made here. Scrub the burn, turn something, and **Export** copies the tune out as JSON to pass to `<Paper>`.
- **[Hands](https://paperlab.nawwara.studio/hands/)** — set fire to the paper with a real flame. Hold a lighter up to the camera and the sheet catches where the flame is; with no lighter, pinch and hold still and you are holding a match; with no camera, there is a button. The page draws your hand as it tracks it and boxes the flame when it finds one, and once a flame touches the paper the fire runs from there until the whole sheet has burnt. Blow to put it out. It burns the way the FX Lab burns, from the same defaults, and the page is a hundred percent public API — `packages/paperlab` doesn't know it exists.

The flame detector is arithmetic over the camera's pixels, not a model: a flame is bright, warm in the order red-green-blue, and never still, and the last of those three is what keeps a desk lamp from lighting your paper. The hand tracking is [MediaPipe](https://ai.google.dev/edge/mediapipe) (`@mediapipe/tasks-vision`, Apache-2.0) and it runs entirely in your browser: the models download from Google once, and after that no video and no measurement taken from it leaves the device. There is no server to send it to, and a `connect-src` CSP on the page makes that enforceable rather than a promise — including against MediaPipe's own usage telemetry, which the page blocks. Needs a camera, and asks before it takes one.

**[The reference](https://paperlab.nawwara.studio/docs/)** — the whole catalogue with every behavior, deformer, layout, stock and surface rendering live. The catalogue is generated from the registries, so it cannot advertise something the library doesn't have.

## Development

pnpm + Turborepo, Node 22, [Biome](https://biomejs.dev) for lint and format.

```sh
pnpm install
pnpm hands:setup    # once — vendors the hand tracker's wasm and models (35 MB, not committed)
pnpm dev            # the editor at localhost:5173
```

| | |
|---|---|
| [`packages/paperlab`](https://github.com/NourMtir0722/Paperlab/blob/main/packages/paperlab/) | the npm library — the only published artifact |
| [`apps/editor`](https://github.com/NourMtir0722/Paperlab/blob/main/apps/editor/) | the editor — Paper, Field and Stage, plus Hands (`/hands`) and the FX Lab (`/fx-lab`), each built from the same app in a pass of its own |
| [`apps/playground`](https://github.com/NourMtir0722/Paperlab/blob/main/apps/playground/) | the playground — one input, one scene, shareable by link |
| [`apps/docs`](https://github.com/NourMtir0722/Paperlab/blob/main/apps/docs/) | the reference site, with every behavior running live |
| [`tools/`](https://github.com/NourMtir0722/Paperlab/blob/main/tools/) | browser harnesses — parity, perf, screenshots, the fire's checks, the README's motion |
| [`AGENTS.md`](https://github.com/NourMtir0722/Paperlab/blob/main/AGENTS.md) · [`docs/llms.txt`](https://github.com/NourMtir0722/Paperlab/blob/main/docs/llms.txt) | the agent-readable API reference |
| [`docs/design.md`](https://github.com/NourMtir0722/Paperlab/blob/main/docs/design.md) | the design language the apps share, enforced by a test |

### Checks

```sh
pnpm test             # 1,100+ unit tests — deformer math, schema, cloth, layouts, the fire, exports
pnpm test:parity      # 37 golden-vector cases: every deformer's GLSL twin vs its JS twin
pnpm test:drive       # the stage really walks when you drag, wheel or arrow it
pnpm test:share       # sculpt → link → a browser that has never seen the paper
pnpm test:dropdown    # every dropdown option is reachable, including below the fold
pnpm test:route       # the site root routes by device, and links every route it deploys
pnpm test:consumer    # installs the packed library into an empty project and imports it
pnpm test:damage      # an untouched damage field changes not one pixel
pnpm test:fire-budget # what a burn must measure in the frame — the stage stays black, paper never blooms
pnpm test:hands       # the ways to light the paper really light it (needs a camera-less Chromium)
pnpm test:fire-look   # the burn, moment by moment, beside the stills it is judged against
pnpm typecheck
pnpm lint
pnpm knip             # dead code and unused exports
pnpm build
```

Anything that needs a real GPU, real pointer events or a second browser profile is a browser harness in `tools/` rather than a unit test. All of them but `test:hands` and `test:fire-look` are CI gates, along with `publint` and `are-the-types-wrong` on the published package. `test:hands` runs in [its own workflow](https://github.com/NourMtir0722/Paperlab/blob/main/.github/workflows/hands.yml) instead — on the paths that can break it, and weekly — because it fetches its models from Google and a required gate would let someone else's CDN block every unrelated PR. A red X you have to read, rather than a veto. `test:fire-look` is run by hand: it lays each render beside a reference still, those stills are kept out of the repo, and passing it still takes someone looking.

### Measurement

```sh
pnpm perf           # stage frame cost      (--gpu for the platform GPU, --soft for the SwiftShader floor)
pnpm perf:field     # field frame cost
pnpm shot           # stage PNGs into .shots/   (also shot:ui, shot:play)
pnpm shot:light     # every lighting rig, one frame each
pnpm shot:catalogue # sweep any axis — --vary=layout|stock|lighting --all
pnpm sheet          # compose those frames into a labelled contact sheet
pnpm media          # the README's GIFs and MP4s, stepped frame-exact (needs ffmpeg)
pnpm film           # the burn playing, first contact to cold, one video per origin (needs ffmpeg)
```

## Contributing

Contributions climb a ladder, easiest first: **presets** (JSON only, zero code) → **behaviors** (~50 lines over existing deformers) → **layouts** (a ~30-line pure function) → **deformers** (dual JS + GLSL implementation with parity cases) → **surface effects** (GLSL chunks). Merged work ships in the editor's library with attribution. See [CONTRIBUTING.md](https://github.com/NourMtir0722/Paperlab/blob/main/CONTRIBUTING.md).

## License

Apache 2.0 © Noor Mtir. Attribution travels with the code: redistributions must reproduce the [NOTICE](https://github.com/NourMtir0722/Paperlab/blob/main/NOTICE) file. If Paperlab made it into something you shipped, a visible credit or link back is warmly appreciated.
