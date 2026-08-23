# The look — Paperlab's design language

> The single source of truth for what the three apps look like. The token
> block below is **duplicated verbatim** into `apps/editor/src/styles.css`,
> `apps/playground/src/styles.css` and `apps/docs/src/styles.css`, and
> `apps/docs/src/designSystem.test.ts` fails if the three copies drift apart or
> if any rule on this page is broken. Change the language here first, then in
> the three stylesheets, and let the test tell you which one you missed.
>
> Adopted 2026-08-23. Direction: **Graphite Showroom**, with the three
> amendments below.

---

## The argument in one paragraph

The most beautiful thing Paperlab has is a lit sheet of paper. Everything else
on screen exists to get out of its way. So the chrome is a dark, near-silent
room: no borders, no gradients, no coloured buttons, hierarchy carried by one
white at stepped opacities, and a chroma budget so small it buys exactly one
element — the grab handle on the sheet. The product is the artwork, and the
frame is a frame.

The failure mode is precise and worth naming: **this library's whole claim is
that its paper is real geometry rather than a CSS trick.** A chrome built out
of simulated glass, gradients and glows is a CSS trick sitting three inches
from the one real material on the screen, and the user makes that comparison
every time they look away from the canvas. That is why the glass rule below is
a rule and not a preference.

---

## Showroom or machine

The style's own decision procedure, and it maps onto this repo's apps without
adaptation.

| register | what it is | where it lives |
| --- | --- | --- |
| **showroom** | sparse, one object per screen, enormous negative space, a single display sentence | `apps/playground`, the `apps/docs` landing |
| **machine** | dense, tight rhythm, many small labels, real working data — density IS the proof of capability | `apps/editor`, the `apps/docs` catalogue |

The showroom stays sparse *so that* the machine can be dense. Neither layer
borrows the other's density. A display sentence in the editor is a banner; a
parameter table on the playground is a settings screen.

---

## The tokens

```css
:root {
  color-scheme: dark;

  /* Plate. Depth is a step on this ladder, never a drop shadow. */
  --l0: #08090a;
  --l1: #0b0c0d;
  --l2: #0c0d0e;
  --l3: #141517;

  /* The room. Chroma 0, and it stays there: a cool surround pushes warm
     paper yellow, and this is the one band next to a colour being judged. */
  --room: #171717;
  --room-stage: #0b0b0b;
  --room-bezel: #121212;

  /* One white, stepped. Hierarchy is a step, never a hue. */
  --ink: rgba(255, 255, 255, 0.95);
  --ink-2: rgba(255, 255, 255, 0.75);
  --ink-body: rgba(255, 255, 255, 0.55);
  --ink-meta: rgba(255, 255, 255, 0.35);
  --ink-faint: rgba(255, 255, 255, 0.2);

  /* Lift. A surface comes forward by brightening, not by casting. */
  --lift: rgba(255, 255, 255, 0.04);
  --lift-2: rgba(255, 255, 255, 0.07);
  --lift-3: rgba(255, 255, 255, 0.11);
  --hair: rgba(255, 255, 255, 0.07);
  --hair-2: rgba(255, 255, 255, 0.1);

  /* The one floating material. Nothing docked to an edge may wear it.
     It is DARKER than the room rather than lighter, which looks backwards
     next to the "brighten to come forward" ladder and is not: a floating
     control passes over the paper, and the paper is the brightest thing on
     screen. A white-tinted glass over a white sheet is a white bar with
     invisible icons on it. Carrying its own dark ground is the only way it
     stays legible over both the room and the artwork. */
  --glass-fill: rgba(14, 14, 16, 0.72);
  --glass-shadow: 0 16px 44px rgba(0, 0, 0, 0.55);

  /* The chroma budget, spent. --grab is the grab point on the sheet and
     nothing else; --alarm is destruction and failure, the one exception. */
  --grab: #4f7cff;
  --grab-glow: rgba(79, 124, 255, 0.25);
  --alarm: #e2726e;

  /* Brand actions invert luminance rather than taking a hue. */
  --pill: #f4f4f4;

  --font: "Inter", ui-sans-serif, system-ui, -apple-system, sans-serif;
  --mono: ui-monospace, SFMono-Regular, Menlo, monospace;

  --r-md: 8px;
  --r-lg: 12px;
  --r-xl: 16px;
  --ease: cubic-bezier(0.22, 0.61, 0.36, 1);
  --fast: 120ms;
}
```

### Why `--ink-meta` is not for labels

