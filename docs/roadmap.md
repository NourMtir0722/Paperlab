# Paperlab — what it is, and where it's going

> **Read this first.** This is the project's memory: what Paperlab is, who it's
> for, what's already decided, and what we want to build next. If you're an
> agent or a collaborator joining a conversation cold, start here — the README
> sells the product, `AGENTS.md` documents the API, and this file explains the
> *intent* behind both.
>
> Last updated 2026-08-12 · library at `0.1.0`

---

## What Paperlab is

**Physical, realistic paper as a React component.** A sheet is real 3D geometry,
not a CSS trick and not a video — content is a texture on a mesh that genuinely
bends, so text and images curl with perfect continuity. You can peel a corner,
unroll a receipt, fold a letter, pin a poster in the wind, arrange a gallery of
prints, or build an entire room out of hanging banners and walk through it.

The thing that makes it a *library* rather than a pile of demos: **a paper is
data.** Every sheet serializes to a `.paper` JSON object validated by one zod
schema, and that schema is the single source of truth — it validates the API,
generates the editor's controls, defines the file format, and feeds the docs.
If a feature can't serialize into a preset, it doesn't ship.

### The shape of it

| piece | what it is |
| --- | --- |
| `packages/paperlab` | the npm library — the only published artifact |
| `apps/editor` | the sculpting tool: presets, canvas handles, inspector, export |
| `apps/playground` | the front door: one input, one scene, shareable by link |
| `apps/docs` | the human reference: the whole catalogue, rendering live |
| `docs/llms.txt` · `AGENTS.md` | the agent-readable API reference |

### What exists today

- **9 behaviors** — `peel`, `unroll`, `flip`, `letter-fold`, `hang`, `fly`,
  `fall`, `carry`, `flight`. Human-named params ("tightness", not
  "cylinderRadius") over a stack of pure geometry deformers.
- **6 deformers** — `roll`, `curl`, `bend`, `fold`, `wave`, `drape`. Each has a
  JS implementation (CPU/hero path) and a GLSL twin (GPU/field path), held
  identical by a golden-vector parity gate.
- **12 layouts** — every one names a place paper actually sits: `book`,
  `accordion`, `fan`, `spread`, `pile`, `rack`, `wall`, `spill`, `sweep`,
  `ring`, `colonnade`, `sheet`.
- **12 paper presets**, **5 stage presets**, **7 stocks**.
- **Three modes** — one paper, a field of them in a single instanced draw call,
  or a stage you walk through.
- **387 tests** + a 27-case GPU/CPU parity gate, all green in CI.

---

## The goal

Make Paperlab a product people reach for, launched well, and grown **from the
community to the community** — where the point is helping people make good
paper components they can drop into their own projects.

Three audiences, and everything should serve at least one of them:

1. **Someone who wants paper in their site.** They should get there in one
   line. `npm i paperlab`, `<Paper preset="receipt-unroll" />`, done.
2. **Someone who wants to make a paper.** The editor, and the loop that lets
   them send what they made to anyone else.
3. **Someone who wants to extend the engine.** The registries
   (`registerPreset`, `registerBehavior`, `registerLayout`, `registerDeformer`)
   and the contribution ladder in `CONTRIBUTING.md`.

---

## Decisions already made

These were worked through with real evidence. **Don't re-litigate them without
new information** — the reasoning is recorded so future conversations can build
on it instead of repeating it.

**Stage stays in the library, and is NOT split into `paperlab/stage`.**
Measured: a bundle importing only `Paper` is 24 KB gzipped and already contains
zero stage code, so tree-shaking does the whole job and a subpath would save
nobody a byte. A subpath also can't version separately from its parent. What
was done instead: the scene's internals are un-exported (`<PaperStage>` is the
composition; its guts are free to change), and the playground's share-link code
was moved out of the library entirely.

**App infrastructure does not live in the library.** URL-share encoding is the
test case: the payload shape belongs to the app, and the library's contribution
is the schema the untrusted half gets validated against. Stage share lives in
`apps/playground`, paper share lives in `apps/editor`.

