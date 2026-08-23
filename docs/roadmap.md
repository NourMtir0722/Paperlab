# Paperlab — what it is, and where it's going

> **Read this first.** This is the project's memory: what Paperlab is, who it's
> for, what's already decided, and what we want to build next. If you're an
> agent or a collaborator joining a conversation cold, start here — the README
> sells the product, `AGENTS.md` documents the API, and this file explains the
> *intent* behind both.
>
> Last updated 2026-08-23 · library at `0.2.0`, published; `0.3.0` unreleased on main

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

- **12 behaviors** — `peel`, `unroll`, `flip`, `letter-fold`, `hang`, `fly`,
  `fall`, `carry`, `flight`, `crumple`, `settle`, `ribbon`. Human-named params
  ("tightness", not "cylinderRadius") over a stack of pure geometry deformers,
  each nominating the two or three that ARE it.
- **7 deformers** — `roll`, `curl`, `bend`, `fold`, `wave`, `drape`, `crumple`.
  Each has a JS implementation (CPU/hero path) and a GLSL twin (GPU/field
  path), held identical by a golden-vector parity gate — and, since
  2026-08-23, each is separately asserted to actually draw a surface.
- **12 layouts** — every one names a place paper actually sits: `book`,
  `accordion`, `fan`, `spread`, `pile`, `rack`, `wall`, `spill`, `sweep`,
  `ring`, `colonnade`, `sheet`.
- **15 paper presets**, **6 stage presets**, **7 stocks**, 8 lighting rigs.
- **Three modes** — one paper, a field of them in a single instanced draw call,
  or a stage you walk through.
- **671 tests** + a 37-case GPU/CPU parity gate, all green in CI.

> These counts drift. `apps/docs/src/docsDrift.test.ts` holds the NAMES in
> README / AGENTS / llms.txt to the registries in both directions, but nothing
> checks a number in prose — so when one of these is wrong, it is wrong
> quietly. Re-read them from the registries before quoting one anywhere that
> matters.

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

> **REVISED 2026-08-21 — stage now IS a subpath, `paperlab/stage`.** The
> paragraph above stays because its reasoning was correct and is still
> correct: tree-shaking keeps stage code out of a `<Paper>` bundle, and a
> subpath saves nobody a byte. What changed is that bytes stopped being the
> only question. Stage mode gained a print pass (bloom, tone curve, vignette,
> grain) built on `@react-three/postprocessing`, and those peers can only be
> declared **optional** if the main entry never names the module — because
> tree-shaking removes the code but not the import specifier, and a
> `<Paper>`-only consumer who has not installed them otherwise cannot
> resolve `paperlab` at all. Verified on the built package: `postprocessing`
> appears 0 times in `dist/index.js` and `dist/index.cjs`, 4 times in
> `dist/stage.js`, and a `<Paper>` bundle builds with both packages
> uninstalled. Resolvability, not size, is the new information.

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

## The build order

A product review on 2026-08-21 produced a sequenced plan, and **the plan
lived only in an artifact link until now** — which was itself one of its own
Phase 00 tasks, left open through five phases. It is here so that it can be
checked against the repo, which is how the gaps below were found.

**The sequencing principle, which is the part worth keeping:** phases are
ordered by *what has to be true before the next thing can be built without
being built twice*, not by importance. The grade goes first because every
later frame is judged through it. The paper-content renderer goes before any
gallery stage because all four stages are typographic. The room and the
shared primitives go before the stages that inherit them. Only one stage is
above the launch gate; the rest ship after, on purpose, as the content
cadence.

| # | phase | done test | status |
|---|---|---|---|
| 00 | Ground | a stranger can open all three apps; the README promises nothing missing | done — the README pass landed with phase 07, where it was deferred to |
| 01 | The grade | the source reads as light; white paper keeps its hue | done |
| 02 | The material | open Field mode, change nothing, screenshot: it is a portfolio image | done |
| 03 | The room | a frame with nobody in it reads as a large room | done — columns and a doorway landed 2026-08-23 |
| 04 | The primitives | a hung sheet shows what suspends it; a fallen sheet lies convincingly | done — rods and pegs landed 2026-08-23 |
| 05 | Ribbon | a still stops someone scrolling with no caption | done, after the four defects above were fixed |
| 06 | The tool, structurally | a stranger changes the one thing they meant to, and undoes it | done |
| 07 | Honesty | every URL on a phone, cold cache, nothing confusing or blank | done 2026-08-23 |
| — | launch gate | publish 0.3.0, render assets, Product Hunt | **next** — nothing above it is open |
| 08 | The rest of the gallery | one stage every couple of weeks | after launch, deliberately |

### What phases 03 and 04 did not build — *built 2026-08-23*

Recorded when the audit found them, and closed the same week.

**Phase 03 asked for five pieces of architecture: a ceiling, a column with a
base plate, a doorway, floor slab seams, and a wall corner.** Two had
shipped. The three missing ones were the three that stand IN the room — a
ceiling and floor seams are both *boundaries*, and a boundary says where a
space stops, not how big it is. That distinction is the whole reason the
walking figure was retired: **architecture is a better scale cue than a human
mesh, and it is the thing renderers never fail at.**

- **`room.columns`** — square piers with a base plate and a capital, down
  both sides of the walk, spaced by arc length so a bend gets even bays.
  Three instanced meshes, so a hundred-metre colonnade is three draw calls.
  The base plate is the part doing the work: it is the only element in the
  scene that puts a hard horizontal edge at a **known height off the floor**.
  Two tuning findings, both learned from the render rather than argued:
  columns must stand **outside** the paper (one between the viewer and a
  banner has swapped the subject for the set), and they must be **darker than
  paper** (at paper value they read as more banners, and the eye loses track
  of what the room is made of). `nave` shows them.
- **`room.doorway`** — a wall at the end of the walk with the source shining
  through an opening in it, which delivers the doorway AND the wall corner
  from one piece. It is the difference between light and light *from
  somewhere*. `threshold`, the stage named for it, shows it.

  Two things cost a render each. The wall has to **stand off the source
  plane** — coplanar they fight for the same pixels, and across a whole wall
  that is a moiré of stripes in the brightest part of the frame. And the
  outer contour has to run **below the floor**, not down to it: the opening's
  sill is under the floor line so the doorway reads as reaching the ground,
  and a hole that pokes out through the bottom edge is not cut at all — the
  triangulator drops it and the wall comes back solid.

**Phase 04 asked for "thread, clips, pegs, a rod".** Thread and clips had
shipped, and `suspension.clips` was a **boolean**, which is why: a boolean
cannot grow a third answer. It is now two enums that say different things —
`type` is what carries the load (`thread` / `rod` / `none`) and `hardware` is
what grips the sheet (`clip` / `peg` / `none`).

- **`rod`** — a dowel across each sheet's top edge, hung from the ceiling at
  **both ends**, because a rod on one central line would tip and the eye
  knows it. A rank on threads reads as sheets floating in a row; a rank on
  rods reads as sheets somebody hung, on something. `archive` uses them.
- **`peg`** — narrow and deep, gripping down the face, where a clip is wide
  and shallow and grips across the edge. That difference is the entire
  silhouette, and the silhouette is all that survives the distance this scene
  works at. `cloister` uses them.

Hardware now scales with the sheet it holds, which it did not: a layout that
shrinks banners at the far end of a walk and leaves their clips full size has
just told the viewer how far away they are not.

A test asserts at least one built-in stage exercises each kind, so none of
this is art nobody looks at.

---

## Now — the launch runway

This was filed as pure distribution, no code. One of the two turned out to
be a code problem after all — see the npm entry.

