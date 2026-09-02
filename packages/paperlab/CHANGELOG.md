# paperlab

## 0.6.0

### Minor Changes

- 06ff0ad: A simulation and a shape are no longer alternatives. Cloth hosts a deformer stack.
  
  `physics: 'cloth'` and `behavior` / `deformers` used to be mutually exclusive, rejected by the schema with *the sim owns the vertices*. It was the largest single constraint in the library. Twelve behaviors ship and exactly one of them — `crumple` — could be reached from a sheet anyone could touch, and only by swapping the simulation out first: the drape the sim had spent a second building was thrown away, and the crush started from a flat sheet. Everything about holding a piece of paper and then doing something to it was out of reach, because holding it and doing something to it were different modes.
  
  They compose now. The sim writes the vertices and the stack runs over what it wrote:
  
  ```tsx
  // Fold the sheet that is hanging there, while it hangs there.
  <Paper
    physics={{ type: 'cloth', pins: 'top-corners', wind: 0.3 }}
    deformers={[{ type: 'fold', options: { angle: 90, offset: 0.2, foldAngle: 120 } }]}
    interactive
  />
  ```
  
  The change is smaller than the constraint it lifts, which is the good news and was also the reason to look: **a deformer is a pure map from a point to a point.** It never asked where its input came from. `applyDeformerStack` already took the base array to start from, so handing it the simulation's live particles instead of the flat rest pose is the whole of the composition. What made this an invariant rather than an omission was three copies of the same early return — in the schema, in `buildStack`, and in `withMemory` — and one of those had already left a note anticipating the day it stopped being the only reader.
  
  Four things had to move with it:
  
  - **The grab has to speak in rendered space.** A pointer hits the sheet you can see, and with a shape running over the simulation that is not where the particles are. It now finds the nearest RENDERED vertex — which is the particle of the same index, because a deformer maps points and never reorders them — and carries the displacement at the moment of the grab as a constant offset. Exact when the grab lands, and honest as the deformation changes under it. Unchanged when nothing is deforming the sheet, where the offset is zero.
  - **The cloth grid honours the stack's floor.** `fold` needs 48 segments to bend through rather than crease along. A shape running over a simulation is no less entitled to the grid it needs than one running over a flat sheet — still capped, because every particle is a constraint solve five times a frame.
  - **A rebuild keeps the simulation's state.** A stack arriving over a sheet rebuilds the mesh without touching anything the physics knows, so `ClothSim.adopt` carries the particles across. Otherwise the sheet snapped flat at the exact moment you tried to fold the one you were holding.
  - **`memory.creases` now bends a cloth sheet, not only shades it.** A crease was always meant to be read by the geometry and the shading both; on a simulated sheet only the shading ran, because the geometry half needed a deformer stack the sheet was not allowed to have. Paper remembers a fold whether or not it is being simulated.
  
  **`strip` stays exclusive, and not out of caution.** Cloth simulates the sheet's OWN grid, so a deformer's uv means on the sim what it means everywhere else. A strip is a 2×N ribbon whose rows are chain nodes: its uv runs along a length of paper that is partly wound on a roll, so a fold placed by uv would land somewhere the sheet is not. The schema says so in those terms now.
  
  **The GPU path is unaffected**, which is worth stating because it is the first question the parity gate raises. Deformers run on the GPU in field mode, and a field has no simulation in it — cloth is hero-path only. All 37 parity cases compare the same JS and GLSL twins over the same flat input they always did.
  
  One limit to know about: `fold` places its hinge by POSITION, not by uv, so over a draped sheet it folds along a line in space rather than along a line in the material. On a sheet that is roughly planar — which is most of what cloth does — those are the same line. On a deeply crumpled one they are not.
- 06ff0ad: Creases are lit rather than painted, every surface effect is measured on the sheet instead of in UV, and the cloth learns what a hand and a gust of air actually do to paper.
  
  Five things that were done cheaply, found by looking hard at the `/hands` harness — where a camera can score a line at any angle, resize the sheet with two palms, blow at it and throw it, and so puts every one of these assumptions somewhere the built-in presets never did.
  
  **A crease had no shape.** `plCrease` multiplied a grey band into the albedo and added a fixed white sheen beside it. The mark therefore looked identical from every angle, under every lighting rig, and whichever way the paper had been folded — which is the one thing a crease is not, because a crease is two facets meeting at a line and swinging the sheet flips it from a dark line to a bright one. The effects now describe a HEIGHT and `MeshStandardMaterial` lights it, through `csm_FragNormal` and Mikkelsen's surface-gradient bump. One deliberate difference from three's own `perturbNormalArb`: three normalises the screen-space position derivatives, which keeps a bump map looking the same at any scale and is right for a texture. This is a real depth in world units, so the raw derivatives stay and the slope is a true one. Analytic height plus screen derivatives also anti-aliases itself — a crease shrinking below a pixel fades instead of crawling.
  
  The sign survives too. A fold toward the camera leaves paper concave from the front, so it draws as a valley, and the same crease from behind draws as the ridge it is. `CreaseShading.strength` is signed now; unsigned, a mountain and a valley were the identical smudge.
  
  **Every effect measured in UV.** UV divides the sheet's aspect out, so a 1.2 × 1.5 sheet is a unit square as far as the shader is concerned. Fibre came out stretched, a torn edge bit deeper into the short edge than the long one, and a crease scored at 45° rendered at 51°. All three also changed when the sheet was resized, which made the paper's own material a function of how big a piece you had cut. Grain belongs to the stock and a crease is a broken fibre; neither knows the size of the sheet. Everything now measures through `plLocal()`, in the sheet's own space.
  
  That let the crease shading and the crease GEOMETRY finally agree. `CreaseShading` carries the fold's own `{ angle, offset }` rather than a translation of them, so the shader evaluates the identical `dot(p, dir) - offset` the `fold` deformer displaces by, and the two cannot place a line differently. The shaded width comes off `CREASE_RADIUS` instead of a UV constant that agreed with it at exactly one sheet size — the mesh carries the wide hinge, the shader carries the burnished line inside it, and they add up.
  
  **A grab held one particle.** That is a pin, not a pinch: the sheet came to a point under the cursor and hung off the singularity. `ClothSim` now takes a patch about a centimetre across, measured across the grid so a fold that brings a far corner near the fingers cannot silently join the grip, with a smoothstep falloff — the centre held, the rim free, everything between partly both. The constraint solver's 0/1/2 weights became a real inverse mass, which reproduces them exactly for the two cases they could express and covers the rest.
  
  **Letting go stopped the paper dead.** A verlet particle's velocity IS the gap between its position and its last one, and the grab overwrote that gap every substep. So a sheet whipped across the frame and released came to a standstill and dropped straight down. The hand's speed is measured per second — a frame is not a fixed length and a substep is — and spent on release.
  
  **Wind was a uniform shove along +z.** Every particle got the same push whichever way its patch of paper was facing, so a sheet edge-on to the wind bellied out as hard as one square to it, a folded flap was pushed the same way as the face it was folded behind, and nothing ever turned into the wind. The force on a thin surface is the air it intercepts: the relative wind along the surface normal, pushed back out along that normal. Relative earns its keep twice — a sheet already travelling with the wind stops being pushed, so a blown sheet settles at a speed instead of accelerating away; and with no wind at all the same expression is air RESISTANCE, which the sim had none of. Paper's whole character in air is that it does not fall like a stone, and it does not because a sheet falling face-down catches what it is falling through while one falling edge-down knifes past it. That fell out for free.
  
  A small turbulent residue stays isotropic, because zero would be the textbook answer and the wrong one: a sheet lying exactly along the wind would stall in it forever, the one thing that could break the symmetry being the wind it is not feeling.
  
  **Unchanged:** the GPU field path, which composes its own shader and has no simulation in it — all 37 parity cases still compare the same twins. `ClothSim` is internal; `grab`, `moveGrab` and `release` keep their signatures.
