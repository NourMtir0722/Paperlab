---
"@paperlab/playground": patch
"@paperlab/editor": patch
"@paperlab/docs": patch
---

The figure in the demo apps is a real character now, not capsules.

`figure.model` existed but nothing pointed at it, so the road was built and nobody drove down it. All three apps now hand the stage a rigged glTF and the walking silhouette is a person: shoulders, a head that sits on a neck, arms that swing from a body rather than from a pair of hinges.

**The asset stays out of the library, and that boundary is now enforced rather than merely intended.** It lives in each app's `public/`, the library ships no assets and no stage preset names a URL, and `pnpm pack` was checked: ten files, no `.glb`. Anyone installing `paperlab` still gets the capsule figure and brings their own model — which is the only arrangement that works, since a preset naming a URL would be a promise the npm package could not keep.

The URL is built from `import.meta.env.BASE_URL` rather than hardcoded, because the editor deploys under `/editor/` and the docs under `/docs/`; an absolute `/figure/…` would resolve against the site root and 404 for two apps out of three. `playground` and `docs` gained the `vite-env.d.ts` the editor already had, following that app's existing choice to declare the `import.meta.env` shape it uses rather than resolve `vite/client` through pnpm.

**On the choice of asset.** It is Khronos's Cesium Man, CC-BY 4.0, attributed in `NOTICE`. Not the first pick aesthetically, but the reasoning is worth recording: Mixamo is out on licence — its prohibited list names "any type of free distribution of character or animation raw files" and `figure.model` is a URL, so serving one is exactly that. Quaternius and Kenney are CC0 and would be ideal, but their downloads are itch/Patreon-gated and cannot be fetched unattended. Of what can actually be obtained and lawfully redistributed, this is the only properly-proportioned human with a walk cycle. Swapping it later is one file and one line.

Two limits worth knowing. It carries a single unnamed clip, so `gait: 'run'` reuses the walk rather than finding a run — `pickClip` falls back rather than failing, which is exactly the awkward path it was written for. And the file is 438 KB including a texture that never renders, since the figure is drawn as an unlit silhouette; the same blob is committed at three paths but git stores it once.

Verified in all three apps: the model is requested and returns 200, the figure renders as a person, and no console errors — including the docs page, where five stage cards share one cached glTF and each needs its own skeleton, which is the case `SkeletonUtils.clone` was added for.
