---
"paperlab": patch
---

A callback prop is a notification, not a dependency — the last two places that had it the other way round.

Both are the shape that made the editor feel frozen in stage mode a fortnight ago, found in the same sweep and left open because neither was a loop. They are closed now.

**`<DropZone>` re-registered on every render of the page above it.** The registration effect named `onPlace` in its dependency list, and the natural way to pass that prop is an inline arrow — a new function every render. So a consumer re-rendering for any reason at all tore the zone out of the registry and put it back, which bumped the registry version, which re-rendered every `DropZoneVisual` in the field. It was churn rather than a loop only because the effect's own component is not what the version change re-renders, and that was luck rather than design. The registration now depends on what the zone **is** — its id, bounds, accept globs and highlight — and reaches the callback through a ref at the moment a paper is actually placed.

**`<PaperStage>` re-parsed its whole schema on every render.** `stage` arrives from an editor or a page as a fresh object literal, so keying `stageSchema.parse` and `getWalkPath` on its identity meant both ran again for a value that had not changed. Harmless once per render and never wrong, but it is why each iteration of that earlier feedback loop cost as much as it did. Now on serialized deps, the way `PaperFieldMesh` already did it.

Neither changes an API or a rendered frame. Both remove work that a well-behaved consumer could not have avoided doing.