- b6b7502: New `strip` physics: a roll paying paper out as the page scrolls, and the pile it makes when it lands.
  
  `unroll` and the `paper-roll` preset draw a roll with a deformer stack, and for paper that never reaches the ground that is still the cheaper and better answer. This is the half geometry cannot reach. A deformer bends a sheet along a curve you have already chosen; it cannot discover that a strip under compression buckles at its weakest hinge, and it cannot let one fold land on the one beneath it. Both of those are what a pile IS, and the pile is the whole effect.
  
  ```tsx
  const [scroll, setScroll] = useState(0)
  useEffect(() => {
    const onScroll = () => setScroll(window.scrollY / 120)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  
  <Paper preset="toilet-roll" physics={{ type: 'strip', scroll }} />
  ```
  
  `scroll` is a **monotonic world-unit number, not a 0..1 progress**. The sim differentiates it, so the absolute value never matters, a large `scrollY` on the first frame is read as an origin rather than as one enormous delta, and scrolling back up rewinds the roll — dragging the pile taut before it lifts.
  
  **The paper is grabbable.** With `interactive`, drag it and the roll turns —
  driven by TENSION rather than by mapping hand travel to an angle. Paper does
  not stretch, so if the hand is further from the roll than there is paper to
  reach it, the only way to satisfy the constraint is for the roll to give up
  more. That one rule gets the whole behaviour: a slow pull feeds smoothly, a
  yank spins the roll and it keeps spinning after release, and pushing the paper
  back toward the roll does nothing at all — slack does not rewind a roll, only
  scrolling up does.
  
  What the simulation buys over the deformer:
  
  - **The roll shrinks as it empties**, by area conservation, down to `core`. `ΔL = R·Δθ` at the *current* radius, so a nearly-empty roll spins fast and gives up very little paper — which is how a roll reads as running out.
  - **It buckles at the perforations.** Every joint wants to be straight; a joint at a perforation wants it far less, and may remember a fold. `crease` is the load-bearing number: low, the landed paper flops over in flat panels and runs away across the floor instead of folding back; high, the perforations hold and the pile accordions. Do not read a single number off this — see the note below on tuning a pile by worst case.
  - **Folds stack instead of passing through**, via a spatial hash. Without self-collision the pile flattens into nothing.
  - **Drag is broadside-only** — resistance along the segment normal, not along its length. At `drag: 0` every unit paid out becomes a unit straight down (a rope); at `drag: 1` the tip sits about two thirds of that and the strip sways as it falls.
  
  The roll is a flywheel driven by angular *impulse*, so `inertia` buys the coast after a flick and nothing else: how much paper a given scroll pays out is the same whether the roll coasts for a moment or half a second.
  
  **The roll stays on its holder, and the pile holds its own height.** Three
  faults that only showed once the roll was run all the way down:
  
  - Paying out the last of the paper left nothing wound, so every node the roll
    was made of became free paper — the entire roll dropped off its holder and
    landed flat on top of its own pile. One wrap is now held back as a tube stub,
    which is not a workaround but what a real roll does: the inner end is glued
    to the cardboard. What is left on the holder is a cylinder at the core
    radius, the closest a single sheet of geometry gets to drawing a tube.
  - Self-collision ran once, after the constraint loop had finished — too late to
    matter in a heap, because separating two folds moves them off their rest
    lengths and with no iterations left to restore those the next substep pulled
    them straight back through each other. It is interleaved with the last few
    passes now: 217 interpenetrating pairs before, none after, and the heap keeps
    half again as much height.
  - Collision tested node against node, which cannot see two SEGMENTS crossing
    with all four endpoints comfortably apart — and that is exactly how it
    failed. Paper is thinner than the chain is finely cut (a layer gap of 0.027
    against a node spacing of 0.037), so a collision sphere on each node left
    gaps between the beads, another fold threaded straight through one, and once
    through, the point test pushed it out the far side instead of back. It read
    as a sheet edge buried inside another sheet. Collision now solves closest
    approach between SEGMENTS, which has no gaps to thread; the hash cell is
    sized to `segment + d` so a 3×3 neighbourhood is a complete search rather
    than a hopeful one. On a full pile fed irregularly: zero crossings, and
    nothing pressed closer than 0.8 of a sheet's thickness. It costs 0.83 ms a
    frame against 0.37, still about a twentieth of a 60fps budget.
  
  **The roll's tessellation is set by the roll, not the pile.** The same nodes
  that fold on the floor draw the spiral, and a wound turn is only as round as
  the nodes spanning it. Five to a panel is plenty to buckle with and nowhere
  near enough to wind with: it drew a full roll as a visible sixteen-sided
  polygon, and its innermost turn with four nodes at 85° a step — coarse enough
  that the chords cut clean through the wrap beneath and the spiral came apart
  into a sawtooth. A chord of length `s` on a circle of radius `r` dips `s²/8r`
  inside it, so a wrap is only safe while `r > s²/4t`; at the original spacing
  that threshold sat above the core, which is exactly where it broke. The chain
  is now cut sixteen to a panel, the spiral is floored at the radius it can
  actually be drawn at whatever a caller configures, and the preset's core is a
  real cardboard tube rather than a pinhole. Affordable because the chain is
  one-dimensional: 198 nodes, 0.13 ms a frame, under a hundredth of a 60fps
  budget.
  
  Bend stiffness and the broadside/along-length split are both measured over
  fixed physical spans now rather than per-node, so raising the tessellation for
  the roll's sake does not quietly turn every panel to cloth or change how much
  the air resists a fall.
  
  Two deliberate limits. The chain simulates two dimensions — it hangs in y, folds in z, and keeps its full width in x with no twist, which is what keeps self-collision a cheap 2D query. And the node count is fixed: nodes are never spawned, only reclassified between "wound on the roll" (placed analytically on the spiral) and "free", so the vertex buffer never resizes, rewind is the same code path run backwards, and paper leaving the roll inherits its tangential velocity for free.
  
  New `toilet-roll` preset puts it together at the scale the library is actually viewed at: twenty-three panels of paper, wound so the outer radius lands at 0.61 of the panel width against a real roll's 0.57, over about nine visible turns. Worth knowing that `tightness` does double duty — a layer gap IS the paper's thickness, so it also sets how far apart self-collision holds two folds: wind tighter for a neater roll and the pile gets flatter, looser for a fatter pile and the roll coarsens.
  
  **New `scene.turn`, and the preset needs it to be visible at all.** Degrees the
  whole composition is turned about its vertical axis, additive with the
  `rotation` prop rather than overriding it. Every camera in the library is fixed
  and head-on — `<Paper>` sits at `(0, 0.35, 2.4)` looking down -Z, and neither it
  nor the editor fits a camera to its content. That is right for a sheet, which is
  flat and faces you, and wrong for anything whose shape lives in DEPTH: the strip
  folds in z by construction, so `<Paper preset="toilet-roll" />` framed the roll
  end-on and the entire accordion edge-on, and rendered **a blank white column**.
  The preset now asks for 25°. A camera field would have been the other way to fix
  it and is worse — meaningless inside `<PaperField>` and `<PaperMesh>`, where the
  caller owns the camera and a dozen papers may share it. Turning the paper works
  everywhere, because it is a property of the paper.
  
  **The composition is centred in z as well as y, and the pile no longer walks out
  of the shot.** Two faults that the preset's own tests could not see:
  
  - `centreOffset` lifted the composition in y and nothing centred it in depth,
    but everything here is built around the DROP LINE — the z the paper leaves the
    roll at — which starts at 0 on a full roll and travels back to
    `core - outerRadius` as it empties. The pile builds around wherever that line
    has been, so the composition was offset by half its travel before a fold had
    landed. Centring that travel is a config constant, for the same reason the
    y lift is: derived live it would slide the whole scene backwards as the roll
    ran down, which reads far worse than sitting still slightly off centre.
  - The shipped physics numbers spread the landed paper across 4.2 panel-widths
    of floor at worst and threw it 1.37 units out in depth — it ran off the side
    of the frame and kept going. `crease`, `stiffness`, `drag` and `floor` were
    re-chosen together, and by WORST CASE: a pile is chaotic, and the same config
    fed a slightly different scroll ramp lands 2.0 panel-widths wide or 4.2, so a
    single trajectory is a sample and not a measurement. Scored over fifteen, the
    new set holds 3.1 panel-widths and 1.27 units while keeping the pile's full
    depth. Shortening the drop did most of it: a longer fall is more airtime for
    the strip to pick a direction and glide, and it landed still travelling.
  
  Both preset tests were rewritten, because neither could fail on any of the
  above: the framing test asserted on y and never looked at x or z, and "piles
  there" wanted a height of 0.02 against a layer gap of 0.027 — one sheet lying
  flat cleared it, so paper that spread across four panel-widths without ever
  folding passed. They now run nine trajectories each and bound the spread.
  
  **New `maxStripLength(perforation)` export, and the editor controls that
  needed it.** `stripNodeCount` is capped, and the cap does not fail loudly: past
  it the node count stops growing, `segment` grows instead, every per-node
  constant quietly changes meaning, and the roll comes apart into a starburst. A
  length control has no other way to know where that is, so the derivation is
  exported from where the constants live.
  
  It was needed because the editor's `height` slider ran `0.2–4` while three
  presets shipped taller — `paper-roll` at 5, `paper-ribbon` at 6.4 and
  `toilet-roll` at 14. Both edit paths clamp to the range, so the slider was not
  merely mis-drawn: **the first touch collapsed a 14-unit roll to 4.** The ceiling
  is now the strip's real limit where there is a strip (16.4 at the toilet roll's
  spacing, itself clamped to the schema's own max of 20), 8 otherwise, and never
  below the value being shown — a control whose range cannot contain its own value
  destroys data, and a test now checks that against every built-in preset.
  
  `scene.turn` gets a row of its own, and the transport's status line no longer
  calls a strip "Cloth simulation": it read `typeof physics === 'object'`, which
  only ever meant cloth by having no rival, and it now names the gesture that
  actually drives a roll.
  
  One limit worth stating: `turn` swaps the pile's depth for width, and width is
  the axis a fixed camera has least of. At the measured worst-case depth the
  budget runs out at 28°, which is why the preset asks for 25 rather than more.
  A parent narrower than square still crops the pile's far edge — the honest limit
  of a fixed camera, and the caller's answer is their own `rotation` prop.
  Winding tighter would tidy the fine sawtooth on the roll's rim (the end face is
  concentric rings with real gaps between them, so off head-on you see between
  them), but it was tried and it throws the pile well outside the frame; framing
  beats the rim, and the sawtooth is what a roll wound from one zero-thickness
  ribbon costs.
  
  **Also fixed, and it would have bitten cloth eventually:** `PaperMesh` keyed its geometry and simulation off `JSON.stringify(config.physics)`. A simulation's config is live — `strip.scroll` is rewritten every frame by the host — so that key moved every frame, re-ran the segment probe, handed the geometry memo fresh array identities, rebuilt the geometry, and through it rebuilt the sim, throwing away everything it had integrated. A scroll-driven roll stayed pinned to its opening tail forever, sixty times a second. The key now carries only what the shape path can actually use: whether a simulation is present, and which one.
  
  The `media.html` dev harness gains `?grab=1` (to drive a real pointer gesture headless) and `?scroll=` (ramped over `?feed=` seconds), because `progress` cannot photograph a sim that has no progress param — only a scroll position it differentiates.
- b6b7502: Fix the roll geometry: paper no longer passes through itself, and a roll now shrinks as it pays out.
  
  `roll` derived its circle's centre from the current radius, so every wrap was tangent to the sheet at the same point — a rosette of circles through one point rather than a spiral. The sheet intersected itself once per revolution, and because the error cancelled exactly at multiples of 2π it was invisible to both the golden vectors and the GPU parity gate. The centre is now fixed and only the radius varies, so the wraps are concentric and sit exactly one layer apart.
  
  The winding also runs the correct way round. Paper is dispensed off the outside of a roll, so the end you are holding has to be the outermost layer and the far end has to sit at the core; it used to be the other way round. Arc length is now preserved all the way in, not just on the first turn.
  
  **Breaking:** the `roll` deformer's `spiral` option (radius growth per radian) is replaced by `thickness` (the gap between consecutive wraps, in world units). `spiral` could not express a real roll and did nothing at all at whole turns. Serialized `.paper` configs that set `roll.spiral` need the key renamed; the value is a layer gap now, not a growth rate, so re-tune it by eye.
  
  `unroll` gains five options and its radius is now derived from how much paper is left rather than being a constant, so the roll visibly runs down toward its core:
  
  - `from` — `'bottom'` for a receipt feeding down, `'top'` for paper hanging below the roll.
  - `core` — the tube the paper is wound onto. A third of the full radius is a real cardboard tube, and keeps the roll looking like a roll after it has been used down.
  - `tail` — paper already hanging at `progress` 0. A roll on a holder always has a leaf out; starting from a bare cylinder reads as a roll still in its wrapper.
  - `fixed` — hold the roll still in space and let the paper travel, rather than the other way round.
  - `floor` — how far below the roll the paper lands. Paper that reaches the ground creases and runs out flat instead of hanging into the void, reusing the right-angle hinge `ribbon` already lands a strip with.
  
  New `paper-roll` preset puts all five together: bind `progress` to scroll and pay a roll out until it is a bare tube.
  
  The `media.html` dev harness gains `?look=x,y,z` so its camera can be aimed. Without it the camera only ever looked down -Z, which cannot photograph anything lying flat — pooled paper is edge-on to a level camera.
- c68832a: Move to zod 4.
  
  `zod` is a runtime dependency of this package and its schemas are part of the
  public API — `paperConfigSchema`, `sceneSchema`, `paperStatesSchema` and
  `stageSchema` are all exported — so the major version is part of what Paperlab
  promises. Anyone composing those schemas into their own zod 3 tree will need
  to move too. Calling `.parse()` on them is unchanged in what it returns and what
  it accepts — but zod 4 reshaped the error it throws, so anyone READING a
  `ZodError` off these schemas rather than just letting it throw has a change to
  make.
  
  The `.paper` file format does NOT change. Every built-in preset, every stage
  preset and the empty-object case for all four exported schemas were parsed
  under both versions and diffed: byte-identical, 1095 lines.
  
  That check was the point rather than a formality. zod 4 redefines `.default()`
  to short-circuit — it hands back the literal value instead of parsing it — so
  the sixteen `schema.default({})` calls that fill in nested defaults would have
  silently started producing `{}`. They are `.prefault({})` now, which is the
  old behaviour under its new name, and nothing about that is visible to a
  typecheck.

### Patch Changes

