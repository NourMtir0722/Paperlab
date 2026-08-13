# paperlab

## 0.2.0

### Minor Changes

- 3b38a22: New: `crumple` — paper that has been handled.

  Seven deformers now, and the new one is the first that crushes a sheet. `wave` and `fold` were the nearest and neither reads as crumpled, which made this the biggest single gap in the set: a crumple is the most recognisable paper state there is.

  It ships as the whole slice — the `crumple` deformer (JS `displace` plus its GLSL twin, held together by three new cases in `pnpm test:parity`), a `crumple` behavior (`progress`, `coarseness`, `ball`, `seed`), and a `crumpled-note` preset.

  The field is the gap between the two nearest points of a jittered cell grid, signed per cell. It vanishes on every cell boundary, so the sheet stays continuous, and its gradient flips across one — which is a crease. What you get is an irregular polygonal network of facets alternating toward and away from you, rather than the periodic egg-crate or the smooth hammered-metal look the two earlier attempts produced. The normals are the point: a crumple that does not shade its own facets is a noisy sheet, not a crushed one.

  It is the most expensive deformer in the set, and measurably so: `pnpm perf:field` puts a field of them about 45% longer per frame than the same field of an undeformed preset. Almost none of that is geometry — `segments: 'auto'` already gives every sheet 72 a side, so its `minSegments: 72` is a floor that only bites when a preset asks for a coarser grid by hand. The cost is the nine cell lookups per probe, three probes deep for the vertex normal.

  Also: `describeConfig` now has a phrase for `crumple`, and a test asserts that _every_ registered behavior has one, so a new behavior can no longer describe itself as nothing.

- 09416c5: `drape`, `crumple` and the `crumple` behavior are now exported like every other deformer and behavior.

  `roll`, `curl`, `bend`, `fold` and `wave` were each exported individually — their deformer object, options schema and options type — while `drape` and `crumple` were reachable only through `getDeformer(id)`. Nothing depended on the difference, which is exactly why it was worth closing: an API with an arbitrary hole in it is a papercut for the first person who trips over it, and the reference site now documents all seven.

  This is deliberately the _reversible_ direction. The alternative was removing all seven, which is a breaking change and belongs to the pre-1.0 export trim rather than to a tidy-up. When that trim happens, the deformer objects and their schemas should go as one group of seven.

- b45980b: Fix: the props now accept what the docs say they accept, and `surface` is finally one of them.

  Two bugs, same root. `<Paper surface={{ grain: 0.3 }} />` was documented in the README, `AGENTS.md` and `docs/llms.txt` and was **not a prop at all** — it failed to typecheck, and in plain JS `resolveConfig` dropped it on the floor, so the effect you asked for silently never happened. And `content`, `behavior`, `deformers` and `physics` took each schema's _parsed_ type rather than its _input_ type, which demanded every field of every nested object: the README's own example — `content={{ type: 'receipt', store: 'acme.dev', items: [...] }}` — did not compile.

  Both are fixed. `surface` and `scene` are real props now (surface merges over the stock's defaults rather than replacing them, so `surface={{ grain: 0.6 }}` on thermal keeps thermal's banding), and every config prop takes the schema's input type, so anything with a default stays optional. The schema now exports both types for each config — `ContentConfigInput`, `BehaviorConfigInput`, `SurfaceConfigInput`, `PhysicsConfigInput`, `DeformerInstanceConfigInput`, `SceneConfigInput` — and `config/props.test.ts` pins the documented examples at both the type level and at runtime, so a prop cannot quietly go back to an inferred type.

  No runtime behaviour changes for code that already compiled, except that a `surface` prop now actually applies.

### Patch Changes