White at 35% over `--l1` is about 4.2:1 — under AA for body text. It is fine
for genuinely ambient text (a timestamp, a count, a unit suffix) and wrong for
anything a user reads in order to operate a control. Control labels are
`--ink-body`. This is the one place the ramp is a legibility decision rather
than a hierarchy one.

---

## The rules

1. **No pure black, no pure white.** Everything inside the ramp. The one white
   pill (`Export`) is the exception, below.
2. **Depth is a tint step, not a shadow.** To bring a surface forward, brighten
   it. Shadows exist only under things that *float* — menus, dialogs, the tool
   cluster — never under docked chrome.
3. **No stroke above `--hair-2`.** Hairlines are lighting, not borders.
   Anything heavier reads as wireframe, which is what the old shell looked
   like.
4. **Chroma only for state.** Emphasis gets a brighter step, never a hue. The
   budget is spent on `--grab` and `--alarm` and there is nothing left.
5. **Brand actions invert luminance.** The primary action on a screen is a
   white pill with black text — never a coloured button. There is at most one
   per screen.
6. **Motion is opacity-led.** Hover is a luminance step. Nothing bounces,
   nothing overshoots, nothing slides. The camera is the one thing allowed to
   travel, and it eases out.
7. **No imagery except the product itself.** No illustration, no photography,
   no abstract 3D. Every picture in these apps is a render of a sheet.
8. **One display sentence per band, showroom only.** The editor has no bands.

---

## The three amendments

Graphite Showroom is the parent. These are where it bends for a paper tool,
and they are deliberately few — a style that needs five amendments is the
wrong style.

### 1 · Glass floats, plate docks

The parent says *"no shadows for elevation, depth is a tint step."* That holds
for everything anchored to an edge. It does not hold for surfaces that float
**over the live viewport**, because those are the only surfaces in the app with
something genuinely behind them to transmit — and what they transmit is real
geometry, not a page background. Glass over the sheet shows a real material.
Glass over a sidebar is pure effect, and pure effect is the thing this product
exists to argue against.

So there is exactly **one glass recipe** per app — a single rule listing every
surface allowed to wear it — and a surface only gets on that list by floating
over the canvas. The rule is enforced by counting: `backdrop-filter: blur(`
may appear **at most twice** in a stylesheet, once for the recipe and once for
the modal scrim, which is a different job. A third one is how this style turns
into every other translucent editor, so the test fails on it.

In the editor the list is `.view-cluster, .viewport-guide, .guide-toggle`. In
the playground — where the whole app is chrome floating over a live scene — it
is `.wordmark, button, textarea`. The docs have no glass at all, because
nothing on that page floats over anything.

Every glass surface degrades to opaque `--l3` under
`prefers-reduced-transparency: reduce`.

### 2 · The band around the viewport is exactly achromatic

The parent specifies *"achromatic with a faint cool cast."* That cast is a fine
identity decision for the shell and a colour-management bug in the ring around
the canvas: a cool grey surround pushes warm-white paper toward yellow by
simultaneous contrast, and this is the one band in the app whose neighbour is a
colour the user is judging.

`--room`, `--room-stage` and `--room-bezel` are therefore pure greys
(`r === g === b`) and the test asserts it. The cast is permitted further out,
in `--l0`–`--l3`.

### 3 · The accent is the grab point, and nothing else

The old shell spent `#4f7cff` on scrubber fills, selected presets, focus rings,
the export button, toggle tracks and hover borders — six jobs, which is the
same as no job. Under rule 4 the budget buys one thing, and it buys the
**handle on the sheet**: the dot you drag to peel a corner, its coach-mark, and
its tether. That is genuinely a state marker — it means *this is the part you
can pull* — and a single saturated dot on a white sheet in a dark room reads
from across the room, which is what the accent was supposed to buy in the first
place.

`--alarm` is the one further exception, reserved for destruction and failure.
Losing red on a delete confirmation costs more than the discipline buys.

---

## What the test checks

`apps/docs/src/designSystem.test.ts`:

- the token block is byte-identical in all three stylesheets;
- `--room*` values are pure greys;
- `backdrop-filter: blur(` appears at most twice per stylesheet;
- every hex colour in every stylesheet is either achromatic, a paper tone, or
  one of the two budgeted accents — so a green "saved" pill fails CI rather
  than fails review.

When it fails it names the file and the offending value. That is the point:
the discipline is the expensive part of this style, and the parent's own notes
say so — *"cheap to build, demanding to hold."*