**The library-wide export trim is deferred.** 284 exported symbols is more
surface than a 0.x should promise — a lot of it is implementation helpers
(`lightenHex`, `barcodeBars`, `stackUniformValues`, the individual layout and
deformer functions that `getLayout`/`getDeformer` already reach). But it's hygiene, and it loses to anything that helps people
actually find and use the thing. Do it before 1.0, not before launch.

**The zod schema is the spec.** Restated because it's the decision everything
else hangs off. A feature that can't serialize into a `.paper` waits.

**Deformers ship in pairs.** Any change to a JS deformer must change its GLSL
twin; `pnpm test:parity` is a hard gate, not a suggestion.

---

## Now — the launch runway

Nothing here is a code problem. It's all distribution.

- [ ] **Publish `0.1.0` to npm.** Push, then merge the changesets release PR.
      The published `0.0.1` predates stage mode entirely, so today `npm i
      paperlab` gives people a library that can't do what the README shows.
      *(Everything downstream points at this — do it first.)*
- [ ] **Turn on the demo.** Settings → Pages → Source: "GitHub Actions". The
      workflow is written and verified; the playground goes live at the root,
      the editor at `/editor`.
- [ ] Product Hunt / launch posts, once both of the above are true.

---

## Next — the ideas we want to build

Ordered by how much each one serves the goal, not by effort.

### 1. A community gallery — *deferred, but the big one*

**Status: planned, not started. Noor wants to come back to this.**

The loop that carries a paper from one person to another now works: sculpt it,
hit **Share**, send the link, they open it and get an editable copy they can
ship. What's missing is the part that makes it *compound* — **there is nowhere
to see what other people have made.** The loop carries; it doesn't attract.

What a first version could be, roughly cheapest-first:

- A `community/` folder of `.paper` files in the repo. A PR adds one. This
  reuses the existing preset ladder and needs no backend at all.
- A gallery page that renders each one — the `pnpm media` tool already renders
  any preset headless, so thumbnails can be generated in CI rather than
  uploaded by hand.
- Every card links straight into the editor with that paper loaded (the
  `?p=` share link already does exactly this), so "see it → open it → remix it
  → ship it" is three clicks with no account anywhere.
- Attribution on every card. Credit is the currency; `meta.author` already
  exists in the schema.

Open questions to settle when we pick this up: does it live in the repo or get
its own submission flow? Is it curated or open? Does it need a backend at all
(probably not, for v1)?

### 2. ~~A human documentation site~~ — *done*

`apps/docs`, shipping at `/docs` beside the playground and the editor. A
person evaluating the library used to read the README and then fall off a
cliff; now there is a page that shows them everything.

The decision that shapes it: **the catalogue is read from the registries at
runtime, not typed into a page.** Every preset, behavior, layout, stock and
stage card comes from `listPresets()`, `listBehaviors()`, `listLayouts()`,
`stocks` and `listStagePresets()`, and every parameter table is walked out of
that entry's own zod schema — bounds, enums and defaults included. Register a
behavior and it documents itself; delete a layout and its card disappears.
This page structurally cannot advertise something the library does not have,
which is the failure the README has already had once.

Everything on it renders live rather than as a screenshot, because a library
whose pitch is *real geometry that bends* cannot be sold in stills. Each card
holds a WebGL context only while it is on screen (a browser gives you about
sixteen), and the stages load on click because a stage is a whole room.

**What building it found, which is the better half of the story:** writing
real examples against the public API proved the documented API did not
compile. `<Paper surface={{…}} />` was documented in three places and was not
a prop at all — silently dropped at runtime — and every config prop took its
schema's *parsed* type instead of its *input* type, so the README's own
"sculpt your own" example was a type error. Both fixed, with
`config/props.test.ts` pinning the documented examples at the type level and
at runtime. Worth remembering as an argument: **the docs site is a test of
the API, not just a description of it.**

