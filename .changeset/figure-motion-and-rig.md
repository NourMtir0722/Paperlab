---
"paperlab": minor
---

The stage figure walks like a body now, and can be somebody else's rig.

It had thighs, knees, arms, a bob and a lean, and that was the whole gait. What it did not have is the thing you actually recognise a human walk by: **the pelvis and the chest turning against each other.** A walk without that counter-rotation reads as a shamble however good the legs are.

So the gait grew the terms that were missing, all of them driven by distance walked exactly as the old ones were:

- **Pelvis rotation**, carrying the swing-side hip forward — which is how a step gets longer than the leg is.
- **Chest counter-rotation** against it, cancelling most of that angular momentum so the head travels straight. Given as an absolute rotation against the direction of travel rather than relative to the pelvis, so "these two oppose" is legible in the data and testable; the renderer applies the difference.
- **Lateral sway**, the trunk leaning over whichever foot is carrying the weight, twice per stride.
- **Pelvic obliquity**, the unweighted hip dropping away as it swings.
- **Elbows.** The arm was one capsule from shoulder to wrist; it is now an upper arm and a forearm with a joint between them, carrying a standing bend that tightens as the arm drives forward.

**And running, which is not a fast walk.** `figure.gait` is `'auto' | 'walk' | 'run'`, and `'auto'` decides with the Froude number — `v²/gL` against leg length, past ≈0.5 — so the transition sits where a real one does and *moves with the figure's size*: a shorter figure breaks into a run at a speed a taller one still walks. A run swings further, folds the knee toward the seat, holds the elbows near a right angle, leans harder, and covers more ground per step.

The tell is the bounce, and it inverts. A walk vaults over a straight stance leg, so it is highest at midstance and never rises above standing height. A run's leg is a spring that compresses under the body at midstance and throws it clear of the ground in between — so the same curve turns upside down and crosses zero. `bob` may now be positive, which it never was before, and only ever in a run.

**`figure.model` takes a rigged glTF/GLB.** The asset is not part of the library and never ships in the npm tarball — it is a URL the app hosts. What the library contributes is the part that is actually hard: **the clip is scrubbed by distance walked, not played on a mixer clock.** Run a walk cycle on its own timeline and the feet skate the moment the figure's pace disagrees with the animator's, which a scroll-driven walk does constantly. One gait cycle maps onto one pass of the clip, and `stride` is the knob that syncs a particular asset.

Around that: the clip is chosen by name so `Walk`, `walk_01` and `Armature|Running` all resolve (and it will take the other gait over nothing); the rig is scaled to `figure.height` off its own bounding box, so assets authored in centimetres and in metres both come out right against the paper; it is cloned through `SkeletonUtils` so two figures on one URL cannot drive each other's skeleton; and it is drawn as a silhouette like the capsules, because the nave is lit from behind and a shaded character dissolves into the haze it has to read against. Anything that fails — a 404, a file that is not a glTF, a rig with no clips — falls back to the capsule figure rather than emptying the stage, and says so in the console.

**One invariant narrowed on purpose.** The gait used to promise "same ground covered = same pose, whatever pace put the figure there". It now promises that *within a gait*: crossing the walk/run threshold is a different gait with a different stride, so the pose at a given distance changes with it. The old wording was never quite true anyway — `lean` has always read `speed`. The test that pinned it now says which it means, and a second one pins that the rule still holds inside a run.

Also fixed while wiring the trunk: the forward lean was applied to the hips, which tipped the legs along with it. A body leans from the waist, so it now applies to the trunk and the legs stay under it.