- 06ff0ad: A cloth sheet no longer snaps flat when it is resized.
  
  `sheet.width` and `sheet.height` are a geometry dependency: changing them builds a new mesh, and with it a new `ClothSim`. A new sim starts flat — so a sheet that had spent a second falling into a drape lost all of it the instant anyone touched the size, and came back rigid. Nothing about the physics required that. Nobody had carried the state over.
  
  `ClothSim.adopt(previous)` does now, and `PaperMesh` calls it on every rebuild. The free particles are copied across scaled by how much the sheet grew, and their previous positions with them — velocity in a verlet integrator is the gap between the two, so carrying only the positions would have arrived at the new size perfectly still. The constraints are laid out afresh at the new dimensions, which is what makes the scaling exact rather than approximate: scaling the drape by the same ratio the rest lengths grew by leaves every constraint precisely as violated as it was, and the sim simply continues.
  
  Pinned particles are the exception and keep the new layout's own positions. A pin holds a CORNER, and the corner of a resized sheet is where the resized sheet says it is; carrying the old one over would hang the new sheet from a point no longer on it.
  
  It refuses in exactly one case: **a different grid.** The cloth grid is derived from the sheet's aspect, so a uniform resize keeps it and a lopsided one may not; with a different particle count there is no correspondence between the two sets of particles, and the nearest thing to one would be a guess. Everything else carries — a resize, a change of `pins`, a deformer arriving on top. The sheet's state belongs to the sheet, and none of those is a reason for it to have never fallen.
  
  What this buys is a sheet that can be resized *while it hangs* — including, in `apps/editor`'s hands harness, by spreading two hands in front of a webcam. Resizing as a SHAPE was always free, because a deformer is a pure function of its options and the sheet just redraws at the new size; this closes the gap between the two modes.

## 0.5.2

### Patch Changes

- a16379c: Stage mode's source no longer speckles green in Safari. The glow plane faded
  through its alpha channel, and a 2D canvas stores premultiplied pixels — so
  uploading it un-premultiplied made the browser divide the colour back out,
  which along the near-transparent tail amplified 8-bit rounding into off-hue
  texels. WebKit's rounding made those visible as a drift of green dots across
  the far wall. The falloff is now premultiplied into the colour on an opaque
  texture and added to the room, which is also the more honest model of a light.

## 0.5.1

### Patch Changes

- 9eab598: Stop the generated scroll component shipping a comment about a figure that is
  not in the scene.

  The stage brief's figure claims were gated on `showFigure`, but the comment
  baked into the generated component source was not — so a scroll export planted
  `// Scroll the section, walk the figure.` in the receiver's own file whether or
  not one was drawn. `showFigure` is off by default and every built-in stage
  preset leaves it there. It now names the camera when nobody is walking.

- 0adc36b: Stop the stage agent brief promising a figure that is not there.

  `showFigure` defaults to false and every built-in stage preset leaves it
  there, so the common export is a camera moving through an empty hall.
  `describeStage` already knew that and withheld the "a small dark figure
  walking between them" clause — but the payload's opening sentence claimed
  "with a figure walking through it" unconditionally, and the scroll clause was
  gated on `scroll` rather than on the figure, so it promised "scrolling the
  page walks the figure deeper into it" as well. Both now follow the figure, and
  the scroll clause names the camera when there is nobody to walk.

  This matters because the brief's description is the acceptance test a
  receiving agent checks the render against: a figure named there is a figure it
  goes looking for, and the library ships no assets — a figure is always the
  caller's own model on the caller's own URL.

- 0adc36b: Hand the WebGL context back when a canvas unmounts.

  A browser allows a page about sixteen live WebGL contexts and then starts
  killing the oldest. React Three Fiber disposes the renderer's own resources on
  unmount, but the drawing context itself survives until the garbage collector
  reaches the canvas — so anything that mounts and unmounts paper as it scrolls
  exhausts the ceiling with contexts belonging to sheets that are no longer on
  screen. `<Paper>`, `<PaperField>` and `<PaperStage>` now release the context
  explicitly. Measured on the reference page: one scroll to the bottom went from
  101 "Too many active WebGL contexts" warnings to none, at an unchanged peak of
  thirteen simultaneous canvases.

## 0.5.0

### Minor Changes

- 309ec56: Mark every colour field with `.describe('color')`, and publish `sceneSchema`.

  A colour is a string the way a date is a string, and a schema-driven panel had
  no way to tell the difference — so twelve colour fields across content, wash,
  light and the stage rendered as text boxes you had to type hex into. The schema
  now says which strings are pigments, rather than asking every consumer to guess
  from field names: `color` and `secondary` are both colours, `font` and `text`
  are both not, and no rule over names separates them.

  `sceneSchema` becomes public because `<PaperField>` now takes one.

- 15fd6c1: Publish `contentNames` and `contentSchemaFor`, so content can be edited the way
  everything else already is.

  Behaviors, layouts and the stage all hand their editor UI to a caller by
  publishing a zod schema and letting it be walked. Content could not: the union
  was internal, so the only way to build a panel for a `receipt` was to write one
  by hand and keep it in step with the schema — which is exactly what the editor
  did, for two of the five types, until `card`, `receipt` and `blank` each opened
  onto an empty folder.

  `contentNames` is read off the union rather than written beside it, because the
  sibling name lists here (`stockNames`, `physicsNames`) are the SOURCE their
  schema is built from and this one is not — a hand-written copy would be free to
  drift the day a sixth content type lands. `contentSchemaFor` answers which
  member carries which discriminator, which is the union's own fact to state
  rather than a walk's to rediscover.

- 309ec56: Light overrides reach a single sheet and a field, not just a stage.

  `scene.light` joins `scene.lighting`, so a `<Paper>` can be "studio, but the
  key is lower and the room is dimmer" — the authorable half that stage mode has
  always had. `<PaperLighting>` has accepted these overrides all along; nothing
  was passing them, and a lone sheet could only ever be one of seven rigs exactly
  as shipped.

  `lightSchema` moves from `scene/lighting.ts` into `config/schema.ts`, where the
  rest of the serialized config lives. It has to: `sceneSchema` needs it, and
  `lighting.ts` imports FROM the schema, so the dependency could not run the
  other way. It is re-exported from its old home, where a caller reaching for the
  overrides beside `resolveLighting` will still find it.

  `<PaperField>` takes a `scene` too, and lights itself with `<PaperLighting>`
  rather than the bare ambient-and-directional pair it had. **This changes how an
  existing `<PaperField>` looks** — and it changes it to what the editor has been
  showing all along, which is the point: the gallery you composed and the gallery
  the exported code produced were lit by two different rigs, and the export was
  the one nobody had looked at.

  `diffFieldProps` also now compares structurally rather than by reference. No
  object or array copied from a default is ever reference-equal to it, so a
  layout option holding an array exported a prop that said exactly what the
  default already said.

- 3cd3bb2: Watercolour washes: `washSchema`, a `wash` field on every content type, and a
  `washed-letter` preset that shows what it is for.

  A wash is a FIELD rather than a sixth member of the content union, and that is
  the whole design. It is a ground, not a subject — the thing people want is a
  letter written over one, a card laid on one, a poster with one behind the type.
  Made a content type it would have been mutually exclusive with the text it
  exists to sit behind, and the only way to get both would have been to bake the
  words into an uploaded picture, which is exactly the trick this library exists
  to avoid. It applies to the back of the sheet on the same terms.

  Painted rather than shipped as artwork, for the reason `DEMO_CARDS` are typeset
  rather than photographed. A bitmap is ~100KB that cannot cross a share link,
  does not survive an export into someone else's codebase, and does not know what
  stock it is lying on. A wash described in nine numbers travels anywhere the
  config does, tints against the paper under it, and curls with the mesh because
  it IS the texture rather than a picture composited over one.

  Four things separate watercolour from a soft gradient, and the painter does all
  four: edge darkening that follows each pool's own irregular outline and varies
  in weight around it, wet edges from three harmonics on a radius, `multiply`
  glazing so two washes crossing are a third hue, and granulation confined to
  where there is pigment. Seeded, so a preset paints the same wash forever.

- 23d8bb4: Publish `stageBanner`, and carry a stage's pictures through its export.

  `<PaperStageScene>` has accepted an `images` array all along, but
  `StageExportInput` had no way to say so — a stage built out of pictures
  exported as a stage of blank banners, silently. `images` now travels, and
  `exportableImages` decides how.

  An uploaded picture lives as a data URL, and pasting a hundred kilobytes of
  base64 into a source file is not an export. So an upload becomes a placeholder
  path — the right number of them, in the right order — and the snippet says
  that is what happened. A referenced URL is already something the receiver can
  fetch, so it travels verbatim and gets no apology. Emitting nothing was the
  other option and it is the worst one: the reader gets blank banners and no clue
  that the pictures were the point.

  `stageBanner` is the sheet a stage hangs when the caller does not name one. It
  is exported because it is the base anyone RESHAPING a banner has to start from
  — a wider drop wants this stock, this grain and this drape at different
  dimensions, and rebuilding from the schema defaults instead gives a sheet of
  printer paper with no fold in it. A second copy of those numbers in a caller is
  a copy free to drift from the one the scene actually falls back to.

- 309ec56: Backdrops: `scene.backdrop`, and `<PaperBackdrop>` to render one.

  A colour and a picture behind the sheet, with `fade` and `blur` so the
  backdrop stays a backdrop — a photograph at full strength competes with the
  paper in front of it, which is what a photographer solves by putting the
  background out of the light.

  Optional on purpose. An unset backdrop leaves the canvas exactly as it was
  found, because `<Paper>` has always rendered onto whatever is behind it and a
  default that painted the frame would change the look of every sheet already on
  a page.

  Painted onto a canvas at the viewport's size rather than assigned straight to
  `scene.background`: three stretches a background texture to the frame whatever
  shape it is, so a landscape photograph behind a 9:16 export would come out
  squashed — and the export sizes are exactly where a backdrop earns its keep.

  `<Paper>` and `<PaperField>` render it. `<PaperMesh>` deliberately does not —
  it drops into someone else's scene, and a sheet that repainted the background
  of the app it is embedded in would be doing something nobody asked for.
  Callers who own their own canvas render `<PaperBackdrop>` themselves.

### Patch Changes

- 8ace6ea: Mark the interactive drag handle as chrome, so a renderer producing a picture
  can leave it out.

  The handle is drawn with `depthTest: false` on purpose — it has to sit on top
  of the sheet to be grabbable where the sheet curls away. That also makes it the
  single most prominent thing in any frame captured off the canvas, which is how
  the editor's new image export came out with a blue dot in the middle of the
  receipt.

  `userData.paperlabChrome` says what the object IS — an editing affordance
  rather than part of the artwork — instead of asking every capture path to know
  this one mesh by sight. Nothing reads it unless it wants to; the flag is inert
  for every existing consumer.

- 8aa3029: Point the README and `homepage` at paperlab.nawwara.studio.

  The demo, editor, reference and every image in the npm README resolved through
  a URL containing the GitHub account name — `nourmtir0722.github.io` for links,
  `raw.githubusercontent.com/NourMtir0722` for images. A published README is
  frozen at its version forever, so renaming the account would have left every
  release already on npm pointing at a dead demo and showing broken images. The
  custom domain outlives the username.

- 309ec56: Fix `diffConfig` throwing away everything in a scene except `lighting`.

  It read `if (config.scene.lighting !== 'studio') out.scene = { lighting }`,
  which was true while `lighting` was the only thing a scene had — and silently
  discarded every field added beside it. So a hand-tuned light rig, and now a
  backdrop, were shown by the editor and carried by nothing that left it: not a
  `.paper` file, not a share link, not a JSX snippet or an agent payload.

  The scene is diffed like every other branch of the config now, and a test
  round-trips it: what the diff emits parses back to what went in.

  Code exports also stop pasting uploaded pictures into source. An upload is a
  data URL of a hundred kilobytes and up, and there are two places one can now
  be — the sheet's content and the backdrop behind it. A snippet gets a numbered
  path in the same position and a line saying so; a referenced URL is untouched.
  The `.paper` file and the share link still carry the real bytes, because a file
  has room for them and dropping them there would lose the artwork rather than
  reformat it.

## 0.4.0

### Minor Changes