Still open, and deliberately not done yet: a per-prop reference for the
top-level paper schema itself (the JSDoc prose lives in the schema source and
would have to be extracted at build time), and any kind of search.

### 3. Smaller things worth doing

- **Trim the public API** before 1.0 (see Decisions above).
- **The `field-ring` hero asset** shows the blank backs of the far sheets. It's
  physically correct, but a distinct image per sheet would read better.
- ~~**The editor remembers nothing between sessions.**~~ **Done.** Reopening
  restores the paper that was on the canvas — the sculpt included, saved or
  not — along with the mode, the field composition, and the stage you were
  walking. It is one validated localStorage key (`apps/editor/src/session.ts`,
  written debounced and flushed on `pagehide`); anything that fails the schema,
  or names a preset/layout/stage this build no longer has, is dropped and you
  land on the default, which is exactly the old behaviour rather than a broken
  editor. A `?p=` share link still outranks the remembered view — otherwise
  someone whose last session was stage mode would be told about the paper they
  opened instead of shown it.

---

## Ideas parking lot

Nothing here is committed — it's a place to put things so they aren't lost.
Add freely; we'll sort later.

These came out of a stage-mode review on 2026-08-12, read against a mood
board: a spiral of certificates rising around a trophy, orange sheets lit like
a film set, blue sheets with a liquid-glass surface, crumpled paper, a sheet
burning, the Aesop paper-ribbon installation, and the Zettel'z chandelier of
hanging notes.

The complaint underneath all of them: **stage mode is composed like a demo and
lit like a viewport.** The geometry is real; the picture isn't finished.
Nothing here is a rewrite — most of it is a hole the architecture already has
a shape for.

Grouped by what they touch, not by priority.

### Lighting is the only part of the engine that isn't data

For anyone using this as a procedural asset tool — which is what it is.

Every other axis is parametric: sheet, stock, surface, deformer stack, layout,
walk, shot. **Lighting is an enum of six strings.** You cannot place a light,
size one, warm one, or add a second. That is the inconsistency, and it is why
the light reads as authored-once rather than art-directable.

What is actually in the rig today, verified in `scene/PaperLighting.tsx`: one
`<ambientLight>`, one `<directionalLight>` (or a `<spotLight>` when the preset
carries a gobo), and drei's `<ContactShadows>`. That is the whole thing.

The specific things missing, roughly in order of how much each one costs us:

- **No environment map anywhere** — no `Environment`, no `envMap`, no PMREM.
  Paper has real sheen, and with nothing to reflect it can only ever look
  matte. drei is already a dependency, so this is close to free.
- **Flat ambient kills form.** `<ambientLight>` adds brightness with zero
  directionality — it is the single biggest reason surfaces read flat.
  Directional ambient from an environment is the same brightness with shape.
- **The surround dome lights nothing.** Stage mode already builds a graded sky
  around the whole space and it is a plain gradient mesh. It is the obvious
  IBL source, it already exists, and using it would make the hall consistent
  with itself for nearly no cost. Probably the best single idea in here.
- **No area lights.** `RectAreaLight` is the most photographic source three
  has, and paper beside a window or a softbox is exactly that case. Caveat: it
  casts no shadow in three, so it is a fill, never the key.
- **Shadows do not harden at contact.** One shadow map, one uniform
  `shadow-radius` blur. Real shadows are sharp where the object touches and
  soften with distance, and that gradient is *the* tell. PCSS-style soft
  shadows are the fix.
- **One shadow map spans the whole walk.** A 36-unit colonnade under a single
  2048 map leaves each banner a handful of texels, which is likely why the
  hall reads soft rather than lit. Cascades are the standard answer. Worth
  measuring before assuming.
- **No bounce.** A sheet lying on the ground does not pick up the ground.
- **Intensities are eyeballed** (`1.6`, `3.4`, `×3.2` with `decay={0}`), and
  colors are hex. Lights have been physically based since three r155. An asset
  tool probably wants real units and **kelvin**, so "5600K key" means
  something to the person typing it.

Two constraints that decide the shape of this:

