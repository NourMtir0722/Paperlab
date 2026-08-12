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
- **363 tests** + a 27-case GPU/CPU parity gate, all green in CI.

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

### 2. A human documentation site

`llms.txt` and `AGENTS.md` are excellent *for machines*. There is no
human-readable API reference — a person evaluating the library reads the README
and then falls off a cliff. Probably the highest-value thing after launch.

### 3. Smaller things worth doing

- **Trim the public API** before 1.0 (see Decisions above).
- **The `field-ring` hero asset** shows the blank backs of the far sheets. It's
  physically correct, but a distinct image per sheet would read better.
- **The editor remembers nothing between sessions** — reopening it drops you on
  the default preset even if you have saved papers. A "last opened" memory is
  small and would make it feel like a tool rather than a demo.

---

## Ideas parking lot

Nothing here is committed — it's a place to put things so they aren't lost.
Add freely; we'll sort later.

*(empty — Noor has more to add in a future conversation)*

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