- 0ecfe71: **Breaking: the public API is 83 names instead of 214.**

  Every exported name is a promise kept for years, and this library was exporting
  its own internals: shader builders (`buildFieldVertexShader`,
  `buildDisplacementGLSL`), texture painters (`barcodeBars`, `makeGoboTexture`,
  `silhouetteRects`), tessellation constants (`SHEET_LIFT`, `TRANSMISSION_GAIN`),
  the cloth integrator, the state machine class, and 36 individual behavior,
  deformer and layout functions that the registries already reach.

  None of that is API. It is the inside of the box, and shipping it means a
  refactor of a private helper becomes a breaking change for somebody. The
  surface is now what a caller genuinely needs: the four components, the schema
  and its types, the registries and their three `register*` hooks, presets and
  the `.paper` file format, the export helpers, lighting-as-data, interaction
  states, and the accessibility utilities.

  **Behaviors, deformers and layouts are reached through their registries.**
  `getBehavior('peel')`, `getDeformer('roll')` and `getLayout('ring')` return
  exactly what the removed named exports did, and `listBehaviors()`,
  `listDeformers()` and `listLayouts()` enumerate them. Nothing was deleted from
  the library — only from its front door.

  Three things that look internal are still exported, each with the reasoning
  written where it is exported: the GPU/CPU **parity harness**, because it is the
  only gate on the invariant the contribution ladder rests on; the **tessellation
  arithmetic**, because `registerDeformer` is public and a third-party deformer
  must answer the segment-count question the same way the built-in seven do; and
  **`wrapLines`**, because a caller measuring type before laying out a sheet has
  to get the same answer the painter will.

  `paperlab/stage` loses seven names the same way — a magic constant, four
  sub-schemas, and two export helpers — keeping the sixteen that `llms.txt`
  documents.

  This lands now, at 0.4.0, precisely because nobody has built on the old surface
  yet. Doing it later would cost real users a migration for no benefit to them.

## 0.3.1

### Patch Changes

- 7a04709: The npm page now shows the library that actually shipped.

  No code changes: the tarball's only difference is `README.md`, which npm serves
  as the package page and which had drifted badly from 0.3.0. It documented a peer
  floor of `three >= 0.160` where the package requires `>= 0.162`; it never once
  mentioned `<PaperMesh>`; it described deformers, content types and interaction
  states nowhere on the page; and every moving image on it predated both the
  current design language and the switch of demo content to paper artifacts, so
  the pictures were selling a product that no longer looked like that.

  It also linked to a planning document that has been removed from the repository,
  which on npm is a dead link with nothing behind it.

  The page now carries the catalogues rather than describing them — the six stage
  presets, twelve field layouts, eight lighting rigs and seven paper stocks, each
  photographed side by side, because a catalogue only means anything when you can
  compare its entries. Every asset is regenerated from the registries by
  `pnpm media`, `pnpm shot:catalogue` and `pnpm sheet`, so the page cannot
  silently drift from the library again.

## 0.3.0

### Minor Changes

- 3828a50: `segments: 'auto'` now subdivides the direction a deformer actually bends, and stops subdividing the one it does not.

  `segmentsForArc(spanAlong(sheet, angle), r)` has always meant "this many segments **along `angle`**". `resolveSegments` threw the direction away: it took the number, spread it over the sheet's long edge, and gave the short edge whatever was left. On a 1 × 1.4 page nobody could see that. On a banner it is the entire picture — the stage's 1.5 × 8.5 banner is draped in folds that run across its **width**, the arithmetic asks for 133 segments across, and what it got was 48 across and 48 down a drop that needs eight.

  A deformer now declares `geometry.axis(options, sheet)` beside its floor and its target, and the demand is projected onto the sheet's own axes by it — `width·|cos θ|·density` and `height·|sin θ|·density`, which is exact, because the demand was always a density along a direction rather than a count for a rectangle. `stackMinSegments` and `stackAutoSegments` return a pair now; `resolveSegments` and `createSheetGeometry` accept one. **A bare number still means what it always meant**, so an unchanged call to either exported helper answers exactly what it answered before. `crumple` returns `null` — its creases run every way at once — and keeps the aspect spread, which for it is the honest answer.

  Fewer triangles everywhere, and in the case that needed it, a better-looking sheet:

  | preset           | grid           | triangles      | chord error         |
  | ---------------- | -------------- | -------------- | ------------------- |
  | `receipt-unroll` | 49×128 → 8×128 | 12,544 → 2,048 | unchanged           |
  | `letter-fold`    | 91×128 → 8×128 | 23,296 → 2,048 | unchanged           |
  | `hanging-poster` | 91×128 → 24×96 | 23,296 → 4,608 | 2.8e-4 → 4.8e-4     |
  | `page-flip`      | 48×48 → 48×8   | 4,608 → 768    | unchanged           |
  | `photo-print`    | 16×16 → 16×8   | 512 → 256      | unchanged           |
  | the stage banner | 48×128 → 128×8 | 12,288 → 2,048 | **5.3e-3 → 7.7e-4** |

  The banner row is the one worth reading twice: six times fewer triangles **and seven times less faceting**, because the density finally lands on the axis that bends. Every hero preset and both stage presets were rendered before and after and are indistinguishable; the sagitta test now measures the grid a sheet actually gets rather than the arithmetic behind it.

  **`<PaperStage>`'s `quality` tier now reaches the geometry, which it never did.** The tier's `segments` was written straight over the sheet's `segments` as a number — and a number applies to both axes, field mode caps it at 48 on the way down, and `drape`'s floor of 48 raised it back on the way up. `low`, `medium` and `high` all drew the identical 48 × 48 banner, measured at 143,644 triangles a frame whatever the tier said. It is now a ceiling on what `'auto'` may ask for (`segmentCeiling` on `<PaperFieldMesh>`, a device knob that never serializes), so it can lower the grid and never raise it.

  **The hero re-deform loop is ~2.6× faster**, which is the other half of the same frame. At the 128 ceiling one `drape + wave` sheet cost 2.30 ms a frame, of which 1.44 ms was `BufferGeometry.computeVertexNormals()`. `computeSheetNormals` does the same arithmetic straight over the typed arrays and is **bit-identical** to three's answer — asserted as exact equality, not a tolerance — at about an eighth of the cost. The loop itself now runs one deformer over every vertex instead of every deformer over one vertex, putting a single function behind the inner call site instead of a registry lookup and a megamorphic call per vertex per deformer. A resting sheet also stops expanding its whole deformer stack sixty times a second to discover it has nothing to do.

  | grid |  verts |     was |     now |
  | ---: | -----: | ------: | ------: |
  |   72 |  3,796 | 0.74 ms | 0.27 ms |
  |  128 | 11,868 | 2.30 ms | 0.84 ms |
  |  192 | 26,634 | 5.01 ms | 1.89 ms |
  |  256 | 47,288 | 8.74 ms | 3.38 ms |

  End to end on a stage (`pnpm perf`): `medium` 65.8 ms → 51.0 ms (15 → 20 fps), `low` 36.2 ms → 26.1 ms (28 → 38 fps), `archive` at 44 banners 34.4 ms → 26.0 ms. `high` moves least, because its ceiling keeps 72 across the folds and its frame is dominated by the contact-shadow pass and dpr 2.

  **And the ceilings came up, because the axis split made them cheap.** No shipped preset reaches even 128 after the change, so `AUTO_CEILING` had stopped binding anything the library hands out — it only bound people asking for a tighter crease than any preset uses. Since a demand now lands on one axis, satisfying those costs ~0.02 ms rather than the 1.89 ms a square grid implies.

  |                              | was | now     | who feels it                                                                                                                                 |
  | ---------------------------- | --- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
  | `AUTO_CEILING` (hero)        | 128 | **192** | hand-authored tight creases — `drape` at its defaults (154), `roll`/`fold` at `radius: 0.02` (175), `curl` at 0.02 (142). No preset changes. |
  | `FIELD_AUTO_CEILING`         | 72  | **128** | only a field with no `segmentCeiling`; the quality tiers cap themselves lower.                                                               |
  | `qualityTiers.high.segments` | 72  | **128** | the stage's folds, on machines that measured fast enough to earn them.                                                                       |

  The third is the visible one: a banner's drape asks 133 across and had been getting 72, so at `high` the fold highlights now roll instead of stepping (sagitta 2e-3 → 7.7e-4). `medium` and `low` are untouched and measure identically to before; explicit `high` costs more on weak hardware and no machine that cannot hold it is ever promoted to it.

  **The ladder could pump, and now cannot.** Promotion needs 55 fps and demotion fires under 26, so any machine where the next tier costs more than ~2.1× the current one satisfies both forever — and raising `high` is what put it at exactly that ratio on a software rasterizer. `auto`'s policy is now a pure `settleTier(tier, fps, failed)`, and a tier that has once failed is never offered again: the ladder tries the top once and settles. Still capped, and still said out loud: `wave` at `amplitude: 0.3` wants 272 and a 16-fold `drape` at full depth wants 1377; `segments: <number>` is the way past.

  Those stage numbers are a **software-rasterizer floor**, not frame rates. `pnpm perf` used to print `renderer: native GPU` whenever `--soft` was absent, which was the launch flag it had been handed rather than the driver that answered; asked properly, headless Chromium draws all of it through ANGLE/SwiftShader either way. Both harnesses now report what actually drew the frame, and both take **`--gpu`**, which gets the real platform renderer headless. On an M4 Pro the stage holds 120 fps at every tier — 120 banners at 16 megapixels included — so these numbers are the floor and not the ceiling.

- 8ac1790: The stage is a room now, and there is nobody in it.

  ### `stage.room` and `ground.slab`

  A ceiling, and seams in the floor. Together they are the scale of the hall.

  Stage mode was a void with a horizon — a graded dome, a flat plane, and a bright rectangle at the end, and **not one thing in it was a knowable size**. That is the real reason the walking figure existed, and it is why removing the figure on its own would have left an abstraction rather than a room.

  Architecture answers it better, for a reason worth stating plainly: a concrete floor is poured in bays of about two and a half metres and a ceiling sits about three above your head, and a viewer knows both of those without being told. They are also flat surfaces under good light — the one thing a renderer never gets wrong — where a human mesh is the one thing it always does.

  The ceiling earns its place twice. It gives the haze a far surface to **end** on, which is why the top of frame used to grade away to nothing; and it puts a horizontal plane above the walk for the source to spill onto, which is how every reference installation reads as interior — you can see the light landing on the ceiling.

  The floor was `#0e0b09`, which is dark enough to disappear, and a floor that disappears cannot show the seams that are the entire point of it. Lifted to `#241e19`: the hall keeps its contrast against the source and gains a surface you can read the size of the room from.

  ### `showFigure` defaults to `false`

  The figure was doing a real job and the instinct behind it was right. The instrument was wrong.

  The deciding argument is not that the model looked cheap — it is that **the stage is navigable**. Drag, wheel, arrow-step, click the banner you want to stand in front of: there is already a person in that hall, and it is the viewer. A second one walking the same aisle on its own clock competes for the role, and the viewer cannot tell whether they are the camera or the character. Every installation this mode is modelled on answers that question the same way: you are the one walking.

  Still one flag away for anyone who wants it, and the walk system, the gait and the camera binding are untouched — none of that ever needed a visible body.

  **`describeStage` gained a fix from this.** The camera was named inside the figure's own clause, so turning the figure off silently took the _shot_ out of the description too — and the shot is what the reader is actually looking through. It is named unconditionally now, the room is described, and no figure is claimed when none is drawn. A brief that promises a walking person the render does not contain is worse than a terse one.

  ### One room with a colour in it

  `threshold` — a few enormous sheets, wide enough apart to walk between — is now terracotta.

  Every stage in the set was a warm neutral corridor, and white paper against warm neutral is white paper against nothing: the sheets and the room sit at the same temperature and the picture flattens. Against a saturated ground the paper sings, which is why the installations worth copying are shot in rooms painted terracotta and washed with gels rather than in white boxes. `source.color`, `source.zenith` and `ground.color` are the same three stops that build the environment map, so the light bouncing onto the sheets is the room's own colour and cannot disagree with the walls in shot.

  ### Smaller

  The docs app was shipping a 1.5 MB copy of the walking-figure glTF that nothing in it referenced. Removed; the editor and playground copies stay, because those two do reach it when the figure is switched on.

