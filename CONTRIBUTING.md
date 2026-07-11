# Contributing to Paperlab

Contributions climb a ladder — start wherever you're comfortable. Merged presets and behaviors ship in the editor's library with attribution: credit is the currency here.

## Setup

```sh
pnpm install
pnpm dev            # editor at localhost:5173
pnpm test           # unit tests (vitest)
pnpm test:parity    # GPU ⇄ CPU deformer parity gate (needs Chromium via playwright)
```

## The ladder

### 1. Presets — JSON only, zero code

A preset is one paper, fully serialized. Add yours to `packages/paperlab/src/config/presets/index.ts`:

```ts
'midnight-memo': {
  meta: { name: 'Midnight memo', author: 'you', tags: ['text'] },
  stock: 'kraft',
  content: { type: 'text', text: 'meet at the usual place' },
  behavior: { type: 'peel', progress: 0.25, corner: 'top-left' },
  surface: { aging: 0.3 },
},
```

Rules: it must parse against `paperConfigSchema` (the test suite checks every built-in), and it should look like a portfolio piece, not a demo of settings.

### 2. Behaviors — ~50 lines over existing deformers

A behavior is a named bundle: 3–5 **human-named** params ('tightness', not 'cylinderRadius') expanding to a deformer stack. Copy `src/behaviors/peel.ts`, then:

1. Define your zod options schema (min/max on every number — the editor generates sliders from it).
2. Implement `stack(options, sheet)` mapping params → deformer instances.
3. Optionally add `loop` (transient idle motion) and `handles` (direct-manipulation grab points).
4. Register it in `behaviors/registry.ts` and add it to the union in `config/schema.ts`.
5. Add an expansion test in `behaviors/behaviors.test.ts`.

The editor UI is generated from your schema — no editor code needed.

### 3. Layouts — ~30-line pure function

`pose(i, n, options, phase) → { position, rotation, scale }` in `src/field/layouts/index.ts`. No state, no three.js, deterministic (use the `jitter` helper for randomness). Register + add a pose test.

### 4. Deformers — dual implementation, parity required

The serious tier. A deformer is a pure vertex mapping with a JS implementation (CPU/hero path, allocation-free — mutate `out` in place) and a GLSL twin (GPU/field path) that must produce identical results:

1. Copy `src/deformers/bend.ts` (the smallest one).
2. Implement `displace` (JS) and `glsl.chunk` + `glsl.uniforms` (same math; angles pre-converted to radians in `uniforms`).
3. Add golden-vector tests in `deformers/deformers.test.ts` AND parity cases in `field/parity.ts`.
4. `pnpm test:parity` must pass — this is non-negotiable; it's what makes dual implementation maintainable rather than a trap.

Keep it arc-length preserving (paper never stretches) and C¹-continuous at region boundaries.

### 5. Surface effects — GLSL chunks

Fragment-side effects in `src/surface/compose.ts`: add a chunk (uniform-namespaced), wire it into `composeSurface`, extend `surfaceSchema`, add a compose test. Alpha-affecting effects must use alphaTest, not blending, so shadows stay correct.

## Ground rules

- The zod schema is the spec: if it can't serialize into a preset, it doesn't ship.
- GSAP owns values, `useFrame` owns geometry/uniform writes — never both on one property.
- The editor consumes the library only through its public API.
- Run `pnpm test && pnpm typecheck` before opening a PR; run `pnpm test:parity` if you touched a deformer.
