---
"paperlab": minor
---

A content type for the things paper actually gets cut into, real typesetting controls, and no preset touches the network any more.

### `card` — the paper-artifact type

One composition — a tracked label, a hairline rule, a body, a line of small print — covering the index card, the library due-date card, the museum wall label, the telegram slip and the gallery quote sheet, because those are the same object with different parts present.

It exists because `text` could not make any of them. `text` sets a block of prose in one size and one weight; every artifact above is a *hierarchy*, and composing one out of plain text meant hand-placing newlines and hoping. The proportions inside `paintCard` are ratios of the body size rather than numbers, so a card scales as a card instead of as a paragraph that grew, and the whole block is measured before anything is drawn so it can sit optically centred — a card whose type hangs from the top edge reads as a page that got cropped.

Held to the receipt's standard deliberately. The receipt has been the only content type in this library anybody art-directed; everything else went through one `fillText` loop in the system serif.

### `text` gained `tracking` and `valign`

Tracking is the control display type cannot do without: a line set to be read across a room needs it pulled in, small uppercase needs it pushed out, and neither is reachable by changing the size. It is applied **before** measuring, because `measureText` honours `letterSpacing` and wrapping against the untracked width breaks lines to a measure the painted line does not have.

`valign: 'center'` optically centres the block rather than hanging it from the top edge — what a label or a poster wants, where `top` is what a letter wants because a letter starts at the top of the page. Both default to the old behaviour.

### Line breaking is shared, and it no longer lets type leave the sheet

`wrapLines` is one module now rather than a loop about to be copied into a second painter — two copies of a line-breaker is two answers to "where does this wrap", and on a sheet that CURLS the reader sees the break land on a fold.

**It also fixes a real bug.** The old loop appended a word whenever the line was empty, on the reasonable theory that one word always fits. A long URL or a compound on a narrow banner does not, and it ran off the edge of the sheet with nothing to stop it. A sheet is a physical object: type that leaves it has left it. Over-long words are now broken to the measure, and a blank line survives as a paragraph break instead of collapsing.

### Fonts are requested by name

`document.fonts.ready` — which this library already awaited — resolves when the fonts the *document* requested have settled. A family named only inside a canvas `ctx.font` string was never requested by anything, so on a page where no DOM element uses it, `ready` resolves immediately and the sheet paints in the fallback: Times where the preset says Playfair, silently and only sometimes. `ensureFont` calls `document.fonts.load()` for the face the content actually names before painting. Failures are swallowed on purpose — a font that will not load is a fallback, not an exception.

### No built-in preset touches the network

**All four** of the presets that fetched Unsplash are fixed, not the two originally counted.

- `hero-peel` and `hanging-poster` were demonstrating a *behaviour*; the photograph was incidental. They are typeset now — `hanging-poster` is a real poster, which is what every paper installation worth the name hangs.
- `photo-print` and `postage-stamp` are **containers for the caller's own art**, and their whole documented use is `<PaperField images={photos} preset="photo-print" />`. `image.src` now defaults to empty, and empty renders as bare stock rather than as a failure. An image that fails to load falls back the same way instead of leaving the sheet with no texture at all.

A live third-party fetch inside the first thing a new user renders fails offline, behind a corporate proxy, under a strict CSP, and on the day the URL changes.

### The Field composer's default is paper

The demo pool was eight HSL gradient tiles with a translucent white disc on each — the right instinct (procedural, offline, nothing to leak) attached to the wrong art direction, and the single most damaging screenshot in the product: a library about paper greeting every visitor who clicked **Field** with a carousel of app-icon swatches.

It is eight `card` artifacts now — a mill specimen, a due-date card, a telegram, a catalogue label, an index card, a ticket stub, a note, an archive label — and the default population is `blank-sheet` rather than `photo-print`, because a museum label printed on gloss photo stock is the wrong material. They are content rather than images, so they are not photographs *of* paper: they are typeset by the same painter that sets every other sheet, on the slot's own stock, and they curl with the mesh.

### Three parsed-vs-input type slips, found by adding two fields

Adding `tracking` and `valign` broke the build in three places that had been quietly wrong: `PaperStage`'s banner literal asserted `satisfies ContentConfig`, and `FieldPaperSlot.content` and the a11y mirror both took the *parsed* type. `z.infer` is the config with every default filled in; `z.input` is what a caller may write. A literal a human types is by definition the input type, and demanding the parsed one turns a two-line content object into a type error — the exact failure `config/props.test.ts` exists to catch on the props. `FieldPaperSlot.content` takes `ContentConfigInput` and is parsed internally.

Worth noting how they were found: they only surfaced because the schema grew. Each was a tripwire on the schema rather than a check on the object, and they had all been passing by coincidence.

### The docs' stock grid is a specimen sheet

Every stock now renders as a `card` under the new `raking` key — the light a paper merchant photographs a swatch book under. It skims across the sheet instead of landing on it, which is the only way a stock's own character reads as material rather than as tint.

`cardContentSchema`, `CardContent` and `wrapLines` are exported.