- 54aee8b: **Stage mode is navigable.** It was a picture you watched; now you can walk it.

  The whole mode had one input — `progress` — and if nobody supplied one the walk ran on a clock. There was nothing to touch: no drag, no wheel, no keyboard, no way to stop in front of a banner and read it. Field mode has had `motion={{ driver }}` since it shipped, and the stage — the mode most likely to be somebody's entire homepage — had nothing.

  ```tsx
  <PaperStage motion={{ driver: "drag", speed: 1, capture: true }} /> // the default
  ```

  Same contract as a field's, and the same three driver names. `drag` is the viewer: pointer drag with inertia, wheel, arrow keys, PageUp/PageDown, Home/End, or a click on the paper you want to stand in front of. `autoplay` is the clock and only the clock. `none` is nobody.

  **It drifts until you touch it.** `drag` walks on its own until the first pointer, wheel or key, and is yours for good from then on. That is deliberately one behaviour rather than two drivers, because the alternatives are each half wrong: a stage that only autoplays cannot be touched, and one that only waits opens as a still photograph of itself.

  **Steps land on a paper, not near one.** `Layout.walkStops(n, options)` is a new optional member — only a layout that arranges along a path can answer it — and `colonnade` computes it from the same helper `pose` places banners with, so a stop cannot drift off its banner. Layouts that arrange around an origin simply decline, and stepping falls back to an even spread.

  **`capture`** (default true) is whether the walk takes the wheel and touch away from the page. True for a stage that fills the screen — it _is_ the page. False for one sitting in a column of prose, where capturing them eats a reader's scroll on the way past and traps a finger on a phone; mouse drag and arrow keys still work. Even when captured, the wheel is handed back at the ends of an open walk rather than pressing silently into a wall.

  Supplying `progress` still outranks all of it: a stage bound to page scroll is a controlled component, and a driver writing the same number the page is writing is a fight, not a feature.

  Two supporting additions. `<PaperStage onProgress={walk => …} />` reports the live position every frame it changes, whoever is driving — mirror it into an uncontrolled input for a scrubber that follows the walk with no re-renders, exactly as `<PaperMesh>`'s `onProgress` does for a behavior. And `<PaperFieldMesh onSelect={paper => …} />` fires with a paper's index when it is clicked; supplying a handler is what makes the papers raycastable at all, which matters because hit-testing an instanced mesh is per-instance work on every pointer move.

  Fixed while wiring it: autoplay used to extrapolate straight past the end of an open walk and keep going for as long as the tab was open — a camera stationed in the dark past the last banner. It wraps. The playground had been running its own clock and its own `% 1` specifically to avoid that, and no longer needs either.

  **`pnpm test:drive` is new and is in CI.** The navigation is pointer capture, wheel handlers and key handlers against a live canvas, and no unit test can see any of it; the math has unit tests, and this drives a real browser through drift, drag, flick, wheel, arrow keys, a click, and a controlled stage refusing all of it. It paid for itself on the first run by catching `raycast={undefined}` — which does not mean "leave the default", it assigns undefined over the method three is about to call, and silently disabled every click.

- e00a307: `segments: 'auto'` now sizes the grid from the active deformers, which is what the schema always claimed it did.

  It did not. It gave the long side a flat 72 whatever was on the sheet, and a deformer's `minSegments` was only ever a floor — so nothing could raise a grid that already started at the highest number anyone asked for, and nothing ever lowered it. A blank sheet was tessellated exactly as finely as a crumpled one, and `crumple`'s `minSegments: 72` was a no-op except against a hand-picked coarser grid.

  **The distinction the fix rests on:** `minSegments` is a correctness floor — the density below which a deformer stops working. What `'auto'` needed is a quality target, and a target has to depend on the options, because a bend at `curvature: 0.05` and a roll at `radius: 0.02` are not remotely the same request and one constant per deformer cannot answer for both. So deformers now declare `geometry.autoSegments(options, sheet)` alongside their floor, and six of the seven derive it from the same place: a mesh is a piecewise-linear stand-in for a curved surface, the error is the sagitta `h²/8r`, and inverting that turns "how many segments?" into arithmetic on the radius the options imply.

  The tolerance is calibrated rather than picked. At the old flat 72 the default `roll` already ran at a sagitta of 3.9e-4, so that is the tolerance — the tightest configuration in common use keeps exactly the density it ships with, and everything gentler stops paying for precision it was not using.

  **This subdivides both ways.** A blank sheet drops to 8 a side; a tight fold rises to 128, which the flat 72 could never give it however much the crease needed. Per preset, in hero mode:

  | preset                                           | before      | after          |
  | ------------------------------------------------ | ----------- | -------------- |
  | `typed-note`, `blank-sheet` (no deformer)        | 7,344 tris  | 96 (−99%)      |
  | `photo-print` (the field starter, a gentle bend) | 7,776       | 512 (−93%)     |
  | `page-flip`                                      | 7,344       | 4,608 (−37%)   |
  | `postage-stamp`                                  | 8,496       | 6,784 (−20%)   |
  | `vintage-note`, `crumpled-note`                  | —           | unchanged      |
  | `hero-peel`, `flying-note`, `receipt-unroll`     | 6,912–7,200 | +78–81%        |
  | `letter-fold`, `hanging-poster`                  | 7,344       | 23,296 (+217%) |

  Across all presets that is +24% triangles: the library trades geometry away from sheets that were not using it and spends it on creases that were short of it. If the presets that went up are not worth their cost to you, the ceiling is one constant in `core/tessellation.ts`.

  The ceiling is 128, and it is a measured CPU budget rather than a round number. Hero mode re-deforms every vertex in JS on the main thread every frame for any animated stack, and `wave` is animated, so a hanging poster pays it permanently rather than only while something plays. One sheet, one re-deform of `drape + wave`: 0.67 ms at 72, 2.05 ms at 128, 4.53 ms at 192, 7.89 ms at 256. 256 is half a 60 fps frame on one sheet on a fast machine; 128 is the last step that leaves room for a scene around it.

  In a field (`pnpm perf:field --soft`): `typed-note` goes from 98.3 ms to 23.5 ms a frame at ×20, and 261.5 ms to 37.8 ms at ×60 — 4 fps to 26, at 1.3% of the triangles. `crumpled-note` is unchanged to the triangle, deliberately (below).

  **Two things worth knowing before relying on this.**

  `crumple` is the one deformer that gets no `autoSegments`, and that is the honest answer rather than an omission: every other deformer approximates a smooth surface, so its density falls out of a radius, but a crumple's creases are exactly where the gradient is meant to break and there is no sagitta to bound. What it wants is segments per cell, which at the default `scale: 3` is the 72 its floor already asks for.

  A field is capped separately and lower, at the old flat 72, because it draws that buffer once per instance — the hero ceiling of 128 would be paid sixty times over. `FIELD_SEGMENT_CAP` keeps its original and only job of capping the FLOOR a stack may demand; it explicitly does not cap the target. Capping both looked tidy and was a visual regression, because it is the one thing that could hold `crumple` — which has no target, only a floor of 72 — down to 48 in a field, coarser than the deformer says it needs to read as a crumple at all. Field geometry is therefore unchanged to the triangle from before this release.

  Also: the grid is built once, but a behavior's stack is not the same shape throughout — an unroll is a tight roll at one end of its progress and a flat sheet at the other. Sizing to the configured moment would leave the sheet under-tessellated for the rest of the play, so both the hero and field paths sample the behavior's progress across 0→1 and keep the densest answer. That sampling assumes every behavior's `progressParam` runs 0..1, which is true of all ten and is now pinned by a test, because it fails silently otherwise.

  `core/tessellation.test.ts` measures the sagitta directly rather than trusting the arithmetic: for every edge of the resolved grid it compares the deformed chord midpoint against the deformer's own answer there, across each deformer's real option range. It also asserts the measure has teeth by forcing a tight bend onto the coarsest grid the ladder allows and requiring it to fail.

  Two configurations still do not meet the tolerance and are honest about it: `wave` at `amplitude: 0.3` asks for 272 segments and `drape` at its default depth asks for 154, against a ceiling of 128. They pass the suite on a "no worse than the flat 72 this replaced" clause, which documents a real remaining gap rather than creating slack — closing it costs more CPU per frame than the budget above allows.

- c4899e7: Behaviors nominate the params that matter, and a paper can say where its handle is.

  Two additions, both for tools built on top of the library.

  **`Behavior.signature`** names the two or three options that ARE a behavior — the ones someone reaches for first, in the order they'd reach for them. Editors give those the loud controls and fold the rest away; the schema still generates a control for every option, so nothing is removed, only ranked. All twelve built-ins nominate one (`peel` → progress, corner; `flight` → gustiness, tumble, path, which puts its three-slider wind vector one disclosure away instead of first). It is **optional and its absence means "show everything"** — the library never hides a param it was not told to hide, because silence from a community behavior is not permission to guess.

  **`PaperHandle.handlePoint(id?, target?)`** returns a behavior's grab point in world space, or null when the behavior has no handles. The handle rides the deformed surface, so its position is a fact about the frame, not about the config — nothing outside the render can derive it from a UV, which is why anything that wants to point at the handle (a coach-mark, a tooltip, an arrow) had no way to. Pass `target` and it writes in place, so a per-frame reader does not allocate.