- [x] **Published to npm — `0.2.0`, not `0.1.0`.** Done 2026-08-13. The
      registry had served `0.0.1` since July; `main` carried a `0.1.0` that npm
      never saw, because the release workflow only ever *opened* the version PR
      while unconsumed changesets existed — `changeset publish` had never run
      once. Merging that PR consumed five changesets, one of them a minor
      (`crumple`), so the published version is **`0.2.0`** and `0.1.0` is a
      version that will never exist on the registry. Verified by installing the
      tarball: stage mode, `crumple`, the registries and the generated README
      are all in it.

      **Two things it cost, both worth keeping:**

      - **The publish failed the first time, after the version bump had already
        landed on `main`.** `EUNKNOWNCONFIG Unknown cli flag: --git-checks`.
        Changesets publishes through pnpm, pnpm hands its own `--no-git-checks`
        down to npm, and npm had always ignored flags it didn't recognise.
        npm 11 warns "*this will stop working in the next major version of
        npm*"; npm 12 is that major and rejects it. The workflow asked for
        `npm@latest` to clear trusted publishing's `>= 11.5.1` floor, so it got
        12 on the day 12 shipped. Now pinned to `npm@11`, and **the pin is
        load-bearing** — unpin only when pnpm or changesets stops passing that
        flag. The general shape: `@latest` in a release path is a dependency on
        a version that does not exist yet.
      - **There is no provenance, and the workflow comment claiming otherwise
        was wrong.** Trusted publishing over OIDC authenticated fine, but the
        published version carries no attestations — npm will not attest a build
        from a private repository. Provenance arrives free if the repo ever
        goes public, and not before.

- [x] **The demo is live — 2026-08-22.** https://nourmtir0722.github.io/Paperlab/
      (playground), `/editor`, `/docs`. Two steps, and the second was the
      surprise: making the repo public was **necessary but not sufficient**.
      `has_pages` stayed false and the workflow reported `skipped` on every
      push until Pages was switched on in Settings → Pages → Source: "GitHub
      Actions". Even then nothing had built, because the workflow triggers on
      push and there had been none since — `gh workflow run pages.yml --ref
      main` deployed it in 46 seconds. The original entry, which was correct
      about the cause and wrong about the remedy being one step, follows.

  - [x] ~~**Turn on the demo — blocked, and not by the workflow.**~~ `pages.yml` is
      written and correct (playground at the root, editor at `/editor`, docs at
      `/docs`). **The repo is private, and GitHub Pages will not serve a private
      repo on the free plan** — the API refuses with "Your current plan does not
      support GitHub Pages for this repository." Nothing here or in the launch
      notes had ever recorded that the repo was private; the plan assumed Pages
      would simply switch on.

      Asked and answered 2026-08-13: **stay private, demo stays off for now.**
      The three ways out, for whenever it is picked up again:

      - **Make the repo public.** Free, switches Pages on immediately, and
        brings provenance with it. It is also what the rest of this project
        already assumes — Apache-2.0, a `CONTRIBUTING.md` contribution ladder,
        a community gallery whose v1 is *"a PR adds a `.paper` file"*, and a
        goal that reads "from the community to the community". None of those
        can land against a private repo.
      - **GitHub Pro** (~$4/mo) keeps the source closed and the demo live, but
        leaves the contribution ladder with nowhere to land.
      - **Host the demo elsewhere** (Cloudflare Pages, Netlify), which re-opens
        the decision that picked GitHub Pages for having zero credentials and
        no third-party account.

      The workflow no longer fails while it waits. It had mailed a failed
      "Deploy site" on every push since it landed — build fine, `deploy-pages`
      404 — so both jobs are now guarded on `has_pages` from the push payload
      (measured, not assumed: it arrives as `false`, not `null`). **Enable
      Pages and the next push deploys on its own; there is nothing to
      un-disable and no variable to set.**

      Worth stating plainly, since it now gates the launch: a 3D library whose
      pitch is *real geometry that bends* currently has no place to try it.
      `npm i paperlab` works; "see it move" does not.
- [ ] Product Hunt / launch posts. npm is live; the demo is not, and a
      launch post with nothing to click is the weaker half of this.

---

## The editor, structurally — *done 2026-08-22*

The review's finding was "the UX is a little bit messy", and the useful part
of it was the diagnosis: that is a **structure** problem, not a styling one.
A repaint would have left every cause in place. What shipped:

**Behaviors nominate their own signature params.** `Behavior.signature` names
the two or three options that ARE the behavior, in the order someone reaches
for them; the editor gives those full-width rows and folds the rest behind
"More". The schema still generates a control for every option — nothing is
removed, only ranked. A behavior that nominates nothing shows all of its
options flat, deliberately: **silence from a community behavior is not
permission to guess**, and a library that hides a param it was not told to
hide is worse than a long panel. All twelve built-ins nominate, and a test
holds them to 2–3 names that exist in their own schema. It also means the
control for `flight`'s three-slider wind vector is now one disclosure away
instead of being the first thing you meet.

**Undo / redo.** The reason to build it is not that people make mistakes — it
is that **without it nobody will touch a slider they do not understand**, and
most of this editor's controls are generated. Undo is what makes reading the
panel free.

It **observes the store rather than wrapping it** (`history.ts` subscribes;
no setter calls it). Threading a record call through each setter would be a
rule to remember for every future setter, and the failure mode of forgetting
once is that one action silently stops being undoable forever. What is in the
document: the paper, the field, the stage's space, and the mode you were in.
What is out: the transport — scrubbing a timeline is looking, not editing, and
a history full of playhead positions is a history you cannot use — plus which
chip is active and which slot is selected. Also out on purpose: **the user
preset library**, because an undo that silently un-saved someone's work is a
worse promise than not offering one.

Consecutive writes to the same leaf path inside 600ms collapse into one entry,
so a slider drag is one undo and not two hundred. The same diff that does the
collapsing also names the button: "Undo grain", not "Undo".

**The native `<select>` is gone.** It is the one control a page cannot style
below the button — the option list is drawn by the OS, in the OS's colours —
so on a dark canvas tool it was the loudest thing saying "internal build".
The replacement keeps the whole native keyboard contract (arrows, Home/End,
Enter/Space, Escape, Tab, typeahead) and is portaled to `<body>`, because both
inspector rails are `overflow-y: auto` and would otherwise clip it.

Two things that cost, and are worth knowing before replacing another native
control: the new trigger is a `<button>`, so **the Space shortcut for the
transport had to stop testing `tagName`** — it now asks `keys.ts`, one
predicate shared by every window-level shortcut, which also checks the ARIA
role. And a fixed-position popup is anchored to a rect captured once, so it
closes on scroll and resize rather than drifting away from its trigger.

Sliders stayed native `<input type="range">` — the keyboard and AT behaviour
are free there and the visual problem was solvable in CSS. They now draw a
filled track from a `--fill` custom property, because `accent-color` paints a
browser's slider, not this one's.

**Labels where there were none.** The states bar says what it is and what a
chip does; the transition duration and easing controls have names; the drop
zone folder explains what a drop zone is, groups each zone under its own id,
and its buttons read "Add a drop zone" and "Remove zone-1" rather than
"addZone" and "remove".

**The first-run panel became a coach-mark.** The old one was a four-line
legend in the corner: it said three other things at once, sat nowhere near
the blue dot it was describing, and the fastest way past it was the dismiss
button. It is now **one sentence, drawn touching the handle, gone the moment
the handle moves** — dismissal is driven by the drag itself, because a
coach-mark that survives the gesture it was teaching is only a label. The
old panel stayed as what it always really was: the reference behind "?".

This needed one new piece of public API. The handle rides the deformed
surface, so its position is a fact about the *frame* — nothing outside the
render can compute it from a UV. `PaperHandle.handlePoint(id?, target?)`
returns it in world space, and writes into `target` when given one so a
per-frame reader does not allocate.

**The FPS badge is off by default.** It was on in every dev build, which
means it was in every screenshot and every recording. `?stats` brings it back
where a frame budget is actually being read.

### Found while building this

**Adding a drop zone collapsed the folder you added it in.** `addZone` and
`removeZone` bumped `inspectorEpoch`, which remounts the inspector, which
resets every folder's open state — so the panel closed on the zone you had
just created. No remount was ever needed: the inspector derives the zone rows
from the store on every render, which `patchZone` had always relied on. Both
bumps removed. The surface toggles already carried a comment saying exactly
this; these two had simply never been held to it.

---

## Phase 07 — honesty — *done 2026-08-23*

The last thing above the launch gate, and the one where measuring first
changed what got built.

### Every app was a blank page for two seconds

Measured, not assumed: cold cache, throttled to slow 4G with a 4× CPU
penalty, **all three apps showed nothing at all until somewhere between 1.8
and 3.5 seconds.** No wordmark, no text, no sign that anything was coming.
Each is a single React bundle over a megabyte of three.js, and `#root` was
empty until it parsed.

Blank is worse than slow, because **a visitor cannot tell a heavy scene from
a broken link** — and it is the one thing this phase's done test names.

