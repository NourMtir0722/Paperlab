---
"@paperlab/playground": patch
"@paperlab/editor": patch
"@paperlab/docs": patch
---

The demo apps' figure is a CC0 rig with twenty-four clips, and the README's own hero finally shows it.

The last pass recorded that Quaternius' CC0 packs "are itch/Patreon-gated and cannot be fetched unattended", and settled for Cesium Man on CC-BY. That was wrong in one specific way: the gate is on quaternius.com, and **poly.pizza mirrors the same packs with direct, ungated GLB links**. So the asset is now "Business Man" from the Ultimate Modular Men Pack — CC0, properly proportioned, no textures at all, and carrying **Walk, Run and Idle** among twenty-four named clips. It is four skinned meshes on one armature, since the pack is modular; `SkeletonUtils.clone` and a single mixer on the root already handled that, and it measures as costing nothing over a single-mesh rig.

`pickClip` taking the shortest matching name earns its keep immediately here: `/run/` matches `Run`, `Run_Back`, `Run_Left`, `Run_Right` and `Run_Shoot`, and `/idle/` matches six clips including `Idle_Gun_Pointing`.

That closes both limits the old asset was accepted with. `gait: 'run'` finds a real run instead of falling back to the walk, and a figure that is not going anywhere stands in an idle clip. `NOTICE` records the source, though CC0 waives the requirement — saying where a file came from is the honest thing to do, not something the licence asks for.

**The README's stage loop was recorded off the capsule fallback**, which meant the one picture most people ever see of stage mode was the thing that renders when you have *not* supplied a model. `pnpm media` now points at the same rig the apps do, and the loop was re-recorded against the new lighting.

The boundary is unchanged and re-checked: the asset lives in each app's `public/`, no stage preset names a URL, and `pnpm pack` is ten files with no `.glb`.

The editor's stage harness gained a query parameter per light slider (`?exposure=`, `?direction=`, `?height=`, `?key=`, `?ambient=`, `?studio=`, `?haze=`, `?spread=`, `?finish=`) so a look can be swept from the shell before it is written into a preset, and `pnpm shot` takes `--w` / `--h` — composition is a function of the frame it is composed in, and a stage that reads in a tall panel can be all empty sky in a 16:9 hero. `?shadows=0` was removed: `stageSchema` has no `shadows` field, so zod had been stripping it silently and the flag did nothing.