- 55253bc: The room gets architecture that stands in it, and paper gets more than one way to hang.

  **`stage.room.columns`** — square piers with a base plate and a capital, down both sides of the walk, spaced by arc length so a bend or a spiral gets even bays. Three instanced meshes, so length is free. A ceiling and floor seams are _boundaries_: they say where the room stops, not how big it is. A base plate is the only element in a scene that puts a hard horizontal edge at a known height off the floor, which is what makes a floor read as a floor — and it is the reading the walking figure was retired for giving. Off by default; `nave` turns it on. Columns stand outside the paper and are darker than it on purpose: the light is the brightest thing in these frames and the paper is second.

  **`stage.room.doorway`** — a wall at the end of the walk with the source shining through an opening in it. Without it the source is a bright rectangle in a void: it reads as light, but not as light coming from anywhere. It also gives the room the corner it never had. Off by default; `threshold` turns it on.

  **`stage.suspension` now names the hardware properly.** `type` is what carries the load — `'thread'` (one line per sheet), the new `'rod'` (a dowel across the sheet's top edge, hung at both ends so it cannot tip), or `'none'`. `hardware` is what grips the sheet — `'clip'` (wide and shallow, across the edge), the new `'peg'` (narrow and deep, down the face), or `'none'`. Hardware also scales with the sheet it holds now, which it did not.

  **Breaking:** `suspension.clips: boolean` is replaced by `suspension.hardware: 'none' | 'clip' | 'peg'`. `clips: true` becomes `hardware: 'clip'`, which is the default, so a stage that never mentioned it is unchanged. A boolean was the reason two of the four pieces of hardware the plan named had no way to be asked for.

- e0b4e0f: The stage figure walks like a body now, and can be somebody else's rig.

  It had thighs, knees, arms, a bob and a lean, and that was the whole gait. What it did not have is the thing you actually recognise a human walk by: **the pelvis and the chest turning against each other.** A walk without that counter-rotation reads as a shamble however good the legs are.

  So the gait grew the terms that were missing, all of them driven by distance walked exactly as the old ones were:

  - **Pelvis rotation**, carrying the swing-side hip forward — which is how a step gets longer than the leg is.
  - **Chest counter-rotation** against it, cancelling most of that angular momentum so the head travels straight. Given as an absolute rotation against the direction of travel rather than relative to the pelvis, so "these two oppose" is legible in the data and testable; the renderer applies the difference.
  - **Lateral sway**, the trunk leaning over whichever foot is carrying the weight, twice per stride.
  - **Pelvic obliquity**, the unweighted hip dropping away as it swings.
  - **Elbows.** The arm was one capsule from shoulder to wrist; it is now an upper arm and a forearm with a joint between them, carrying a standing bend that tightens as the arm drives forward.

  **And running, which is not a fast walk.** `figure.gait` is `'auto' | 'walk' | 'run'`, and `'auto'` decides with the Froude number — `v²/gL` against leg length, past ≈0.5 — so the transition sits where a real one does and _moves with the figure's size_: a shorter figure breaks into a run at a speed a taller one still walks. A run swings further, folds the knee toward the seat, holds the elbows near a right angle, leans harder, and covers more ground per step.

  The tell is the bounce, and it inverts. A walk vaults over a straight stance leg, so it is highest at midstance and never rises above standing height. A run's leg is a spring that compresses under the body at midstance and throws it clear of the ground in between — so the same curve turns upside down and crosses zero. `bob` may now be positive, which it never was before, and only ever in a run.

  **`figure.model` takes a rigged glTF/GLB.** The asset is not part of the library and never ships in the npm tarball — it is a URL the app hosts. What the library contributes is the part that is actually hard: **the clip is scrubbed by distance walked, not played on a mixer clock.** Run a walk cycle on its own timeline and the feet skate the moment the figure's pace disagrees with the animator's, which a scroll-driven walk does constantly. One gait cycle maps onto one pass of the clip, and `stride` is the knob that syncs a particular asset.

  Around that: the clip is chosen by name so `Walk`, `walk_01` and `Armature|Running` all resolve (and it will take the other gait over nothing); the rig is scaled to `figure.height` off its own bounding box, so assets authored in centimetres and in metres both come out right against the paper; it is cloned through `SkeletonUtils` so two figures on one URL cannot drive each other's skeleton; and it is drawn as a silhouette like the capsules, because the nave is lit from behind and a shaded character dissolves into the haze it has to read against. Anything that fails — a 404, a file that is not a glTF, a rig with no clips — falls back to the capsule figure rather than emptying the stage, and says so in the console.

  **One invariant narrowed on purpose.** The gait used to promise "same ground covered = same pose, whatever pace put the figure there". It now promises that _within a gait_: crossing the walk/run threshold is a different gait with a different stride, so the pose at a given distance changes with it. The old wording was never quite true anyway — `lean` has always read `speed`. The test that pinned it now says which it means, and a second one pins that the rule still holds inside a run.

  Also fixed while wiring the trunk: the forward lean was applied to the hips, which tipped the legs along with it. A body leans from the waist, so it now applies to the trunk and the legs stay under it.

  **The rigged path is verified against a real asset, and doing that found a bug that would have hit every model.** The rig is scaled to `figure.height` off its own bounding box — but a freshly cloned scene has stale world matrices, so `Box3` measured the root's untransformed geometry, reported a model far smaller than it is, and produced a correspondingly enormous scale. On screen the figure filled the frame. It now calls `updateMatrixWorld` before measuring. No amount of reading the code was going to surface that; it took rendering it.

  Verified end to end against Khronos's `CesiumMan` — loads from a remote URL, scales correctly against the banners, silhouettes, casts its contact shadow, and changes pose with `progress`, which is the distance-scrubbing working. It also happens to exercise the awkward case on purpose: `CesiumMan` has exactly one, unnamed clip, so it runs through `pickClip`'s last fallback rather than any name match.

- 2fa9b6b: **Lighting is data now.** A preset names a starting point; `stage.light` moves it.

  Every other axis of this library is parametric — sheet, stock, surface, deformer stack, layout, walk, shot — and lighting was an enum of six strings. You could not place a light, warm one, or turn the room down. `light` is the missing half, in the terms a person would actually say them in:

  ```tsx
  <PaperStage
    stage={{
      lighting: "nave",
      light: {
        exposure: 0.9,
        key: 3.2,
        direction: 180,
        height: 24,
        ambient: 0.03,
        studio: 0.6,
        haze: 1.2,
      },
    }}
  />
  ```

  `direction` and `height` are **degrees around the room and degrees above the horizon**, not a position vector, because "where is the light" is a question about the room rather than about the coordinate system. `lightAngles()` and `lightPosition()` are exported, pure, and exact inverses — which is what lets a slider read the resolved rig and write back a single field without drifting a millimetre per drag.

  Every field is optional, and that is load-bearing: an unset field means _whatever the preset says_, so a shared stage carries the two sliders you moved rather than a frozen copy of a rig you never touched, and re-basing onto another preset keeps your intent instead of your numbers.

  **`studio` is new light, not a new slider.** It is the room itself — the same three colours as the cyclorama, plus a soft disc of the key's own colour where the key stands — built procedurally into an equirectangular image and prefiltered through PMREM. No HDRI, nothing fetched, nothing added to the tarball. Flat `<ambientLight>` adds brightness with zero direction, which is the single biggest reason a surface reads flat; this is the same brightness with a shape. Every preset's `ambient` came down accordingly, and paper finally has something for its sheen to reflect.

  **And it uncovered a real bug.** `translucencyValues()` reads the key light's own position so a sheet's backlit glow can never disagree with the lamp casting its shadow — but it read it from _the paper's own_ `scene.lighting`, and no stage banner ever carried one. **Every banner in every stage computed its glow from `studio`, a lamp up and to the right, while the hall was lit by `nave` from behind.** The coupling was right; the wire was missing. Scenes now publish the rig they resolved through a `<LightRig>` context and the paper reads that in preference to its own name — exported, so a hand-built R3F scene gets the same guarantee. Moving a light writes four uniforms in place rather than rebuilding a shader program, so dragging a slider does not recompile per frame.

  Retuned along with it, all of it visible in the README's stage loop: the source at the end of the walk was a hundred units across and filled the frame behind the colonnade, so `source.spread` now sizes it as an opening rather than a wall; its falloff runs from a held core into a long tail instead of dropping to nothing over the last 45%, which had put a visible rim on it like a moon hanging in the room; the nave prints a stop under, because a backlit sheet carries its lamp's whole intensity as transmission and at the old exposure every banner clipped to flat white and lost the folds it was draped for; and the haze reaches past the end of the walk instead of saturating halfway down it.

  New in `figure`: **`finish: 'silhouette' | 'shaded'`**, defaulting to `shaded`. A rigged model keeps its own materials and takes the scene's light — in a backlit hall, a rim down one edge and the studio light filling the other. Two clip fixes came with it: `pickClip` now takes the **shortest** matching name, so `Man_Run` wins over `Man_RunningJump` (taking the first match meant a pack that happened to list the jump first put the figure into it for the whole walk), and a frozen figure — which is what `prefers-reduced-motion` produces — stands in an idle clip instead of holding frame 0 of a stride with one leg out.

  **What it costs, measured** (`pnpm perf`, native GPU, nave at medium): 44ms → 68ms a frame, all of it the environment sampling in a scene with heavy overdraw, and `pnpm perf` gained a case so the trade stays visible. The `low` tier swaps the environment for a hemisphere light rather than dropping it, so a weak machine still gets light with a top and a bottom; `light: { studio: 0 }` turns it off at any tier without moving the tier.

- 5dea79c: A content type for the things paper actually gets cut into, real typesetting controls, and no preset touches the network any more.

  ### `card` — the paper-artifact type

  One composition — a tracked label, a hairline rule, a body, a line of small print — covering the index card, the library due-date card, the museum wall label, the telegram slip and the gallery quote sheet, because those are the same object with different parts present.

  It exists because `text` could not make any of them. `text` sets a block of prose in one size and one weight; every artifact above is a _hierarchy_, and composing one out of plain text meant hand-placing newlines and hoping. The proportions inside `paintCard` are ratios of the body size rather than numbers, so a card scales as a card instead of as a paragraph that grew, and the whole block is measured before anything is drawn so it can sit optically centred — a card whose type hangs from the top edge reads as a page that got cropped.

  Held to the receipt's standard deliberately. The receipt has been the only content type in this library anybody art-directed; everything else went through one `fillText` loop in the system serif.

  ### `text` gained `tracking` and `valign`

  Tracking is the control display type cannot do without: a line set to be read across a room needs it pulled in, small uppercase needs it pushed out, and neither is reachable by changing the size. It is applied **before** measuring, because `measureText` honours `letterSpacing` and wrapping against the untracked width breaks lines to a measure the painted line does not have.

  `valign: 'center'` optically centres the block rather than hanging it from the top edge — what a label or a poster wants, where `top` is what a letter wants because a letter starts at the top of the page. Both default to the old behaviour.

  ### Line breaking is shared, and it no longer lets type leave the sheet

  `wrapLines` is one module now rather than a loop about to be copied into a second painter — two copies of a line-breaker is two answers to "where does this wrap", and on a sheet that CURLS the reader sees the break land on a fold.

  **It also fixes a real bug.** The old loop appended a word whenever the line was empty, on the reasonable theory that one word always fits. A long URL or a compound on a narrow banner does not, and it ran off the edge of the sheet with nothing to stop it. A sheet is a physical object: type that leaves it has left it. Over-long words are now broken to the measure, and a blank line survives as a paragraph break instead of collapsing.

  ### Fonts are requested by name

  `document.fonts.ready` — which this library already awaited — resolves when the fonts the _document_ requested have settled. A family named only inside a canvas `ctx.font` string was never requested by anything, so on a page where no DOM element uses it, `ready` resolves immediately and the sheet paints in the fallback: Times where the preset says Playfair, silently and only sometimes. `ensureFont` calls `document.fonts.load()` for the face the content actually names before painting. Failures are swallowed on purpose — a font that will not load is a fallback, not an exception.

  ### No built-in preset touches the network

  **All four** of the presets that fetched Unsplash are fixed, not the two originally counted.

  - `hero-peel` and `hanging-poster` were demonstrating a _behaviour_; the photograph was incidental. They are typeset now — `hanging-poster` is a real poster, which is what every paper installation worth the name hangs.
  - `photo-print` and `postage-stamp` are **containers for the caller's own art**, and their whole documented use is `<PaperField images={photos} preset="photo-print" />`. `image.src` now defaults to empty, and empty renders as bare stock rather than as a failure. An image that fails to load falls back the same way instead of leaving the sheet with no texture at all.

  A live third-party fetch inside the first thing a new user renders fails offline, behind a corporate proxy, under a strict CSP, and on the day the URL changes.

  ### The Field composer's default is paper

  The demo pool was eight HSL gradient tiles with a translucent white disc on each — the right instinct (procedural, offline, nothing to leak) attached to the wrong art direction, and the single most damaging screenshot in the product: a library about paper greeting every visitor who clicked **Field** with a carousel of app-icon swatches.

  It is eight `card` artifacts now — a mill specimen, a due-date card, a telegram, a catalogue label, an index card, a ticket stub, a note, an archive label — and the default population is `blank-sheet` rather than `photo-print`, because a museum label printed on gloss photo stock is the wrong material. They are content rather than images, so they are not photographs _of_ paper: they are typeset by the same painter that sets every other sheet, on the slot's own stock, and they curl with the mesh.

  ### Three parsed-vs-input type slips, found by adding two fields

  Adding `tracking` and `valign` broke the build in three places that had been quietly wrong: `PaperStage`'s banner literal asserted `satisfies ContentConfig`, and `FieldPaperSlot.content` and the a11y mirror both took the _parsed_ type. `z.infer` is the config with every default filled in; `z.input` is what a caller may write. A literal a human types is by definition the input type, and demanding the parsed one turns a two-line content object into a type error — the exact failure `config/props.test.ts` exists to catch on the props. `FieldPaperSlot.content` takes `ContentConfigInput` and is parsed internally.

  Worth noting how they were found: they only surfaced because the schema grew. Each was a tripwire on the schema rather than a check on the object, and they had all been passing by coincidence.

  ### The docs' stock grid is a specimen sheet

  Every stock now renders as a `card` under the new `raking` key — the light a paper merchant photographs a swatch book under. It skims across the sheet instead of landing on it, which is the only way a stock's own character reads as material rather than as tint.

  `cardContentSchema`, `CardContent` and `wrapLines` are exported.

- 5dea79c: The tone curve is part of the lighting rig, stage mode has a print pass, and the source is a real light instead of a decal.

  Three changes that turned out to be one change, because each of the first two only works if the third is true.

  ### `light.film` — the curve, where `exposure` was already the stop

  `<PaperStage>` pinned `ACESFilmicToneMapping` on its canvas in `onCreated`; `<Paper>` never set one and took whatever R3F defaults to. The two modes could disagree about the film while agreeing about everything else, and neither could be told otherwise without forking the component. It is `light.film` now, resolved by `resolveLighting` with everything else and applied by `PaperLighting` beside the exposure it already owned — so a stage and a lone `<Paper>` under the same preset are printed identically by construction.

  **Every preset ships `neutral` — Khronos PBR Neutral — and the first attempt at this shipped `agx`, which was wrong.** The reasoning for AgX was sound and the render disagreed: rendered through all three on `nave`, AgX and ACES both bleach a warm clipping source toward grey-white, because both desaturate hard as they approach white. On a hall whose entire subject is warm light coming through paper, that removes the thing you came for. Neutral is built specifically to hold hue and saturation through the roll-off, and it is the only one of the three that keeps the light warm. `agx` and `filmic` remain selectable.

  ### `stage.grade` — bloom, tone curve, vignette, grain

  `{ bloom, threshold, vignette, grain }`, serialized like everything else. It lives on the stage rather than on the lighting rig — the rig is read by `<Paper>` too, and `<Paper>` has no composer, so a grade in the rig would be a promise one of the two modes could not keep.

  **A composer takes the tone curve away from the renderer, so the chain has to give it back.** `<EffectComposer>` sets `gl.toneMapping = NoToneMapping` for as long as it is mounted, and it is right to: tone mapping belongs at the end of a post chain, not the end of the scene pass, and a frame mapped twice is wrong twice. What that means is that a composer mounted _without_ a `<ToneMapping>` effect silently discards `light.film` entirely. The chain is `Bloom → ToneMapping → Vignette → Noise` — bloom while the frame is still HDR, tone mapping to land it in display range, and the two darkroom moves on the finished print.

  `threshold` is in **linear light and defaults to 1.6**, above 1.0 on purpose, and its bound is 4 rather than 1. Because bloom reads the scene before the curve, 1.0 means "as bright as white" rather than "the brightest thing on screen". Lit near-white stock sits near 1.0 unaided; a threshold under 1 blooms the _paper_, fogs the hall, and costs every sheet its edges.

  ### The source is an emitter now, not a decal

  `Source` — the bright void the walk resolves toward — was a `meshBasicMaterial` with `toneMapped: false`. That is a workaround for not having a post chain, and it stops working the moment there is one: a composer maps the whole framebuffer at the end, so a material that opted out of the _renderer's_ curve is not exempt from the _composer's_. The source came out crushed to a flat grey panel — the one thing in the scene that must never look like a panel.

  It burns at `SOURCE_INTENSITY` (3.4× white, in linear light) and is tone-mapped like everything else. This is both the fix and the more honest description: light is brighter than white, that is what makes it light, a curve rolling off a value above 1.0 is what gives a source falloff instead of an edge, and it is the only thing bloom can key off. `Surround` has spent several versions fighting the same problem with a seven-stop alpha ramp, in geometry, which was the wrong layer.

  ### Two lighting presets built for paper as a material

  `raking` and `lightbox` bring the set to eight.

  **`raking`** puts a hard key eight degrees above the horizon and well off to one side, so it skims ACROSS a sheet rather than landing on it. It is how a paper merchant photographs a swatch book, and it is the only rig in the set that turns a fold, a crease or a crumple into relief instead of shading. Ambient and studio are the lowest in the set on purpose: raking light works by the shadows it casts, and fill is exactly what erases them. Measured against `studio` on `crumpled-note`, the difference is not subtle — every crease facet resolves as a distinct light or dark plane where `studio` renders a soft white sheet with a suggestion of texture. First cut had `ambient: 0.06`, which took the shadow side to near-black and made the relief read as holes; lifted to 0.09.

  **`lightbox`** puts the lamp behind the sheet and level with it. Every other front-lit rig shows ink ON paper; this shows light THROUGH it, which `translucency` has been able to render since it became a per-stock number and which no preset had ever made the subject. Printed at `exposure: 0.85` for the same reason `nave` is under: a backlit sheet carries the lamp's whole intensity as transmission and clips to flat white at 1.0.

  **One honest limit, found by building `raking` and looking at it.** The surface effects — `grain`, `aging`, `deckle`, `creaseLines` — are albedo and alpha, not normal perturbation. There is no bump map anywhere in `surface/compose.ts`. So a grazing key reveals **geometry** beautifully and reveals **surface texture** not at all: a crumple lights up, a sheet of aged newsprint does not. The pitch for this preset was originally "it reveals fibre and deckle as relief", and that half is not true yet. Making it true means perturbing normals in the surface shader, which is its own piece of work.

  ### Depth falloff, off by default

  `grade.depth` is a real optical blur, and it defaults to **0** as a considered answer rather than a stub. Depth in this scene is already staged by haze — one fragment instruction, and how a real hall does it — while optical blur is a second full-screen pass and the effect most likely to read as a video game rather than a photograph. Every paper installation worth copying is shot deep. It ships because a shallow frame is a legitimate look for a close shot on one banner, and the schema is the only place a look is allowed to live. The first mapping focused eight units out, which put the focal plane in the empty air past the paper and left nothing in frame sharp; it now focuses at roughly three units, where the banner you are standing in front of actually is.

  ### Calibration: the six original presets needed no numbers changed

  Rendered under Neutral through the new `pnpm shot:light` harness. They hold, and the warm ones — `goldenhour`, `window`, `leaves` — actively **improve**, because the key colour ACES was desaturating now survives the roll-off. `noir` keeps its crushed shadows and its contrast. This is the answer to "re-calibrate against the new film": measured, and the answer is that the film change was in their favour.

  ### A harness for judging light, and a bug it found

  `pnpm shot:light` photographs one paper preset under one lighting preset headless — `--all` sweeps every rig in one run. Nothing here could previously answer "what does this rig do to a sheet?" without a human opening the editor.

  Building it surfaced a real defect in `apps/editor/media.html`: it drew the lamps with `<PaperLighting>` but never published the rig with `<LightRig>`, so every sheet computed its backlit transmission against its own `scene.lighting` — `studio`, a front key — while the actual lamp stood behind it. That is precisely the disagreement `resolveLighting` exists to prevent, and it is why `lightbox` first rendered as a flat grey sheet. The README's motion assets are recorded through that same entry.

  ### Shipping details

  **BREAKING: stage mode moves to its own entry point.** `import { PaperStage } from 'paperlab/stage'` — likewise `getStagePreset`, `walks`, `stageSchema`, `buildStageAgentPayload` and the rest of the stage surface. The main entry is unchanged for `<Paper>` and `<PaperField>`.

  This reverses an earlier decision, and the reason it is allowed to is that it is a **different argument**. That decision was about BYTES, and it was right about bytes: tree-shaking already kept stage code out of a `<Paper>` bundle, so a subpath saved nobody a byte. This is about RESOLVABILITY, which tree-shaking cannot fix. Tree-shaking removes the _code_; it cannot remove the _import specifier_. While the main entry named `@react-three/postprocessing`, a consumer who installed paperlab for `<Paper>` alone — and believed the word "optional" — got an unresolvable module at build time. The peers were briefly shipped as `optional` on exactly that false premise.

  Measured on the built package, which is the only way this claim is worth anything:

  |                              | occurrences of `postprocessing` |
  | ---------------------------- | ------------------------------: |
  | `dist/index.js` (main, ESM)  |                           **0** |
  | `dist/index.cjs` (main, CJS) |                           **0** |
  | `dist/stage.js`              |                               4 |

  And end to end: with both packages **uninstalled**, bundling `export { Paper } from 'paperlab'` now succeeds and contains zero references. Before the split the same build failed to resolve. `@react-three/postprocessing` and `postprocessing` are `peerDependenciesMeta.optional` again, and this time it is true.

  **`three` peer floor rises to `>=0.162`.** `NeutralToneMapping` landed in r162 and is now the default film, so `>=0.160` would have handed r160/r161 users `undefined`.

  **The print runs on the `high` tier only, measured rather than assumed.** `pnpm perf --soft` (SwiftShader, the weak-machine floor): switching it on at `medium` took the frame 51.0 ms → 92.2 ms, 20 fps to 11, while `low` — which never had it — held at 26.1 → 28.4 ms. The control is what makes the ~40 ms readable as the grade and not the weather. `medium` is the tier `auto` _starts_ at, so paying it there pushes weak machines down to `low`, where they lose the environment light and the shadow map to buy a bloom. Switching it back off returned `medium` to 52.9 ms.

  `filmNames`, `FilmName`, `stageGradeSchema`, `StageGradeConfig` and `SOURCE_INTENSITY` are exported. `pnpm shot` takes `--film`, `--bloom`, `--threshold`, `--vignette` and `--grain`.

- 10952fe: The Ribbon: a strip hung the full drop of a room, pooling where it lands.

  The strongest image in the reference set, and the payoff for the four phases before it — it needs a room with a ceiling to hang from, hardware to hang by, type that can be set down a length without reading as a caption, and a crease that begins at the floor line rather than at the sheet's centre. Ships as the `ribbon` behavior, the `paper-ribbon` preset, and the `ribbon` stage.

  ### What it is made of, and two things the render corrected

  A ribbon is folds down its length plus a hinge where it meets the ground. Both already existed, so it is a behavior rather than a deformer — but neither of the obvious choices survived contact with a render.

  **`wave`, not `drape`.** `drape` is the obvious deformer for folds down a hanging sheet, and it renders an **invisible sheet on the hero (CPU) path** — at any grid, including an explicitly fixed one. See below; it is written up as an open bug. `wave` pinned at the top is the same picture by another road, and is proven on both paths.

  **`fold`, not `roll`.** A roll wraps the pooled length around a cylinder, so it curls up and over and finishes in mid-air: a hook, not a pool. Paper meeting a floor does not wrap — it creases and lies down. A soft hinge at the floor line does exactly that, and the length below it runs out flat along the ground.

  The hinge is placed from the **sheet**, which makes this the one behavior that genuinely needs the second argument to `stack()`: "a pool-length above the bottom edge" is meaningless without a height. Its radius scales with the sheet too, because a fixed hinge that reads as a fold on a short strip reads as a knife-edge on a long one.

  `progressParam` is `curl` rather than `pool`, and for a mechanical reason: the grid is sized by sampling that parameter from 0 to 1, so it has to _be_ a 0..1 parameter — a `pool` bounded at 0.5 would be sampled across a range it rejects — and it should be the one that drives the geometry hardest.

  ### `colonnade.hover` may go below zero now

  Its own comment claimed "0 = they pool on it", and at 0 a banner's bottom **edge** sits on the floor, which is not the same thing at all. A ribbon creases a pool-length _above_ its bottom edge, so it has to hang that much lower for the crease to land on the ground — otherwise the slack lies flat in mid-air, parallel to a floor it never touches.

  The bound was `min(0)`, so the one thing the option documented itself as doing was the one thing it could not do. It is `min(-0.5)` now, and the `ribbon` stage sets `hover` to exactly minus its pool fraction.

  ### An open bug this turned up

  **`drape` renders nothing on the hero path.** Not faintly — the frame contains one colour, the background. Ruled out in order: the math (swept across its whole option range, every vertex finite and bounded), tessellation (an explicit `segments: 96` renders the same blank), and the sheet and content (identical ones render fine under `hang`). Isolated by bisecting the stack: `roll` alone renders, `drape` alone is blank, both together blank.

  Nobody had hit it because `drape` had exactly one caller in the library — the stage banner — and that runs the field/GPU path and its GLSL twin. No behavior and no paper preset had ever put it on the CPU side. **Which is worth stating plainly: a parity gate proves the two implementations agree, not that either one draws.**

  ### The stage

  Tighter than the banner stages and hung lower, with a raised camera and a short look-ahead — pooled paper lies _flat_, so from standing height it foreshortens to a sliver and the shot has to get above it for the thing this stage is about to read at all. Twelve strips, a low ceiling so the drop reads as the height of the room rather than as a short thing in a tall one, and the suspension threads finally in frame where they were built to be.

- 2cfa737: Paper hangs from something now, and it can have landed.

  Two primitives, shared by three of the four gallery stages still to come — built once here rather than three times later.

  ### `settle` — the pose after the fall

  The library could drop paper (`fall`), fly it (`fly`, `flight`), heap it (`pile`) and catch it mid-air (`spill`), and had no way at all to show a sheet that has **arrived**. Every reference installation worth copying has paper on the floor: sheets settled on concrete after the fall, ribbons pooling where they meet the ground. It is the most beautiful detail in the set and it appears there twice.

  **The distinction from `fall` is not the shape, it is the clock.** `fall` flutters — its wave carries `speed: 1.3`, because it is a sheet still arguing with the air. This one is over. Everything in `settle` is static, and that is the point: a settled sheet that ripples is a settled sheet nobody believes. It also costs a per-frame re-deform forever, for motion that should not be there. A test asserts it at every setting.

  `{ relax, lift, corner, slack }`. `relax` is how long ago it landed; `lift` is how hard the stock resists lying flat, and it is the floor under the relaxing — tissue surrenders completely, card never does. Relaxing subtracts; stiffness is what it will never give back.

  It is a **behavior**, not a deformer, because a landed sheet is a gentle curl the stiffness held on to plus a long slack undulation where it bridges the floor — and both already exist. A deformer that can be spelled out of the ones we have does not earn a GLSL twin and a parity case.

  **The first version rendered a flat rectangle**, which is the one outcome it exists to avoid: the corner lift was scaled _below_ `fall`'s, when a settled sheet should keep more than a falling one — that corner is the thing gravity could not take from it. Recalibrated against `fall`'s own numbers and pinned by a test.

  Ships with a `settled-sheet` preset.

  ### Suspension — what holds the paper up

  Every paper installation shows its hardware: monofilament from a ceiling grid, steel wire, bulldog clips, a rod. In the scattered-sheet pieces the threads are half the composition. Stage mode's banners hung from **nothing at all**, which is a larger realism gap than any shader in the backlog and closes for a few thin lines of geometry — a hung thing that shows what suspends it stops reading as a rectangle that happens to float.

  `stage.suspension` is `{ type: 'thread' | 'none', color, clips }`.

  **Both halves are one draw call each.** The threads are a single `LineSegments` buffer rather than N line meshes, and the clips are an `InstancedMesh`, because a field of forty banners is drawn in one call and it would be absurd for the string holding them up to cost eighty more.

  Two details that are easy to get wrong and are pinned by tests. A thread attaches to the sheet's **own top edge**, rotated the way the pose rotates it — so a tilted banner's thread follows its top rather than rising from a point above its centre. And the clips are sized off the sheet rather than in world units, so a clip on a postage stamp and a clip on an eight-metre banner both look like a clip.

  The threads deliberately cast no shadow: a shadow map at this scale renders monofilament as a black bar across the floor, far more visible than the thread itself and completely wrong.

  **Worth knowing where you will and will not see it.** The colonnade stages are framed at eye level down an aisle, and the banners are tall enough that their tops — and therefore their threads — sit above the frame. It reads in a `wide` or raised shot, and it will matter properly in the gallery stages, where paper hangs at varying heights in view. That is what it was built for.

### Patch Changes

- 435367d: A callback prop is a notification, not a dependency — the last two places that had it the other way round.

  Both are the shape that made the editor feel frozen in stage mode a fortnight ago, found in the same sweep and left open because neither was a loop. They are closed now.

  **`<DropZone>` re-registered on every render of the page above it.** The registration effect named `onPlace` in its dependency list, and the natural way to pass that prop is an inline arrow — a new function every render. So a consumer re-rendering for any reason at all tore the zone out of the registry and put it back, which bumped the registry version, which re-rendered every `DropZoneVisual` in the field. It was churn rather than a loop only because the effect's own component is not what the version change re-renders, and that was luck rather than design. The registration now depends on what the zone **is** — its id, bounds, accept globs and highlight — and reaches the callback through a ref at the moment a paper is actually placed.

  **`<PaperStage>` re-parsed its whole schema on every render.** `stage` arrives from an editor or a page as a fresh object literal, so keying `stageSchema.parse` and `getWalkPath` on its identity meant both ran again for a value that had not changed. Harmless once per render and never wrong, but it is why each iteration of that earlier feedback loop cost as much as it did. Now on serialized deps, the way `PaperFieldMesh` already did it.

  Neither changes an API or a rendered frame. Both remove work that a well-behaved consumer could not have avoided doing.

- ff76e4a: Four crashes, one shape: a value reaching a strict parse from inside a render.

  The report was "when I interact with anything the whole app freezes", then "whenever I try to manage speed the app gets closed". Both were real, neither was what it sounded like, and the second one turned out to be a class rather than a bug.

  ### The freeze: a notification that had become a pump

  `<PaperStageScene>` reported its settled quality tier from an effect that named the callback in its own dependency list. The natural way to pass that prop is an inline arrow, which is a new function on every render of the page above — so the effect fired on every **consumer render**, not on every tier change. The consumer stores the tier, which re-renders, which makes another arrow, which fires the effect again.

  Measured at ~6 App renders a second at rest in stage mode, each one a full `stageSchema.parse` and walk resample. That is why every interaction felt frozen, and why dragging the scrubber could take the tab out with an out-of-memory crash. The callback now lives in a ref and the effect depends on `tier` alone.

  The general rule, since it is not specific to this prop: **a callback prop is a notification, not a dependency.** If an effect exists to tell the consumer something, it depends on the thing being told and reaches the callback through a ref.

  ### The crash: `.int()`, and everywhere else the same shape hid

  The editor's generated sliders took two facts off a schema — `min` and `max` — and derived a step of `(max - min) / 200`. They never read `.int()`. So touching `seed` on a colonnade wrote `2.5` into a field declared `z.number().int()`, and `<PaperStageScene>` re-parses its layout options **during render** to place the walk's stops. A strict parse does not warn about a fraction; it throws, inside a render, which unmounts the tree.

  Ten fields across the library carry `.int()`. Fixed once, in the control model: an int field gets `step: 1` **and** its emitted value is rounded, because the readout you can type into clamps but never snaps.

  Asking where else that shape hid found three more:

  - **A second copy of the schema walk** in the editor's states bar, missing `.int()` in exactly the same way, crashing through a different parse (`resolveFieldSlotConfig`, also during render). Fixed by deleting the copy — there is now one reader of a `z.ZodNumber`.
  - **Exclusive bounds.** `.positive()` is stored as `min: 0, inclusive: false` — one boolean away from `.min(0)` — and reading the value while dropping the boolean gives a slider whose end is the one number the schema rejects. Latent; handled anyway.
  - **The same shape on the text side, and live.** A stage's sky colours are text fields, and a text field emits per keystroke, so the library is handed `#f` and `#ff` while somebody types `#ffaa22`. `addColorStop` is one of the few canvas calls that _throws_ rather than ignoring what it cannot parse, and the sky is built during render. Three.js is the forgiving one, which is why the gradient was the only path that broke. `cssColorOr` now asks a canvas whether a string is a colour — the canvas's own opinion rather than a regex, because CSS colours are a larger set than a regex should be trusted with.

  The rule worth keeping: **a schema is a contract in both directions.** Anything generated from one has to emit what that schema accepts, because the code receiving it is entitled to parse strictly — and a strict parse inside a render is an app-level crash, not a validation message.

  ### Also: dependency arrays are evaluated every render

  `PaperFieldMesh`, `FitCamera`, `useContentAtlas` and the resolved-config memo all used `JSON.stringify` as a memo dependency. A dependency array is evaluated on **every** render, so the serialization was paid every render whether or not anything changed — and paid in garbage rather than in time. A field of fourteen photographs re-serialized roughly seventeen megabytes per render, because an image slot carries its bitmap inline as a data URL.

  Replaced with `useStable`, a deep compare that allocates nothing and short-circuits on `Object.is` at every level, so the common case — a fresh wrapper around the same inner objects — costs a handful of pointer checks however large the data URL underneath.

- 2eba685: The ribbon stage renders what it is for, and banner type is set to the measure.

  **`ribbon`'s crease could not reach a right angle.** `foldAngle` was `62 + curl * 46`, so below curl 0.61 — including the default, and including the value the ribbon stage shipped — the pooled length was still travelling downward when it passed the crease and went through the floor. Above 0.61 it tilted back up and floated. A hinge turns through one angle and the flap holds that heading, so only 90° is the floor: it is fixed at 90 now, and `curl` drives the crease radius, which is what its own description always said it did. The crease is also placed a hinge-radius higher, because the flap leaves the hinge cylinder that much below the crease line — measured at ~9cm under the floor on the stage's own numbers.

  **`ribbon` uses `drape` again.** It had been switched to `wave` to work around a report that `drape` rendered an invisible sheet on the CPU path. That report does not reproduce; it rested on counting colours in a screenshot, and a near-flat strip filling the frame has about as many colours as an empty one. `wave` was never the same picture either — a sine runs at one amplitude end to end, and a hung strip is flat where it is held and gathers as it falls.

  **Banner type was sized by the drop and never by the measure.** On a tall narrow banner the chosen size was wider than the sheet, so every word was broken wherever the measure ran out and the column then overran the drop and was clipped. `bannerTextSize` now takes the longest word and the measure (`bannerMeasure` states how much room there is, once), and a single-word column is set one letter to a line on purpose (`letterColumn`) instead of being shattered at arbitrary points — `carried` reads down its banner rather than as `ca / rr / ie / d`. Columns are centred down the drop, since one size is shared by the whole rank. `splitAcrossBanners` also dealt with a stride that dropped banners: twenty words over twelve gave ten columns and left two blank.

  **New: `deformers/draws.test.ts`** — every registered deformer, built into a real sheet on two aspect ratios, asserted to be finite, actually moved, still to have most of its area, and to have unit normals. A parity gate proves the two implementations agree, not that either one draws; this is the missing half, and a new deformer cannot skip it.

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