The fix is markup and inline CSS inside `#root`: on screen with the first
byte, no request, no JavaScript, and `createRoot().render()` replaces it on
mount so there is nothing to tear down. Content now paints at **400ms**
instead of 3.5s. The fade is held back 220ms on purpose, so a warm cache —
which mounts in well under that — never flashes it.

`apps/docs/src/firstPaint.test.ts` guards it, and guards the shape rather
than the words: present, **inside** `#root` (outside it React never clears it
and it covers the app forever), styled from the document head, carrying a
real sentence rather than a spinner, and delayed. It is exactly the kind of
thing that gets deleted while tidying an `index.html` — nothing in the build,
the types or the unit suite would notice, and it only shows up on a cold
cache on a slow connection, which is not how anyone develops.

### Mobile: three surfaces, three different answers

Lumping this into one decision was the mistake. It is three:

- **The docs were already fine.** Read on a phone, no changes needed.
- **The playground needed copy, not layout.** It rendered and scrolled
  correctly, and then told the visitor to *press the arrow keys* — the
  clearest possible signal that nobody had opened it on a phone. It now names
  the gesture the device actually has (`@media (pointer: coarse)`), the stage
  names scroll instead of being cut off, and the controls are thumb-sized.
- **The editor gets a screen that says so.** It is a three-rail canvas tool:
  at 390px the inspector is simply off the right-hand edge, the page scrolls
  sideways to a panel nobody knows is there, and the one gesture the tool is
  built around is a precise drag on a 12px target. **Broken with a message is
  acceptable; broken in silence is not.**

  Three things that gate has to do, in order: send them somewhere that works
  (the playground, which is genuinely good on a phone — telling someone to
  come back later without giving them anything to do now is how you lose
  them), say what the editor is so coming back sounds worth it, and **let
  them in anyway**. A hard wall is a lie about capability; the editor does
  run, it is just cramped. Shown by a media query rather than by measuring
  the window in JS: no resize listener, no first-paint flash, and rotating a
  tablet into landscape reveals the editor with no code involved.

### The README pass

Deferred here on purpose, because the stale claims kept moving while phases
landed. What was actually wrong:

- **It promised a walking figure, twice** — in the hero's alt text and in the
  stage bullet, which also listed "the figure" among the things that read the
  same walk. `showFigure` has defaulted to FALSE since phase 03.
- **The hero GIF predated the room.** It was rendered 2026-08-21, before the
  columns, the doorway, and the banner-typesetting fix — so the single
  most-seen image of this project showed `ca / rr / ie / d` down a banner in
  an empty hall. Re-rendered. It costs 0.7 MB more than the old one (2.7 →
  3.4 MB) and is worth it: the point of an honesty pass is that the picture
  is of the thing that ships.
- The stage bullet said nothing about the room, the doorway or the
  suspension hardware — all of which now exist and are the reason the mode
  reads at all.
- Nothing said the editor wants a desktop. It does, and now says so where it
  is linked.

**And the inventory in this file was wrong**: 10 behaviors (12), 13 presets
(15), 5 stage presets (6), 508 tests (671). `docsDrift` holds the *names* in
README / AGENTS / llms.txt to the registries in both directions, but **nothing
checks a number in prose**, so each of those had been wrong quietly for
weeks. A warning now sits beside them.

---

## The `drape` bug that was not one — *closed 2026-08-23*

**The open bug filed here on 2026-08-22 does not reproduce, and the way it
was wrong is worth more than the bug would have been.**

It said `drape` rendered an invisible sheet on the hero path, on the evidence
that a screenshot of it contained **exactly one colour** while the same frame
of `roll` contained 698. Re-run against every case it named — the reported
0.85 x 6.4 sheet, the ribbon stage's 1.05 x 9 banner, an explicit
`segments: 96`, a square sheet, and the option range at its extremes —
`drape` draws every time.

**Counting colours cannot tell an empty frame from one flat surface filling
it.** A tall drape at that scale is a nearly flat, nearly evenly lit white
plane edge to edge; a roll is a cylinder, so of course it has hundreds of
shades. The measurement answered a different question from the one being
asked, and the answer was read as if it had not.

What the report got right is the gap it named — *"a parity gate proves the
two implementations agree, not that either one draws"* — and that gap was
real. Both halves of `drape` could have returned zero forever and every test
in the repo would still have passed: `drape.test.ts` checks `displace` at
chosen uvs, parity checks CPU against GPU, and nothing checked that the
pipeline between them produces a surface.

`deformers/draws.test.ts` closes it. For every registered deformer, on an
ordinary sheet and on a tall banner, it builds the real geometry the way
`<PaperMesh>` does and asserts the sheet is finite, actually moved, still has
most of its area, and has unit normals to light. Verified to fail by
collapsing `drape` on purpose. **A new deformer cannot skip it** — the last
case asserts the table covers the registry.

---

## Phase 05 — the ribbon stage did not render what it is for — *fixed 2026-08-23*

The stage shipped and was never looked at closely enough. Four separate
defects, three of them in the same eight lines.

**The crease could not reach a right angle.** `foldAngle` was `62 + curl*46`
— 62° to 108°. A hinge turns through one angle and the pooled length holds
that heading from the crease onward, so **only a right angle is the floor**:
under it the pool keeps descending and goes through the ground, over it the
pool tilts back up and floats above it. The default (0.45) and the stage
preset's own value (0.34) were both under. The pool — the entire subject of
the stage — was inside the floor, and the frame showed flat strips stopping
dead at the ground. `foldAngle` is now exactly 90 and `curl` drives the
crease RADIUS, which is what its own description always claimed it did.

**And the crease was placed as if the hinge had no size.** It wraps a
cylinder of `radius / φ`, so the flap leaves it that much lower than the
crease line — measured at about 9cm below the floor on the stage's own
numbers. The crease now goes up by the hinge's own radius, because what has
to land on the floor is the pool; where the crease sits follows from that.

**It used `wave` where it meant `drape`**, working around the bug above that
does not exist. `wave` was never the same picture: a sine runs at one
amplitude end to end, and a hung strip is flat where it is held and gathers
as it falls — which is `falloff`, and it narrows as it gathers, which is
`gather`. Neither exists in `wave`.

**The type was a two-word label at the top of nine metres of blank paper.**
See below; the same bug had the whole stage set wrong.

---

## Banner typesetting was sized by the drop and never by the measure — *fixed 2026-08-23*

`bannerTextSize` chose a size to fill the DROP and never asked how wide the
banner was. On the ribbon stage's 1.05 x 9 strip — about 105px of measure
once the margins are off — a two-word column asked for 150px type, every word
came out wider than the sheet, `wrapLines` broke each one wherever the
measure ran out, and the column then overran the drop and was silently
clipped. The frame showed one enormous letter per strip.

Fixing the cap exposed the bigger thing underneath. **Every built-in stage
has fewer words than banners** — a nave of eighteen carries fifteen — so
nearly every column is a single word. The old code "filled" the drop by
shattering that word at arbitrary points: `carried` set as `ca / rr / ie / d`,
which is vertical and full-length and unreadable as a word, because the
break points were an accident of arithmetic rather than a decision.

Three changes, and the stages read as designed for the first time:

- **`letterColumn`** sets a single word one letter to a line, on purpose.
  It is a whole-rank decision (`words <= banners`), not a per-banner one —
  mixing letters and words at one shared size would always be wrong for one
  of them. `carried` now reads down its banner.
- **The measure caps the size**, so no word is ever broken by accident.
- **`valign: 'center'`.** One size is shared by the rank, so a short word
  necessarily leaves slack, and the slack belongs at both ends rather than
  all at the bottom.

**`splitAcrossBanners` also dropped banners.** It sliced at a fixed
`ceil(words / banners)` stride, so twenty words across twelve banners gave
TEN columns and two banners hung blank. It deals the words out now, odd ones
at the front.

**The ribbon stage got a passage instead of a caption.** The arithmetic is
worth keeping: a 1.05-wide strip holds ~105px of measure, which caps the type
near 26px, which means a column needs roughly twenty-six words to reach the
bottom of a nine-metre drop. Twelve strips wanted three hundred words; the
stage now runs eight strips and two hundred, with every word kept to seven
letters or fewer — because the measure is narrow and **one long word shrinks
the type on every banner in the room**.

---

## A generated slider handed an integer field a fraction — *fixed*

**Reported 2026-08-22 as "the app gets closed". It was a blank white page,
and the cause was one missing check in the control model.**

