# Paperlab

**Physical, realistic paper as a React component.** A hero image that peels, a receipt that unrolls, a letter that folds, a poster rippling in wind, a gallery ring of prints — real 3D paper, not a CSS fake. Content is a texture on a mesh that genuinely bends, so text and imagery curl with perfect continuity.

| | |
|---|---|
| ![A thermal receipt unrolling from a paper roll](docs/media/receipt-unroll.png) | ![A photo print with its corner peeling up](docs/media/hero-peel.png) |
| ![A cloth-simulated sheet grabbed and pulled](docs/media/cloth-grab.png) | ![A ring gallery of photo prints](docs/media/field-ring.png) |

## Quick start

```sh
npm i paperlab three @react-three/fiber gsap
```

```tsx
import { Paper } from 'paperlab'

// One line. (The parent element needs a height — <Paper> fills it.)
<Paper preset="receipt-unroll" autoplay />
```

Or sculpt your own:

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

Galleries are one component too:

```tsx
import { PaperField } from 'paperlab'

<PaperField images={photos} preset="photo-print" layout="ring" />
```

## What's inside

- **Behaviors** — `peel`, `unroll`, `flip`, `letter-fold`, `hang`, `fly`, `fall`: human-named params ('tightness', not 'cylinderRadius') over a stack of pure geometry deformers. Draggable handles when `interactive`.
- **Stocks & surfaces** — six paper stocks (thermal gets banding, newsprint gets grain) plus grain, torn deckle edges, crease lines, and aging as composable shader effects. Real lighting throughout.
- **Physics** — curated idle motion (`float`, `tumble`, `breeze`…) that composes with behaviors, and a verlet **cloth** mode: pin the top edge, add wind, grab the sheet and pull.
- **Field mode** — 10+ papers render as *one instanced draw call* with the deformers running on the GPU (parity-tested against the CPU path), arranged by pure layout functions. Every layout names somewhere paper actually sits: `fan` (a swatch deck hinged at one corner), `spread` (a stack slid sideways), `pile` (a heap on a desk), `wall` (a pinned studio wall), `spill` (a dropped stack mid-air), `ring`, `sheet`. Each pose carries a **bias** — how strongly that one sheet takes the deformation — so the top of a pile curls while the sheets pressed underneath lie flat, in the same draw call. The camera frames itself from the layout's own poses, so a wide `wall` and a deep `ring` both land without hand-tuning.
- **Presets** — everything serializes to `.paper` JSON validated by a zod schema. Diffable, forkable, shareable.
- **Agent-first export** — the editor's **Copy for AI** button produces a self-contained brief you paste into Claude Code (or any coding agent): install line, inlined component, placement contract, and a verification step the agent can self-check. See [AGENTS.md](AGENTS.md).
- **Accessible by default** — `prefers-reduced-motion` freezes behaviors at their pose, a hidden DOM mirror carries the content for screen readers, and a flat DOM fallback renders when WebGL isn't available.

## The editor

```sh
pnpm install && pnpm dev   # → localhost:5173
```

A Figma-shaped editor: presets on the left, sculpt on canvas (drag the blue handles), inspector on the right, transport at the bottom (space = play/pause). Field mode composes galleries; **Export code** ends the session in your codebase.

## Repository

| | |
|---|---|
| [`packages/paperlab`](packages/paperlab/) | the npm library |
| [`apps/editor`](apps/editor/) | the editor |
| [`docs/llms.txt`](docs/llms.txt) | the agent-readable API reference |

```sh
pnpm test           # unit suite — deformer math, schema, cloth, layouts, exports
pnpm test:parity    # GPU golden-vector gate: every deformer's GLSL twin vs its JS twin
pnpm build
```

Contributions climb a ladder from presets (JSON only) to dual-implementation deformers — see [CONTRIBUTING.md](CONTRIBUTING.md).

Apache 2.0 © Noor Mtir — attribution travels with the code: redistributions must reproduce the [NOTICE](NOTICE) file. If Paperlab made it into something you shipped, a visible credit or link back is warmly appreciated.
