---
'paperlab': patch
---

Mark the interactive drag handle as chrome, so a renderer producing a picture
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