`schemaControls` built every numeric slider from two facts off the schema —
`min` and `max` — and derived its step as `(max - min) / 200`. It never read
zod's `.int()`. So the moment you touched `seed` on a colonnade, the editor
wrote `2.5` into a field declared `z.number().int()`.

Nothing warned. `<PaperStageScene>` re-parses its layout options **during
render** to place the walk's stops, and a parse does not warn about a
fraction where an integer belongs — it throws:

```
ZodError: Expected integer, received float — path: ["seed"]
  at PaperStage.tsx:368  (the `stops` memo)
```

A throw in render with nothing above it to catch unmounts the tree, which is
why the app appeared to close rather than to complain.

**Ten fields carried `.int()`** and every one of them was a loaded gun:
`seed` on pile, spill, accordion and colonnade, `seed` on crumple (behavior
and deformer), `rows` and `columns` on the sheet grid, `columns` on the rack,
`segments` on the sheet.

Fixed in the control model, so all ten are covered by one rule: an int field
gets `step: 1` **and** its emitted value is rounded. Both halves are load-
bearing — the step is what the slider snaps to, and the rounding is what
protects the readout you can type into, which clamps but never snaps.

**Then the same question was asked of the rest of the app: where else?**
Three answers, all now closed:

1. **`StatesBar` had written the schema walk a second time** — its own
   `min`/`max`/`step` extraction for the per-slot override sliders, missing
   `.int()` exactly like the first one. Live, and reproduced: a slot on
   `crumpled-note`, a state chip, drag `seed`, and
   `resolveFieldSlotConfig` re-parses the slot overrides during render into
   the same uncaught ZodError. Fixed by deleting the copy — both panels now
   read `numberSpec`, which is the only thing in the editor that reads a
   `z.ZodNumber`.
2. **Exclusive bounds.** `.positive()` is stored as `min: 0, inclusive:
   false` — the same shape as `.min(0)`, one boolean apart — and the reader
   took the value and dropped the boolean. That gives a slider whose far end
   is the one number the schema rejects. Latent rather than live (the two
   fields carrying it, `sheet.width` and `sheet.height`, are hand-built with
   a floor of 0.2), and now handled anyway: an excluded endpoint is moved in
   by a step.
3. **Hand-written control ranges drifting from their schemas** — the other
   way this bug could appear, since nineteen controls in the editor state
   their own min/max instead of reading one. Audited all nineteen against
   the schema behind them: every range sits inside its schema's. Clean, and
   worth re-checking whenever a schema bound moves.
4. **The same shape on the free-text side, and live.** Typing anything that
   is not a colour into a stage's `zenith` crashed the editor —
   `addColorStop` is one of the few canvas calls that **throws** rather than
   ignoring what it cannot parse, and the sky is built during render. Every
   colour in a stage is a text field, and a text field emits per keystroke,
   so the library is handed `#f` and `#ff` in the normal course of somebody
   typing `#ffaa22`. Three.js is the forgiving one — `new THREE.Color(…)`
   only warns — which is why the gradient was the only path that broke.
   `cssColorOr` now asks a canvas whether a string is a colour (the canvas's
   own opinion, not a regex — CSS colours are a bigger set than a regex
   should be trusted with) and falls back when it is not.

   Worth being explicit about why the fix is not "validate it in the
   schema": the text control emits on every keystroke, so a `.refine()`
   would reject `#f` and move the throw rather than remove it. **A value a
   person is halfway through typing is expected input**, and robustness
   belongs where it is consumed.

Two things found alongside it, both kept:

- **The editor had no error boundary at all.** Any render throw left a blank
  page with no message, and reloading walked straight back in whenever the
  cause was something the session restored. `CrashScreen` now shows the
  error, the component stack, a copy button, and a *forget the session and
  reload* escape. This is what turned an unreproducible report into a
  one-line diagnosis.
- **`App.resolvePresetByName` called `getPreset`, which throws** on an
  unregistered name, once per slot per render — so a single stale slot name
  took down the whole editor rather than one sheet. It now falls back to
  `photo-print`.

The rule worth keeping: **a schema is a contract in both directions.** Any UI
generated from one has to emit what that schema accepts, because the code
receiving it is entitled to parse strictly — and a strict parse inside a
render is an app-level crash, not a validation message.

---

## Observed once, not reproduced — a renderer crash under synthetic churn

**Seen 2026-08-22 by the audit harness, not by a person. Recorded so it is
not re-derived from scratch if it ever shows up for real.**

At the tail of a ten-minute scripted run — every slider in every mode, every
behavior and every layout, driven continuously in one page without a reload —
the browser tab died outright (Playwright `Target crashed`, which is a
renderer-process death, not the crash screen). It happened once, at
`field/spill`.

Three hypotheses, all tested and all **ruled out**:

- **Layout churn leaking.** 72 consecutive scene rebuilds: heap and listener
  counts rise and fall back (34 → 97 → 62 MB; listeners 273 → 1861 → 561).
  Sawtooth, not a ratchet.
- **WebGL contexts leaking on mode switch.** The obvious suspect, since
  `<Canvas key={mode}>` builds a fresh context every time and the console
  does print `THREE.WebGLRenderer: Context Lost`. 30 switches: exactly one
  such line per switch — r3f's expected teardown on unmount — canvas count
  steady at 4, heap flat at 34–45 MB.
- **The failing segment itself.** Every field layout × every slider, twice
  over, 154 drags in one page: survived, heap bounded and returning to
  ~54 MB between layouts.

So: not reproduced in isolation, and the current read is accumulated pressure
in a headless browser under a marathon no person would perform, rather than a
defect a user can reach. Two things worth carrying forward if it recurs:
`sheet` is by a distance the heaviest layout (223 MB peak against ~70 MB for
the rest), and the harness that found it lives in the session notes — the
reproduction is "drive everything for ten minutes without reloading".

---

## Callback props as effect dependencies — one fixed, two left

**Found 2026-08-22, chasing "the whole app freezes when I interact with
anything." The freeze is fixed; the pattern behind it is not gone.**

`<PaperStageScene>` reported its settled quality tier from an effect that
named the callback in its dependency list:

```tsx
useEffect(() => { onQualityChange?.(tier) }, [tier, onQualityChange])
```

The natural way to pass that prop is an inline arrow, which is a new function
on every render of the page above — so the effect fired on every consumer
render, not on every tier change. In the editor the consumer stores the tier,
which re-renders, which makes another arrow, which fires the effect again.
A notification had become a pump: **~6 App renders a second at rest in stage
mode**, each one a full `stageSchema.parse` and walk resample, which is why
every interaction felt frozen and why dragging the scrubber could take the
tab out with an out-of-memory crash.

Fixed by holding the callback in a ref and depending on `tier` alone, plus a
store-side guard so `patchStage` returns the *same* object for a patch that
changes nothing (`apps/editor/src/store.test.ts` covers the guard).

**What is left.** Two places still have the shape, neither of them a loop
today, both worth closing:

- `field/dropZones.tsx` — the registration effect names `onPlace`, so a
  consumer passing an inline handler re-registers the zone on every render.
  It bumps the registry version and re-renders every `DropZoneVisual`. Churn
  rather than a loop, because the effect's own component is not what the
  version change re-renders — which is luck, not design.
- `stage/PaperStage.tsx` — `stage` arrives as a fresh object literal from the
  editor, so `stageSchema.parse` and `getWalkPath` both re-run on every
  render. Harmless per render, and it was the reason each pump iteration cost
  as much as it did. Serialized deps, the way `PaperFieldMesh` already does
  it, would settle it.

The general rule this earned: **a callback prop is a notification, not a
dependency.** If an effect exists to tell the consumer something, it should
depend on the thing being told, and reach the callback through a ref.

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

### 3. Found in passing — closed, plus what they turned up

All four of the things found while building crumple are now closed. What
they turned into:

- ~~The README's capability lists drift, and nothing catches it.~~ **Closed.**
  Generating the lists would only move the hand-maintenance — each name
  carries a sentence of prose that no registry knows. What has to be true is
  that the *names* match, so `apps/docs/src/docsDrift.test.ts` asserts exactly
  that, both directions, across thirteen lists in `README.md`, `AGENTS.md` and
  `docs/llms.txt`: every registered behavior/preset/layout/stock/stage/idle
  name appears, and no listed name is unregistered. Verified against both
  failure modes — a dropped `crumple` and an invented `helix` — and it names
  the file and the entry when it fails.