- 1141986: Fix: `bend` and its GLSL twin disagreed at low curvature, and the parity gate never looked there.

  The arc's in-plane shift is `r·sin θ − d`, and `d` **is** `r·θ` — so for a gentle bend it is a difference of two nearly-equal large numbers, and the answer is whatever bits survive. `r(1 − cos θ)` has the same problem. JS computes both in float64 and gets away with it; the GLSL twin computes them in float32 and does not. The two paths were **6.1e-4 apart** at `curvature: 0.35` — past the parity gate's 5e-4 epsilon — meaning hero mode and field mode were rendering measurably different arcs.

  It went unnoticed because the gate only ever exercised `|curvature| ≥ 0.6`, while `photo-print` — the field starter preset, and the one every gallery layout is demoed with — bends at `0.35`, squarely inside the untested band.

  `bend` is now written in its cancellation-free form on both sides: `r(1 − cos θ)` as `2r·sin²(θ/2)`, and the in-plane shift through a `sin(x) − x` helper that uses a series below |x| = 1 and the direct form above it. Same arc to sixteen places — only the float32 half could tell the difference, and that is exactly the half that was wrong. Worst-case parity error at 0.35 drops from 6.1e-4 to 2.1e-5, and the _existing_ bend cases improved by an order of magnitude too. Two permanent low-curvature parity cases now cover the band, including the gentlest arc the schema allows.

- 963861b: Docs: document the community loop. A `.paper` file someone shares with you is already a preset object — `<Paper preset={theirPaper} />` or `registerPreset(name, theirPaper)` — so it goes straight into a project without being expanded into individual props. The README, `AGENTS.md`, and `docs/llms.txt` now say this explicitly, and `config/shared-paper.test.ts` pins the round-trip so the promise cannot silently break. `CONTRIBUTING.md` now leads with the fact that sharing a paper needs no fork and no PR; the contribution ladder is for work you want shipped _inside_ the library.

## 0.1.0

### Minor Changes

- 6d51ffc: Draw the boundary around stage mode. `<PaperStage>` is a composition the library ships, so its insides are no longer part of the API: the figure, the surround, the gait and camera math, and the quality ladder are all un-exported (`Figure`, `Source`, `Surround`, `makeGlowTexture`, `makeSkyTexture`, `splitAcrossBanners`, `bannerTextSize`, `PROPORTIONS`, `figureGait`, `cycleLength`, `placeFigure`, `figureSchema`, `qualityTiers`, `qualityFor`, `tierUp`, `tierDown`, `INITIAL_TIER`, `TIER_ORDER`, `stageCamera`, `walkPoint`, `getWalkPath`), along with sub-schemas that were redundant slices of the already-exported `stageSchema` (`stageSourceSchema`, `stageGroundSchema`, `shotSchema`, `walkPathSchema`). Stage's public surface goes from 71 symbols to 33; what remains is what you need to render a stage, configure one, name one, or serialize one.

  The stage share-link helpers (`encodeStageShare`, `decodeStageShare`, `readStageShare`, `stageShareUrl`, `SHARE_PARAM`, `MAX_SHARE_LENGTH`, `StageShare`) are **removed from the library**. They encoded the playground's own payload shape — a preset id plus a diff — which no other consumer could use, and they now live in `apps/playground`. The library's contribution to a shared link is `stageSchema`, which is what the untrusted half of a link should be validated against anyway.

  Stage mode is also now documented, which it wasn't: `<PaperStage>` has entries in the README, `AGENTS.md`, and `docs/llms.txt`.

### Patch Changes

- 09e9988: Fix CommonJS consumers resolving ESM-flavored type declarations: the `require` export condition now points to `dist/index.d.cts`, so `require('paperlab')` gets correctly-flavored types under `node16` module resolution.
- 60cff72: Docs: correct the layout list for agents and humans. `AGENTS.md` still advertised five layouts that do not exist (`deck`, `cascade`, `helix`, `tunnel`, `scatter`) — names from before the layouts were renamed to places paper actually sits — so an agent following it would generate a `<PaperField layout="…">` the registry rejects. The real set is `ring`, `fan`, `spread`, `pile`, `wall`, `spill`, `sweep`, `book`, `accordion`, `rack`, `colonnade`, `sheet`. `docs/llms.txt` and the README were also missing `colonnade`.
- b43c2c6: Drop `zustand` from the library's dependencies — it was never imported by the package (only the editor app uses it), so consumers no longer download it. Also removed two stale internal re-exports left over from the field/ module split.
