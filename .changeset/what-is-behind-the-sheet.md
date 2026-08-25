---
'paperlab': minor
---

Backdrops: `scene.backdrop`, and `<PaperBackdrop>` to render one.

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