- ~~Deformer exports are inconsistent.~~ **Closed, and this one is
  reversible on purpose.** `drape` and `crumple` (and the `crumple` behavior)
  are now exported like the other five. Nothing in the repo consumes any of
  them — they are purely public surface — so the alternative was removing all
  seven, which is breaking and belongs to the export trim below, not to a
  tidy-up. Consistent-now was chosen over smaller-now; when the trim happens,
  the deformer objects and their schemas go as **one group of seven**, not as
  a cleanup of an accident.
- ~~The docs site has no Deformers section.~~ **Closed.** All seven, live,
  with their schemas walked into parameter tables, plus what a raw
  `deformers` stack is for and why order matters.
- ~~Nobody has measured a field of crumples.~~ **Closed, and it corrected
  something we believed.** See below.

### ~~`segments: 'auto'` does not adapt to anything~~ — *done*

Found by building `pnpm perf:field` (`tools/field-perf.mjs` + the
`field.html` entry, same shape as the stage harness behind `pnpm perf`).

**The schema said `'auto'` "sizes the grid from the active deformers' needs".
It did not.** It gave the long side a flat 72 segments whatever was on the
sheet; a deformer's `minSegments` was only a floor and nothing ever lowered
it. So a blank sheet was tessellated exactly as finely as a crumpled one, and
`crumple`'s `minSegments: 72` — which the changeset first described as asking
for more geometry than anything else in the set — was a no-op unless a preset
hand-picked a coarser grid. The comment was corrected first; the behaviour
below.

Measured, at 20 papers in a ring (**SwiftShader**, which is what headless
Chromium actually runs — a weak-machine floor, not a GPU number):

| case | median frame | triangles/frame |
| --- | --- | --- |
| `typed-note` ×20, no deformer | 141 ms | 588k |
| `crumpled-note` ×20 | 204 ms | 657k |
| `typed-note` ×60 | 380 ms | 1.76M |
| `crumpled-note` ×60 | did not finish | — |

So crumple costs ~45% more per frame for ~12% more triangles: the price is
the shader (nine cell lookups per probe, three probes per vertex for the
normal), not the grid. **Nobody has run this on a real GPU** — headless
Chromium won't give one — so the absolute numbers are a floor and the ratio
is the useful part.

**Answered. `'auto'` now sizes the grid from the active deformers.**

The decision that unlocked it: `minSegments` is a correctness FLOOR, and what
`'auto'` needed is a quality TARGET — which has to depend on the options,
because a bend at `curvature: 0.05` and a roll at `radius: 0.02` are not the
same request and one constant per deformer cannot answer for both. Deformers
now declare `geometry.autoSegments(options, sheet)` beside their floor, and
six of the seven derive it from one formula: a mesh is a piecewise-linear
stand-in for a curved surface, the error is the sagitta `h²/8r`, and
inverting that turns "how many segments?" into arithmetic on the radius the
options imply.

The regression risk named above is handled by **calibration rather than
nerve**. At the old flat 72 the default `roll` already ran at a sagitta of
3.9e-4, so that is the tolerance: the tightest configuration in common use
keeps the density it ships with, and everything gentler stops overpaying. The
specific worry — "a `bend` at 16 segments is visibly faceted" — turns out to
be about tight bends: 16 is only handed out when the arc is gentle enough to
earn it, and a `curvature: 4` bend resolves to 48. Measured, not argued:
`core/tessellation.test.ts` compares the deformed chord midpoint against the
deformer's own answer at that midpoint for every edge of the resolved grid,
across each deformer's real option range, and proves the measure has teeth by
forcing a tight bend onto the coarsest grid and requiring it to fail.

**It subdivides both ways, which is the part worth remembering.** The first
version capped `'auto'` at the old 72 so it could only ever get cheaper. That
was the safe half, and it left the library's actual fidelity gap in place: a
`fold` at `radius: 0.04` wants 124 segments and a flat 72 cannot give it one
more. The ceiling is now **128**, and it is a measured CPU budget rather than
a round number — hero mode re-deforms every vertex in JS every frame for any
animated stack, and `wave` is animated, so a hanging poster pays it forever:

| grid | verts | ms per re-deform (`drape + wave`) |
| ---: | ---: | ---: |
| 72 | 3,796 | 0.67 |
| 128 | 11,868 | 2.05 |
| 192 | 26,634 | 4.53 |
| 256 | 47,288 | 7.89 |

256 is half a 60 fps frame on one sheet on a fast machine. 128 is the last
step with room for a scene around it.

Worth, in hero mode: `typed-note` and `blank-sheet` −99%, `photo-print` (the
field starter) −93%, `page-flip` −37%, `postage-stamp` −20% — against
`letter-fold` and `hanging-poster` at +217% and three others at +78–81%.
Across every preset, +24% triangles. In a field (`pnpm perf:field --soft`),
`typed-note` ×60 goes 261.5 ms → 37.8 ms a frame, 4 fps → 26, at 1.3% of the
triangles; `crumpled-note` is unchanged to the triangle.

**What is still open, and it is a smaller version of the same gap.** `wave` at
`amplitude: 0.3` asks for 272 and `drape` at its default depth asks for 154,
against the 128 ceiling. They are the two cases the faceting test still passes
on its "no worse than the flat 72 this replaced" clause rather than on
tolerance — the clause documents this gap rather than creating slack. Closing
it means buying CPU per frame at the rates in the table above, for presets
that pay it permanently. Worth revisiting if hero deformation ever moves off
the main thread, which would change the price and therefore the answer.

**A cap that had never actually applied, found on the way.**
`FIELD_SEGMENT_CAP` was a no-op for `'auto'` sheets in exactly the way
`minSegments` was: field mode capped the deformer floor at 48 and then
`'auto'` handed out 72 regardless. Making it cap the target as well looked
like the tidy fix and was a visual regression — it is the one thing that could
hold `crumple`, which has no target and only a floor of 72, down to 48 in a
field, coarser than the deformer says it needs to read as a crumple at all.
So the cap keeps its original and only job of capping the floor, and a
separate `FIELD_AUTO_CEILING` holds the field's target at the old 72 while the
hero ceiling rises to 128. The asymmetry is the point: a field draws that
buffer once per instance. **The lesson worth keeping is that "make the
existing policy actually apply" is not automatically a fix** — a cap nobody
had ever felt is a cap nobody had ever validated.

### ~~A grid is one number, and a sheet has two directions~~ — *done, 2026-08-21*

A performance pass that turned into a correctness one. Three findings, in the
order they were measured.

**1. `segments: 'auto'` asked along the direction a deformer curves and then
spread the answer by aspect ratio.** `segmentsForArc(spanAlong(sheet, angle),
r)` has always meant "this many segments along `angle`" — and `resolveSegments`
threw the direction away, distributed the number over the long edge, and gave
the short edge the remainder. On a square-ish sheet nobody could see it. On a
banner it is the whole picture: the stage's 1.5 × 8.5 banner is draped in folds
that run across its **width**, the arithmetic asks for 133 segments across, and
what it got was 48 across and 48 down a drop that needs eight.

A deformer now declares `geometry.axis(options, sheet)` beside its floor and
its target, and `axialSegments` projects the demand onto the sheet's two axes
by it (`width·|cos θ|·density`, `height·|sin θ|·density`). `stackMinSegments`
and `stackAutoSegments` return a pair; `resolveSegments` takes one. A bare
number still means what it always meant, so the exported helper answers an
unchanged call unchanged. `crumple` returns `null` — its creases run every way
at once — and keeps the aspect spread, which for it is the honest answer.

Every preset, before → after, with the chord error the faceting test measures:

| preset | grid | triangles | sagitta |
| --- | --- | --- | --- |
| `receipt-unroll` | 49×128 → 8×128 | 12,544 → 2,048 | unchanged |
| `letter-fold` | 91×128 → 8×128 | 23,296 → 2,048 | unchanged |
| `hanging-poster` | 91×128 → 24×96 | 23,296 → 4,608 | 2.8e-4 → 4.8e-4 |
| `page-flip` | 48×48 → 48×8 | 4,608 → 768 | unchanged |
| `photo-print` | 16×16 → 16×8 | 512 → 256 | unchanged |
| `postage-stamp` | 53×64 → 24×32 | 6,784 → 1,536 | unchanged |
| the stage banner | 48×128 → 128×8 | 12,288 → 2,048 | **5.3e-3 → 7.7e-4** |

