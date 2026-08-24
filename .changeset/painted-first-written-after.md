---
'paperlab': minor
---

Watercolour washes: `washSchema`, a `wash` field on every content type, and a
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
