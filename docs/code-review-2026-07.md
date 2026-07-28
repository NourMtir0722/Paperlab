# Code review — July 2026

A full review of the library and editor, with fixes applied in the same pass.
This document records what was found, what changed, and what was deliberately
left alone, so future sessions don't re-litigate the same ground.

**Verification after fixes:** `pnpm test` 175/175 · `pnpm test:parity` 12/12 ·
`pnpm build` + `pnpm typecheck` clean.

## Overall assessment

Well-structured codebase. The load-bearing decisions that make it hold together:

- **Schema-first**: the zod schema (`config/schema.ts`) is the single source of
  truth — validates the API, generates editor panels, defines `.paper`, feeds docs.
- **CPU/GPU deformer twins** with golden-vector parity (`tools/parity.mjs`) as a
  hard gate — every deformer ships a JS `displace` and a GLSL chunk.
- **"GSAP owns values, useFrame owns uploads"** — stated and followed. The state
  machine (`states/machine.ts`) tweens a stable-identity `flat` object so
  `rebase()` mid-transition never snaps.
- **One write path in the editor** (`store.ts` → `writeConfig`) so state-override
  recording can't be bypassed.
- Cloth-vs-behavior exclusivity enforced *in the schema*, not by convention.
- Accessibility is architectural: reduced motion, DOM mirrors, keyboard flow as
  a pure testable function (`fieldKeyboardStep`).

## Findings and fixes (all applied)

### 1. Stale config in `Paper` — bug (fixed)
`Paper.tsx` memoized `resolveConfig(meshProps)` keyed only on `preset`, but
`resolveConfig` also reads `sheet/stock/content/behavior/deformers/physics/onTwos`.
Changing those props updated the mesh but left lighting, the no-WebGL
`PaperFallback`, and the screen-reader `PaperMirror` stale.
**Fix:** new exported `resolveConfigKey(props)` in `PaperMesh.tsx` keys the memo
on every prop `resolveConfig` reads; used by both `Paper` and `PaperMesh`.

### 2. Geometry leaks (fixed)
R3F only auto-disposes JSX-created objects. Imperatively-created geometries were
never disposed: `PaperMesh`'s sheet geometry, `FieldGroup`'s instanced geometry,
and `DropZoneVisual`'s inline `new THREE.PlaneGeometry` inside `edgesGeometry`
args (rebuilt every render, and it re-renders on every hover change).
**Fix:** `useEffect(() => () => geometry.dispose(), [geometry])` in both mesh
components; `DropZoneVisual` memoizes its `EdgesGeometry` on `[w, h]` and
disposes it.

### 3. Keyboard-mirror detection mismatch — a11y bug (fixed)
`PaperFieldMesh` resolved presets to decide interactivity, but the `PaperField`
wrapper used a weaker check (inline objects only, `papers ?? []`). A slot naming
a stateful preset *by string* got pointer interaction but no keyboard mirror;
`images`-driven fields got an empty mirror.
**Fix:** shared derivations in `field/slots.ts` — `effectiveFieldPapers()`
(papers ?? images sugar ?? 12 blanks) and `fieldIsInteractive()` (resolves
presets via `groupFieldPapers`) — used by both mesh and wrapper.

### 4. `PaperField.tsx` split (done)
Was 1,345 lines doing six jobs. Now a 280-line composition over:

| module | contents |
|---|---|
| `field/slots.ts` | `FieldPaperSlot`, `groupFieldPapers`, `resolveFieldSlotConfig`, `effectiveFieldPapers`, `fieldIsInteractive`, `EMPTY_SET` |
| `field/dropZones.tsx` | `DropZoneRegistry`, `DropZoneContext`, `DropZone`, `DropZoneVisual`, `zoneAccepts` (cached globs), `zoneContains` |
| `field/backingSheet.tsx` | `BackingSheet` (stamp-grid ghost silhouettes) |
| `field/fieldGroup.tsx` | `FieldGroup` (instanced draw call), `SharedMotion`, entrance/lerp/ease helpers |
| `field/interactiveField.tsx` | `InteractiveField` (carry controller: pick/settle/return), `FieldA11yController` |
| `field/keyboardMirror.tsx` | `fieldKeyboardStep` (pure), `FieldKeyboardMirror` |

`PaperField.tsx` re-exports everything, so `index.ts`, tests, and consumers
importing from `'./PaperField'` are unchanged. Public API surface: identical
(plus two new exports, `effectiveFieldPapers` and `fieldIsInteractive`).

### 5. Per-frame allocations (fixed)
- `zoneAccepts` compiled a fresh `RegExp` per glob per call from the carry
  `useFrame` loop → module-level compiled-glob cache.
- `ClothSim.setParams` did two `JSON.stringify` per call, invoked every frame
  while cloth renders → direct numeric field compare.
- `InteractiveField`'s window pointer listeners and a11y controller re-attached
  on **every render** (no dep array) → ref-delegation pattern: fresh closures go
  into refs each render, stable listeners/controller attach once on mount.

### 6. `resolveConfig` memoized in `PaperMesh` (fixed)
Was unmemoized per render; each call is several zod parses (`superRefine`
re-parses every state override). Now memoized on `resolveConfigKey(props)`.

## Deliberately left alone

- **The `JSON.stringify`-as-dependency idiom** (~37 uses + ~19
  `eslint-disable exhaustive-deps`). It's the codebase's chosen convention,
  configs are small and serializable, and replacing it wholesale is churn with
  real regression risk. The one place it *caused* a bug (finding 1) is fixed and
  centralized in `resolveConfigKey`. If it bites again, the next step is a
  `useConfigKey(config)` hook so the disables live in one audited place.
- **Editor bundle size warning** (~1.5 MB minified, mostly three.js) — a
  dev-tool app; code-splitting is not worth it yet.
- **`FieldKeyboardMirror.paperLabel`** calls `resolveConfig` per paper per
  render — mirror renders are rare (carry-state changes only); not worth caching.

## Watch-list for future work

- Any new imperatively-created THREE resource (geometry, texture, material)
  needs a disposal effect — grep `useMemo(() => new THREE` when reviewing.
- Any new consumer caching a resolved config must key on `resolveConfigKey`,
  not `preset` alone.
- The wrapper/mesh pair (`PaperField`/`PaperFieldMesh`) must keep deriving
  papers + interactivity from `field/slots.ts` — never re-implement inline.
- `field/interactiveField.tsx` (483 lines) is the next candidate for a split if
  it grows: the carry choreography (settle/return timelines) could move to
  `field/carry.ts`.