The banner row is the one to read: six times fewer triangles **and seven times
less faceting**, because the density finally lands on the axis that bends.
Verified by rendering all six hero presets and both stage presets before and
after — indistinguishable.

**2. The quality tier's `segments` did nothing.** `<PaperStage>` wrote it
straight over the sheet's `segments` as a number. A number applies to both
axes; field mode caps it at `FIELD_SEGMENT_CAP` on the way down; and
`drape`'s floor of 48 raised it back on the way up. So `low`, `medium` and
`high` all drew the identical 48 × 48 banner — measured at 143,644 triangles
per frame whatever the tier said, while the file describing it called
subdivision "the biggest single cost and the easiest to scale". It is now a
`segmentCeiling` on what `'auto'` may ask for, which can lower the grid and
never raise it.

**3. The hero re-deform loop was half normals and half lookups.** Measured on
one `drape + wave` sheet at the 128 ceiling: 2.30 ms a frame, of which 1.44 ms
was `BufferGeometry.computeVertexNormals()`. `core/normals.ts` does the same
arithmetic over the typed arrays and is **bit-identical** to three's answer —
`core/normals.test.ts` asserts exact equality, not a tolerance — at about an
eighth of the cost. The deformer loop itself now runs one deformer over every
vertex rather than every deformer over one vertex, which puts a single
function behind the inner call site instead of a registry lookup and a
megamorphic call per vertex per deformer.

| grid | verts | was | now |
| ---: | ---: | ---: | ---: |
| 72 | 3,796 | 0.74 ms | 0.27 ms |
| 128 | 11,868 | 2.30 ms | 0.84 ms |
| 192 | 26,634 | 5.01 ms | 1.89 ms |
| 256 | 47,288 | 8.74 ms | 3.38 ms |

**What it bought, end to end** (`pnpm perf`):

| case | before | after |
| --- | --- | --- |
| nave, `high` | 86.8 ms · 12 fps | 79.1 ms · 13 fps |
| nave, `medium` | 65.8 ms · 15 fps | 51.0 ms · 20 fps |
| nave, `low` | 36.2 ms · 28 fps | 26.1 ms · 38 fps |
| archive (44 banners), `low` | 34.4 ms · 29 fps | 26.0 ms · 38 fps |

`high` barely moves because its ceiling keeps 72 across the folds and its
frame is dominated by the contact-shadow pass and dpr 2, neither of which this
touched.

**Read those as a software-rasterizer floor, not as frame rates.** `pnpm perf`
printed `renderer: native GPU` whenever `--soft` was absent — and it was
printing the flag it had been given, not the driver that answered. Asked
properly (`WEBGL_debug_renderer_info`, which `pnpm perf:field` had been
reporting all along), headless Chromium draws those cases through
**ANGLE/SwiftShader** whether `--soft` is passed or not. Both harnesses now
print what actually drew the frame.

### …and then it ran on a GPU, which answered two of the three

`--use-angle=metal --enable-gpu --ignore-gpu-blocklist` gets the real platform
renderer in headless Chromium. **`pnpm perf --gpu` / `pnpm perf:field --gpu`
now do that**, which closes a gap this file has carried since stage mode
landed: *nobody has ever run this on a real GPU.* Somebody has now.

On an Apple M4 Pro, every tier of every stage preset pins to the panel:

| load | frame | fps |
| --- | --- | --- |
| nave, `high`, 1280×800 | 8.3 ms | 120 (vsync) |
| nave, `high`, 2560×1600 at dpr 2 — **16 megapixels** | 8.3 ms | 120 (vsync) |
| archive, `high`, **120 banners** at 16 MPix | 8.4 ms | 119 |

Uncapped (`--disable-gpu-vsync`) the frame loop costs **0.1–0.3 ms**, which is
the JS side: the GPU never backpressures rAF, so the harness cannot resolve
the GPU cost at all. That is the finding. **The stage is not GPU-bound on real
hardware, by a margin too wide to measure this way.** `quality=auto` settles
on `high` there, where on SwiftShader it sinks to `low` — the ladder is doing
exactly its job.

Which retires two of the three open questions above, and it is worth being
plain that both were **artifacts of the rasterizer, not properties of the
scene**:

- ~~*A grid of slivers rasterizes worse than a grid of squares*~~ — 30% of a
  SwiftShader frame, and nothing measurable on Metal. Real: the shape still
  matters for the machines `low` exists for. Not real: as a reason to change
  how the grid is chosen.
- ~~*The studio environment map is a third of the stage frame*~~ — same
  story. A prefiltered cube lookup is exactly what a software rasterizer
  punishes and a GPU does not notice. **Do not spend a week on it.**

The honest shape of the whole thing: SwiftShader is the weak-machine floor and
worth designing against, but it over-reports fragment work by enough that
optimising *for it* would have bought nothing for anyone with a GPU. Anything
this file records from `pnpm perf` without `--gpu` should be read that way,
including everything above the line.

**Three things this leaves open, all measured rather than suspected:**

- ~~**A grid of slivers rasterizes worse than a grid of squares.**~~
  **Closed by the GPU run.** On SwiftShader, holding the triangle count
  *identical* and only swapping which axis carries the density costs 30% of
  the frame (48 × 8 → 51.0 ms, 8 × 48 → 36.0 ms). On Metal it is not
  measurable. Kept here because it is true of the rasterizer `low` is aimed
  at, and because "same triangle count, different cost" is worth knowing —
  but it is not a reason to choose the grid differently.
- ~~**The `AUTO_CEILING` of 128 is now cheap enough to raise.**~~ **Raised,
  and so were the two ceilings under it.** The measurement that decided it:
  after the axis split, *no shipped preset reaches even 128*, so the ceiling
  had stopped binding anything the library hands out — it only bound people
  asking for a tighter crease than any preset uses (`drape` at its own
  defaults wants 154, `roll`/`fold` at `radius: 0.02` want 175, `curl` at
  0.02 wants 142). And because a demand now lands on one axis, satisfying
  them costs ~0.02 ms rather than the 1.89 ms a square 192 grid implies.

  Three numbers moved:

  | | was | now | who feels it |
  | --- | --- | --- | --- |
  | `AUTO_CEILING` (hero) | 128 | **192** | hand-authored tight creases. No preset changes. |
  | `FIELD_AUTO_CEILING` | 72 | **128** | only a field with no `segmentCeiling`; the tiers cap themselves lower. |
  | `qualityTiers.high.segments` | 72 | **128** | the stage's folds, on machines that measured fast enough to earn them. |

  The third is the one you can see. A banner's drape asks for 133 across and
  had been getting 72 for every version of this file; at `high` it now gets
  128, and the sagitta on a banner goes 2e-3 → 7.7e-4 — the difference
  between fold highlights that step and fold highlights that roll.

  **What makes this safe rather than brave** is that the tier ladder is now a
  working lever, which it was not when 72 was chosen: `medium` (48) and `low`
  (28) cap themselves well under the new line and measure *identically* to
  before — 51.9 ms and 27.9 ms on SwiftShader, unchanged. Explicit `high`
  there costs 109 ms, up from 79, and no machine that cannot hold it is ever
  promoted to it. `quality=auto` still settles `low` on SwiftShader and
  `high` on Metal. Field presets are unaffected to the triangle
  (`pnpm perf:field` before and after: 34.5/69.2/219.0 ms against
  34.6/69.0/217.4).

  Still capped, and still honest: `wave` at `amplitude: 0.3` wants 272 and a
  16-fold `drape` at full depth wants 1377. `segments: <number>` remains the
  way past.

- **The quality ladder could pump, and now cannot.** Found while raising
  `high`: promotion needs 55 fps and demotion fires under 26, so any machine
  where the next tier up costs more than ~2.1× the current one satisfies both
  conditions forever — rising until it stalls, sinking until it is
  comfortable, changing the picture every few seconds. Not hypothetical:
  `high` measures 2.1× `medium` on a software rasterizer, and raising `high`
  is what put it there. The policy is now a pure `settleTier(tier, fps,
  failed)` in `quality.ts` — testable rather than watchable — and **a tier
  that has once failed is never offered again**, so the ladder can try the
  top exactly once and settle. The comment always said "a machine that cannot
  hold the floor should sink once and stay"; it is enforced now instead of
  hoped for.
