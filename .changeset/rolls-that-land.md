---
'paperlab': minor
---

New `strip` physics: a roll paying paper out as the page scrolls, and the pile it makes when it lands.

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
