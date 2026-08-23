<!--
Thank you — genuinely. Presets and behaviors ship in the editor's library with
attribution; credit is the currency here.

Delete whatever does not apply. A preset PR is JSON and needs almost none of it.
-->

## What this changes

<!-- And why. If it fixes an issue, "Closes #N". -->

## What it looks like

<!--
This is a visual library, so a picture carries more than a description.

- A share link from the editor is the cheapest way to show a paper.
- `pnpm shot` / `pnpm shot:ui` write PNGs to `.shots/` if you need a render.
-->

## Checks

- [ ] `pnpm test` and `pnpm typecheck` pass
- [ ] `pnpm lint` passes (Biome, not ESLint — an `eslint-disable` comment silences nothing here)
- [ ] `pnpm test:parity` passes — **required if you touched a deformer**
- [ ] A changeset (`pnpm changeset`) if this changes the published package

## If you touched the library's public API

Every exported name is a promise we keep for years, so the surface is
deliberately small — 83 names across both entry points. Adding one is easy to
do and hard to undo.

- [ ] Anything new in `src/index.ts` or `src/stage.ts` is something a consumer
      genuinely cannot do without, rather than something merely useful.

## If you added a deformer

- [ ] JS `displace` and the GLSL twin produce identical results
- [ ] Golden vectors in `deformers/deformers.test.ts` **and** cases in `field/parity.ts`
- [ ] Arc-length preserving and C¹-continuous at region boundaries — paper does not stretch