- ~~**The studio environment map is a third of the stage frame.**~~
  **Closed by the GPU run.** 51.0 ms with it and 32.7 ms without at `medium`
  on SwiftShader; free on Metal. `low` already drops it for a hemisphere
  stand-in, and that is the whole of what needs doing about it.

### 4. Smaller things worth doing

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

### ~~Lighting is the only part of the engine that isn't data~~ — *mostly done*

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

**Done: the light is authorable, and the room lights the room.**

`stage.light` is a block of OVERRIDES on the named preset — exposure, key,
colour, direction, height, ambient, studio, haze — every field optional, so
a shared stage carries the sliders that were moved and nothing else. The
preset stayed the starting point rather than becoming a frozen copy, which
is also the shape the "Looks" entry below wanted. Direction and height are
**degrees around the room and degrees above the horizon**, not a position
vector: `lightAngles` / `lightPosition` are exact inverses, which is what
lets a slider read the resolved rig and write back one field without
drifting. The editor's Light panel is built by hand for exactly that reason —
an unset override has no value for a generated slider to show, so the
sliders show the RESOLVED number and touching one claims that field.

Three of the specific gaps above are closed:

- **An environment map exists** — `studio`. Procedurally built from the same
  three colours as the cyclorama (zenith, horizon, floor) plus a soft disc
  of the key's own colour where the key stands, prefiltered through PMREM.
  No HDRI, nothing fetched.
- **The surround dome lights the scene now**, which the entry called
  "probably the best single idea in here" and it was. The stage overrides
  the preset's `sky` with its own source colours, so the room you can see
  and the room that lights you are one thing.
- **Flat ambient stopped carrying the fill.** Every preset's `ambient` came
  down and the studio light took over. That is the whole difference between
  the figure reading as a cut-out and reading as a body.

**And it exposed a real bug, which is the reason the coupling constraint was
written down in the first place.** `translucencyValues()` reads the key
light's position so a sheet's backlit glow can never disagree with the lamp
casting its shadow — but it read it from *the paper's own* `scene.lighting`,
and no stage banner ever carried one. **Every banner in every stage computed
its glow from `studio`, a lamp up and to the right, while the hall was lit by
`nave` from behind.** The coupling was correct and the wire was missing. The
fix is a `<LightRig>` context: the scene publishes the rig it actually
resolved and the paper reads that in preference to its own name. It moves
four uniforms in place rather than rebuilding the program, so a slider drag
does not recompile a shader per frame.

**What it cost, measured** (`pnpm perf`, native GPU, nave at medium): 44ms →
68ms a frame, and a case was added to the harness so the trade stays visible.
It is the environment sampling in a scene with heavy overdraw, not the PMREM
build, which runs once per rig. `low` drops it for a hemisphere light instead
of nothing, so a weak machine still gets light with a top and a bottom;
`light.studio: 0` turns it off at any tier without moving the tier.

**Still open, and unchanged by any of this:** area lights, PCSS-style contact
hardening, shadow cascades over the whole walk, bounce, kelvin instead of hex,
and **more than one light** — which is still the hard one, because
transmission has to answer "which lamp is this sheet backlit by" the moment
there are two.

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

**Partly bought without post-processing**, and worth knowing before anyone
reaches for an EffectComposer. The source plane's falloff now runs from a
held core into a long tail, which is what bloom around an opening looks like
from the outside; `exposure` is a slider; and the nave prints a stop under so
the banners hold their folds instead of clipping to flat white. What is still
genuinely missing is a grade with a curve, real bloom on the highlights, and
a vignette.

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

### ~~Crumple — the missing primitive~~ — *done*

Shipped as the full vertical slice: the `crumple` deformer (JS + GLSL twin, 3
parity cases), a `crumple` behavior, and a `crumpled-note` preset. The docs
site picked up all three on its own, which was the point of building it that
way.

**The field took three attempts, and the two failures are the useful part.**
Three summed triangle waves: piecewise linear and cheap, but periodic — it
rendered as an egg-crate. Plain distance-to-nearest on a jittered grid
(Worley `F1`): irregular at last, but the cone tips are smooth, so it read as
hammered metal. What works is `F2 − F1` — the gap between the two nearest
cell points — signed per cell. That goes to zero on every cell boundary, so
the sheet stays continuous, and its gradient flips across one, which is a
crease. Irregular polygonal facets alternating toward and away from you.
**The lesson to keep: for anything meant to look creased, the test is not
"is the displacement right" but "does the gradient break where a crease
should be".**

Two things worth knowing before touching it:
- The hash is small-integer arithmetic (every product under 2^13, exact in
  float32 and in a double alike) rather than the usual `fract(sin(dot(…)) *
  43758.5)`. That one is not reproducible across CPU and GPU and would fail
  parity outright. Also: JS `%` is not GLSL `mod` for negative inputs, and
  half of every sheet is at a negative coordinate.
- `NORM` is calibrated against the measured peak of `F2 − F1` so `amount`
  means a peak-to-peak height. `crumple.test.ts` holds that bound across
  every seed and the whole `scale` range — change the jitter and it will tell
  you.

Still open: it asks for `minSegments: 72`, which makes it much the most
expensive deformer in field mode. Nobody has measured what a field of them
actually costs.

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

### ~~A figure with a body~~ — *done*

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

**Done, and the two things above are exactly what it turned on.**

`figure.model` exists now and takes a rigged glTF/GLB URL; the asset stays the
app's to host and never enters the npm tarball. The clip is scrubbed by
DISTANCE rather than played on a mixer clock, which was the part flagged above
as the bit that gets skipped — one gait cycle maps to one pass of the clip, and
`stride` syncs a given asset. It is cloned through `SkeletonUtils` (a plain
clone shares the skeleton, so two figures on one URL would drive each other),
scaled to `figure.height` off its own bounds, drawn as a silhouette, and
falls back to the capsules on any failure.

And the motion quality — the actual win, per the note above — went into the
procedural gait, so it lands whether or not anyone ever supplies an asset:
pelvis rotation, chest counter-rotation against it, lateral sway over the
stance foot, pelvic obliquity, elbows, and a real run with a Froude-derived
transition that moves with the figure's height. The bounce inverts between the
two gaits, which is the tell: a walk vaults and never rises above standing, a
run compresses and then leaves the ground.

**The licences are checked now, and the answer changes which source to use.**

- **Quaternius — CC0, and it ships glTF.** The pack pages link the CC0 deed
  directly. Note *which* pack: the Ultimate Animated Character Pack is
  Blend/FBX/OBJ only and would need a Blender pass, while the **Universal
  Animation Library** (1 and 2) ships GLB and glTF with root motion on the
  locomotion clips. That is the one to take. Downloads are itch/Patreon-gated,
  so a human has to fetch it.
- **Kenney — CC0**, same story, smaller and blockier characters.
- **Mixamo — no, and not for the usual reason.** The commercial terms are
  fine: royalty-free, any project. But the prohibited list includes, verbatim,
  *"Any type of free distribution of character or animation raw files"*, and
  that is exactly the shape of what we would do — `figure.model` is a URL, so
  the file has to be publicly served, and the plan puts it in the repo. For a
  closed web app, serving a Mixamo character to browsers is a grey area
  thousands of projects live in. An open repo with the raw file in the tree,
  whose whole purpose is that other people copy the pattern, is not that grey
  area. **CC0 is not merely more convenient here, it is the permission this
  architecture actually requires.** Mixamo is still fine as motion *reference*
  for tuning the numbers in `gait.ts`, since nothing ships.

**Verified against a real asset**, which is the part that mattered: pointing
`figure.model` at Khronos's `CesiumMan` loads, scales correctly against the
banners, silhouettes, casts its shadow and changes pose with `progress`. The
editor's stage harness takes `?model=<url>` and `?gait=walk|run`, so the path
is re-runnable against any URL without committing a binary. That exercise
found a bug that would have hit **every** model: the rig is scaled off its own
bounding box, and a freshly cloned scene has stale world matrices, so `Box3`
measured untransformed geometry and produced an enormous scale — the figure
filled the frame. Reading the code was never going to show that.

**An asset ships now, so the figure is a person.** All three apps point
`figure.model` at Khronos's Cesium Man (CC-BY 4.0, attributed in `NOTICE`),
served from each app's own `public/` and URL-built off `BASE_URL` so it
survives the `/editor/` and `/docs/` subpaths. Verified in all three: 200 on
the model, a person on screen, no console errors.