- **Transmission is coupled to the preset enum by signature.**
  `translucencyValues()` takes a `LightingName` and reads that preset's single
  key light to build the uniforms — deliberately, so the glow can never
  disagree with the lamp casting the shadows. Make lighting an authorable
  array and there is no single "key" to read, and the model has to answer
  "which light is this sheet backlit by" for N lights. **That is the real work
  in this idea; adding lights is the easy half.**
- Whatever lands has to survive the **instanced** field path, or hero and
  field modes stop matching. That is the same rule that kept
  `MeshPhysicalMaterial` out (see the transmitting-stock entry).

### The scene has no grade

For anyone who looks at it. There is no post-processing anywhere in this repo
— not in the library, not in either app (verified: nothing depends on
`postprocessing`, and no `EffectComposer` exists). `<PaperStage>` sets ACES
tone mapping and stops there.

Bloom around the source, a light grade, and some falloff is most of what
separates the reference images from what we currently render, and it is the
smallest change on this list. Worth doing before any new geometry, because
until it exists every other addition will also look cheap.

Constraint: this is a peer-dependency question, and it may belong to the apps
rather than the library — same reasoning as the share-link decision. A grade
is also not obviously serializable into a `.paper`, which by our own rule
means it waits or it lives outside.

### A stock that transmits

For the "liquid glass" half of the mood board. `PaperMaterial` extends
`MeshStandardMaterial`, which has no transmission — so that look is currently
not reachable at any setting, not merely untuned.

The honest version isn't "liquid glass", which isn't paper and would break the
one claim this library makes. It's **glassine, or tracing paper**: real stocks,
genuinely transmissive, and they'd give the reference's read while staying
true. `vellum` already leans this way via `translucency`, but translucency is
our own cheap approximation, not refraction.

Constraint, and it is a hard one: this needs `MeshPhysicalMaterial`, and
**`MeshPhysicalMaterial` does not instance** — which is the recorded reason
the current translucency model is a hand-written dot product and an additive
term instead. So a transmitting stock either works in hero mode only, or the
field path needs its own approximation and the two modes stop matching. Decide
which before starting.

### Crumple — the missing primitive

For anyone who wants paper that has been *handled*. Six deformers and not one
of them crushes a sheet. `wave` and `fold` are the nearest and neither reads
as crumpled; the mood board's ball of scrap paper is unreachable today.

Crumple is the most recognizable paper state there is, which makes this the
biggest single gap in the deformer set.

Constraints:
- Ships as a pair, like every deformer: JS `displace` + GLSL twin + golden
  vectors in `pnpm test:parity`.
- **The normals matter more than the displacement.** A crumple that doesn't
  shade its own facets looks like a noisy sheet, not a crushed one, and the
  current deformers all lean on smooth-shaded geometry.
- It needs segments. Whatever `geometry.minSegments` ends up being will make
  it the most expensive deformer in field mode.

### Fire and wet as surface states

For anyone who wants paper that something has *happened to*. Neither exists;
`wind` roughly does (see below).

Both are surface effects rather than new systems, and `surface/compose.ts` is
already the right shape for them — namespaced GLSL chunks composed into one
program, driven by uniforms a state machine can animate:

- **Burn.** Structurally the deckle chunk with a moving boundary: deckle
  already alpha-discards along an fbm-gnawed edge, so a char front is the same
  code with the edge driven by a `uBurn` uniform 0→1, plus a char band and an
  emissive ember rim. Smoke would be separate and is probably not worth it.
- **Wet.** A spreading front that darkens and saturates the sheet, drops
  roughness, and raises translucency behind it. Cockling — the buckle wet
  paper takes — is `wave` with irregular amplitude, so the geometry half may
  already be there.

Both serialize as a single number, which is the test that matters.

### Wind, properly

`physics/aero.ts` already has seeded gusts and critically-damped follow, and
`fly` / `hang` both source from it. So this is a tuning and presets job rather
than a build — closer to "we never made a good wind preset" than to a missing
feature. Worth confirming before it gets scoped as work.

