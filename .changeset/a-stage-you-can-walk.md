---
"paperlab": minor
---

**Stage mode is navigable.** It was a picture you watched; now you can walk it.

The whole mode had one input — `progress` — and if nobody supplied one the walk ran on a clock. There was nothing to touch: no drag, no wheel, no keyboard, no way to stop in front of a banner and read it. Field mode has had `motion={{ driver }}` since it shipped, and the stage — the mode most likely to be somebody's entire homepage — had nothing.

```tsx
<PaperStage motion={{ driver: 'drag', speed: 1, capture: true }} />   // the default
```

Same contract as a field's, and the same three driver names. `drag` is the viewer: pointer drag with inertia, wheel, arrow keys, PageUp/PageDown, Home/End, or a click on the paper you want to stand in front of. `autoplay` is the clock and only the clock. `none` is nobody.

**It drifts until you touch it.** `drag` walks on its own until the first pointer, wheel or key, and is yours for good from then on. That is deliberately one behaviour rather than two drivers, because the alternatives are each half wrong: a stage that only autoplays cannot be touched, and one that only waits opens as a still photograph of itself.

**Steps land on a paper, not near one.** `Layout.walkStops(n, options)` is a new optional member — only a layout that arranges along a path can answer it — and `colonnade` computes it from the same helper `pose` places banners with, so a stop cannot drift off its banner. Layouts that arrange around an origin simply decline, and stepping falls back to an even spread.

**`capture`** (default true) is whether the walk takes the wheel and touch away from the page. True for a stage that fills the screen — it *is* the page. False for one sitting in a column of prose, where capturing them eats a reader's scroll on the way past and traps a finger on a phone; mouse drag and arrow keys still work. Even when captured, the wheel is handed back at the ends of an open walk rather than pressing silently into a wall.

Supplying `progress` still outranks all of it: a stage bound to page scroll is a controlled component, and a driver writing the same number the page is writing is a fight, not a feature.

Two supporting additions. `<PaperStage onProgress={walk => …} />` reports the live position every frame it changes, whoever is driving — mirror it into an uncontrolled input for a scrubber that follows the walk with no re-renders, exactly as `<PaperMesh>`'s `onProgress` does for a behavior. And `<PaperFieldMesh onSelect={paper => …} />` fires with a paper's index when it is clicked; supplying a handler is what makes the papers raycastable at all, which matters because hit-testing an instanced mesh is per-instance work on every pointer move.

Fixed while wiring it: autoplay used to extrapolate straight past the end of an open walk and keep going for as long as the tab was open — a camera stationed in the dark past the last banner. It wraps. The playground had been running its own clock and its own `% 1` specifically to avoid that, and no longer needs either.

**`pnpm test:drive` is new and is in CI.** The navigation is pointer capture, wheel handlers and key handlers against a live canvas, and no unit test can see any of it; the math has unit tests, and this drives a real browser through drift, drag, flick, wheel, arrow keys, a click, and a controlled stage refusing all of it. It paid for itself on the first run by catching `raycast={undefined}` — which does not mean "leave the default", it assigns undefined over the method three is about to call, and silently disabled every click.