It is not the first pick aesthetically, and the reason is licensing rather
than taste. CC0 (Quaternius' Universal Animation Library, Kenney) would be
better and is gated behind itch/Patreon, so it cannot be fetched unattended;
Mixamo is out entirely. Cesium Man is the only properly-proportioned human
with a walk cycle that can be both obtained and lawfully redistributed.
**Swapping it is one file and one line** — if someone downloads a CC0 rig,
drop it in `apps/*/public/figure/` and the change is the filename.

Two limits: it carries a single unnamed clip, so `gait: 'run'` reuses the walk
(`pickClip` falls back rather than failing), and it is 438 KB including a
texture that never renders, since the figure is drawn as a silhouette.

**The CC0 blocker was wrong, and the figure is a Quaternius rig now.**
Quaternius' packs are gated behind itch and Patreon *on quaternius.com* — but
**poly.pizza mirrors them with direct, ungated GLB links**, which is the fact
the last pass was missing. So the asset is "Business Man" from the Ultimate
Modular Men Pack: CC0, properly proportioned, and carrying **twenty-four
named clips** including Walk, Run and Idle — which closes both of the limits
above. It has no textures at all, so the 1.5 MB is geometry and animation
rather than an image that never renders, and it is four skinned meshes on one
armature (the pack is modular), which `SkeletonUtils.clone` and a single
mixer on the root handle without a change. Measured: it costs nothing over
the single-mesh rig it replaced.

Three things came out of using it:

- **`pickClip` took the wrong clip.** `Man_Run` and `Man_RunningJump` both
  match `/run/i`, and it took the first — so a pack that happened to list the
  jump first would have put the figure into it for the length of the walk.
  It now takes the SHORTEST matching name, on the reasoning that the clip
  that IS the thing carries the least name around it.
- **A frozen figure stood mid-stride.** `frozen` sat the mixer at frame 0 of
  the walk, which is one leg out — and reduced motion, which is what freezes
  it, is exactly when nobody gets to see the next frame explain it. There is
  a `pickStillClip` now, and it stands.
- **`finish: 'silhouette' | 'shaded'`, defaulting to shaded.** The old entry
  said seeing the model meant a different lighting preset and was therefore a
  different idea. The studio light IS that idea, so it landed: the rig keeps
  its own materials and takes the room, which in a backlit hall is a rim down
  one edge and fill on the other. Measured at under 2ms — the seven materials
  on the rig cost far less than the environment that lights them.

**Two things still missing, recorded rather than fixed.** There is no facing
correction: the library documents that a model faces +Z at yaw 0, this asset
happens to, and the next one may not — a `figure.modelYaw` in degrees is the
obvious answer and it is one field. And twenty-one of the twenty-four clips
(gun poses, sword slash, rolls, four directions of run…) ride along unplayed;
pruning them needs a glTF rewriter (`@gltf-transform`) as a dev dependency.
At 1.5 MB for an app-hosted demo asset that is now worth costing out, where
at 583 KB it was not — recorded rather than done.

**One asset was tried and rejected, and the reason generalises.** Sketchfab's
"CC0 - Free Rigged Character" looks the part and cannot do the job: all three
of its clips are ZERO-DURATION single-keyframe poses, so it is a rig with no
motion in it, and `figure.model` would slide a T-pose down the aisle — worse
than the capsules it replaces. Its third clip is named `mixamo.com`, which
also puts the skeleton inside the licence this project already ruled out.
**Rigged is not animated**, and for this component the clip is the asset —
worth checking `animations[].duration` before anything else about a candidate.

**The boundary held and is now enforced rather than intended:** `pnpm pack` is
ten files with no `.glb`. The library ships no assets, no stage preset names a
URL, and anyone installing `paperlab` gets the capsules and brings their own
model.

**One invariant was narrowed to get here** and it is worth knowing about: the
gait promised "same ground covered = same pose, whatever pace", and now
promises it *within a gait*, since crossing into a run changes the stride. The
old wording was never quite true — `lean` has always read `speed`.

### ~~A stage you can only watch~~ — *done*

For anyone who opened one. Stage mode had exactly one input — `progress` —
and if nobody supplied it the walk ran on a clock. There was nothing to
touch: no drag, no wheel, no keyboard, no way to stop in front of a banner
and read it. Field mode has had `motion={{ driver }}` since it shipped, and
the stage — the mode most likely to be somebody's whole homepage — had
nothing.

**Done, as the same contract a field uses.** `motion={{ driver, speed,
capture }}` with the same three driver names, defaulting to `drag`: pointer
with inertia, wheel, arrow keys, and clicking a paper to travel to it.

Four things it turned up that are worth keeping:

- **One driver, not two.** `drag` DRIFTS on the clock until the first touch
  and is the viewer's from then on. Splitting that into "autoplay" and
  "interactive" makes both halves wrong: a stage that only autoplays cannot
  be touched, and one that only waits opens as a still photograph of itself.
- **The stops have to come from the layout.** `Layout.walkStops(n, o)` is
  optional and only a layout that arranges along a path can answer it;
  `colonnade` computes it from the same helper `pose` places banners with,
  because a stop that is not where the paper is would be a navigation that
  misses everything it aims at.
- **`capture` is a real axis, not a detail.** A full-bleed stage IS the page
  and should take the wheel; a 340px card in a column of prose that eats a
  reader's scroll and traps a finger on a phone is hostile. The docs cards
  set `capture: false` and stay draggable and steppable. Even when captured,
  the wheel is handed back at the ends of an open walk.
- **A drag is not a click.** Letting go over a banner fired its click handler
  and teleported you to whatever was under the cursor when you stopped
  pulling. Five pixels of slop settles it.

**It needed a browser to test, so it got one.** `pnpm test:drive` drives a
real canvas — drift, drag, flick, wheel, arrow keys, click, and a controlled
stage refusing all of it — and is in CI beside the parity gate. It earned its
keep immediately: it caught the raycast prop being set to `undefined` rather
than left alone, which silently disabled every click.

And it caught the check itself being wrong in an instructive way. `count` is
a REQUEST: the text is split one column per banner, so a fifteen-word line
against `count: 18` renders fifteen banners, and the stops correctly follow
the fifteen. Worth knowing before debugging a stage that has fewer banners
than it was asked for.

**Still open:** there is no snap-on-release — letting go mid-aisle leaves you
mid-aisle, which is right for a walk and arguably wrong for a gallery, and
`nearestStop` is written and unused against the day someone wants the other
behaviour. There is also no touch-flick velocity separate from the mouse's,
and no way to name a banner in the URL so a link opens standing in front of
it — which is the obvious next thing the playground wants.

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

### Direct manipulation, past the one blue dot

The chrome was re-cut to a design language in phase 08 (`docs/design.md`) and
the camera got a visible cluster at the foot of the viewport. Two gestures
belong in that cluster and are not there, because a button that toggles
nothing is worse than an absent one. Both need library work first.

**A handle per signature param.** `HandleSpec` already exists and is already
generic, and `Behavior.signature` already names the two or three options that
ARE each behaviour. But only four behaviours declare handles — `peel`,
`unroll`, `flip`, `letter-fold` — and the other eight (`hang`, `fly`, `fall`,
`carry`, `flight`, `crumple`, `settle`, `ribbon`) have no direct manipulation
at all. `ViewportGuide` admits it in its own fallback copy: *"press Space to
play the fall"*. That is not a gesture, it is an apology.

The work is authoring handles, not building a system: an anchor in UV space
and a drag that writes back to options, per nominated param. The payoff is
that the editor stops being a panel of sliders next to a picture and starts
being a thing you touch.

**Dragging the key light.** Paper sells on grazing light, and today finding a
good angle means cycling eight lighting presets and hoping. The gesture is
obvious — pick the light tool, drag the room — but `PaperLighting` takes a
preset name, not an angle, so there is nothing to write to. This is the same
piece of work as *"Lighting is the only part of the engine that isn't data"*
below, and it is the best argument for doing it.

**What a Blender-style gizmo would be wrong for.** The sheet IS the scene, so
there is no object transform worth a move/rotate/scale widget. Everything
worth manipulating belongs to the deformer, which is why the two entries above
are the whole list.

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
anyone who wants them. The eight lighting presets become the first eight looks
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