### Museum compositions

For the field and stage heroes, which currently show a ring and a colonnade
and read as *layout demos* rather than as places.

Three layouts the mood board wants and we don't have:

- **`vortex`** — the certificates around the trophy, and the sheets orbiting
  the seated figure, are both a helix: radius, rise, several turns, banking.
  `ring` is one flat circle at `i/n`. This is a short pure function and the
  most directly useful of the three.
- **`mobile`** — the Zettel'z chandelier: notes suspended at varied drop
  lengths from a shared point, drifting.
- **`ribbon`** — the Aesop installation: floor-to-ceiling paper strips with
  type running down them, pooling where they meet the floor. Possibly
  `colonnade` with a long enough drape and floor contact rather than a new
  layout.

Constraints:
- **Do not delete `ring` and `pile` to get here.** They're 2 of 12 named
  layouts and presets and tests depend on them. What's actually wanted is a
  different hero *composition*, not fewer capabilities.
- These read as installations only if the sheets differ from each other. This
  is the same complaint already filed against the `field-ring` hero asset
  showing blank backs — one shared texture is what makes a gallery look like a
  carousel.

### A figure with a body

For stage mode, where the walker is capsules and a sphere. Replace it with a
rigged GLB — free/CC0, so it can live in the repo without a license problem.
Quaternius and Kenney are the candidates; **neither license has been verified
yet**, and Mixamo is free to use but murkier about redistributing raw assets.

Two things learned from reading `Figure.tsx` that will decide whether this
looks good or cheap:

- The figure is deliberately unlit `MeshBasicMaterial` because the nave is lit
  from *behind*. A detailed character in that scene is still a black
  silhouette. **The win is motion quality — shoulder counter-rotation, spine
  sway, head — not surface detail.** If we want the model itself to be seen,
  that's a different lighting preset, i.e. a different idea.
- The whole interaction model is `distance`, not time — that's what lets
  scroll drive the walk. So the GLB's walk clip has to be **scrubbed by
  distance**, not played on a mixer clock, and its rate matched to stride
  length or the feet skate. This is the part that gets skipped.

Constraint: the asset does not ship in the npm tarball. The library takes a
`figure.model` URL (which serializes fine); the apps host the file.

### Hands — paper you touch

For the demo that would actually spread. MediaPipe's `HandLandmarker` gives 21
landmarks per hand from a webcam: pinch distance → crumple amount, wrist
rotation → roll angle, hand position → grab point. Scratch a sheet, roll it,
crush it, with your hands, in a browser tab.

Constraints:
- **Not in `paperlab`.** Webcam permission plus several MB of wasm and model
  weights, inside a library whose pitch is 24 KB gzipped, is not a trade we
  make. A separate `@paperlab/hands` package, or an app-level demo.
- Which costs nothing architecturally, because it's **just another driver of
  values the schema already understands** — the same position share-link
  encoding ended up in.
- Wants `crumple` to exist first, or there's little to drive.

### Put your own image on it — and still be able to send it

For someone who designed something in Figma, Illustrator or anywhere else and
wants it printed onto the paper or the banner. Their artwork, our physics.

Worth being precise about what exists, because most of this is already built
and the gap is somewhere unexpected:

- **The editor already uploads.** `pickImageAsDataUrl()` takes a local file,
  downscales it to 1024px, and stores it as a self-contained data URL, so it
  survives localStorage, `.paper` export, and re-import. That half is done.
- **The library already accepts images everywhere**, including stage mode —
  `<PaperStageScene>` takes `images: string[]` and hands them to the field.
- **The playground does not expose it.** A stage banner can only take `text`
  today, so the flag-with-your-artwork-on-it case — the one actually being
  asked for — has no path through the UI even though the engine supports it.
- **The field composer fills image slots with procedural demo tiles**, which
  are preview-only and deliberately excluded from export. There is no way to
  put twenty of *your* images on twenty sheets.

And then the part that matters most:

