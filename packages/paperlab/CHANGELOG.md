# paperlab

## 0.1.0

### Minor Changes

- 6d51ffc: Draw the boundary around stage mode. `<PaperStage>` is a composition the library ships, so its insides are no longer part of the API: the figure, the surround, the gait and camera math, and the quality ladder are all un-exported (`Figure`, `Source`, `Surround`, `makeGlowTexture`, `makeSkyTexture`, `splitAcrossBanners`, `bannerTextSize`, `PROPORTIONS`, `figureGait`, `cycleLength`, `placeFigure`, `figureSchema`, `qualityTiers`, `qualityFor`, `tierUp`, `tierDown`, `INITIAL_TIER`, `TIER_ORDER`, `stageCamera`, `walkPoint`, `getWalkPath`), along with sub-schemas that were redundant slices of the already-exported `stageSchema` (`stageSourceSchema`, `stageGroundSchema`, `shotSchema`, `walkPathSchema`). Stage's public surface goes from 71 symbols to 33; what remains is what you need to render a stage, configure one, name one, or serialize one.

  The stage share-link helpers (`encodeStageShare`, `decodeStageShare`, `readStageShare`, `stageShareUrl`, `SHARE_PARAM`, `MAX_SHARE_LENGTH`, `StageShare`) are **removed from the library**. They encoded the playground's own payload shape — a preset id plus a diff — which no other consumer could use, and they now live in `apps/playground`. The library's contribution to a shared link is `stageSchema`, which is what the untrusted half of a link should be validated against anyway.

  Stage mode is also now documented, which it wasn't: `<PaperStage>` has entries in the README, `AGENTS.md`, and `docs/llms.txt`.

### Patch Changes

- 09e9988: Fix CommonJS consumers resolving ESM-flavored type declarations: the `require` export condition now points to `dist/index.d.cts`, so `require('paperlab')` gets correctly-flavored types under `node16` module resolution.
- 60cff72: Docs: correct the layout list for agents and humans. `AGENTS.md` still advertised five layouts that do not exist (`deck`, `cascade`, `helix`, `tunnel`, `scatter`) — names from before the layouts were renamed to places paper actually sits — so an agent following it would generate a `<PaperField layout="…">` the registry rejects. The real set is `ring`, `fan`, `spread`, `pile`, `wall`, `spill`, `sweep`, `book`, `accordion`, `rack`, `colonnade`, `sheet`. `docs/llms.txt` and the README were also missing `colonnade`.
- b43c2c6: Drop `zustand` from the library's dependencies — it was never imported by the package (only the editor app uses it), so consumers no longer download it. Also removed two stale internal re-exports left over from the field/ module split.
