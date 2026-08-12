---
"paperlab": minor
---

Draw the boundary around stage mode. `<PaperStage>` is a composition the library ships, so its insides are no longer part of the API: the figure, the surround, the gait and camera math, and the quality ladder are all un-exported (`Figure`, `Source`, `Surround`, `makeGlowTexture`, `makeSkyTexture`, `splitAcrossBanners`, `bannerTextSize`, `PROPORTIONS`, `figureGait`, `cycleLength`, `placeFigure`, `figureSchema`, `qualityTiers`, `qualityFor`, `tierUp`, `tierDown`, `INITIAL_TIER`, `TIER_ORDER`, `stageCamera`, `walkPoint`, `getWalkPath`), along with sub-schemas that were redundant slices of the already-exported `stageSchema` (`stageSourceSchema`, `stageGroundSchema`, `shotSchema`, `walkPathSchema`). Stage's public surface goes from 71 symbols to 33; what remains is what you need to render a stage, configure one, name one, or serialize one.

The stage share-link helpers (`encodeStageShare`, `decodeStageShare`, `readStageShare`, `stageShareUrl`, `SHARE_PARAM`, `MAX_SHARE_LENGTH`, `StageShare`) are **removed from the library**. They encoded the playground's own payload shape — a preset id plus a diff — which no other consumer could use, and they now live in `apps/playground`. The library's contribution to a shared link is `stageSchema`, which is what the untrusted half of a link should be validated against anyway.

Stage mode is also now documented, which it wasn't: `<PaperStage>` has entries in the README, `AGENTS.md`, and `docs/llms.txt`.