**The moment you upload an image, your paper stops being shareable.** A
downscaled JPEG is ~100 KB as a data URL; `MAX_SHARE_LENGTH` is 8000, so
`tryEncodePaperShare` refuses and there is no link. Which means the single
most personal thing anyone can make here — their own artwork on paper — is the
one thing they cannot send to anyone. That inverts the entire share loop this
project just built.

So this is not a rendering problem, it's a distribution one, and it has the
same three answers it always has:

- Keep it a data URL and accept that image papers travel as files, not links.
  Honest, costs nothing, and quietly makes the best papers the least viral.
- Host the image somewhere and put a URL in the config. Fixes links, but it
  means a backend, which every other decision here has so far avoided.
- Content-address the upload — hash it, store it once, reference it. This is
  **the same infrastructure the community gallery will need**, so the two
  ideas should probably be costed together rather than separately.

Constraint worth stating up front: whatever is decided, an uploaded image is
untrusted input that ends up in a `.paper` that other people open. `src` is
currently just `z.string()`.
---

*The rest of these came from the same pass — my suggestions rather than
Noor's, kept here so they're in the same place.*

### Export a paper as an asset, not just as a component

For the much larger audience that will never write React. Right now the only
output is a React component in a browser; a designer in Blender, Spline, After
Effects, Figma or Unreal cannot use any of this.

If a `.paper` can bake to a **`.glb`** — deformed geometry, composed textures,
baked — or to a transparent PNG sequence, then Paperlab feeds every one of
those tools, and "procedural paper asset generator" becomes literally true
rather than a description of the React library. `pnpm media` already renders
presets headless, so half the machinery exists.

This is probably the biggest single expansion of *who this is for* available,
and it should be weighed against the community gallery rather than after it.

### Sheets have no edge

A sheet is a zero-thickness plane. `thickness` exists in the config but only
feeds an opacity term — it is never geometry. At grazing angles and in any
close-up, the missing edge is the first thing that gives the render away, and
this library's whole claim is close-up realism.

Either real extrusion (expensive, and it doubles the geometry) or a shader
fake — darkening and a fiber band at the silhouette. Worth prototyping the
fake first.

### Ink sits on the paper instead of in it

Content is drawn to a canvas, multiplied by the stock's `inkColor`, and then
the grain chunk multiplies *everything*, ink included. Real print is the other
way around: ink soaks into fiber, so the grain shows **through** it, it gains
at the edges of strokes, it misregisters very slightly, and it has a different
specular response than the stock around it — matte toner on gloss photo paper
is a completely different surface.

Small shader change, and it is the difference between "a texture on paper" and
"a thing that was printed".

### A camera with a lens

The stage runs at `fov: 38` and that is the entire camera model. Focal length
in mm, an aperture, a focus distance, and therefore depth of field. Half the
cinematic quality of every reference image is an 85mm wide open — the
background falling away is doing as much work as the lighting.

Pairs with the grade entry; probably the same piece of work.

### "Looks" — so the authorable version stays usable

The counterweight to making lighting data. Forty sliders produce worse
pictures than six presets do, because most people will not light a scene well
and should not have to.

A **look** bundles lighting + grade + camera the way a film stock names a
whole response: one word, art-directed, with the parameters underneath for
anyone who wants them. The six lighting presets become the first six looks
rather than the ceiling. This is what keeps "lighting is data" from being a
downgrade in practice.

**How to add one:** a heading with the idea's name, a sentence on *who it's
for* and *what becomes possible*, and any constraint you already know. Don't
worry about feasibility or ordering; capturing the intent is the job, and we
can cost it out when we pick it up.

---

## Working agreements

Small things that keep the project honest, learned the hard way:

- **Verify, don't assert.** Every claim in the docs should be checkable, and
  the interesting ones have tests. The README once advertised five layouts that
  didn't exist, and `pnpm typecheck` once passed on code that didn't compile.
- **Commit per milestone**, on `main`, with a message that explains the *why*.
- **One source of truth per fact.** The npm README is generated from the repo
  README because two hand-maintained copies always drift.
