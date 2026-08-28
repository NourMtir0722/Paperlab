---
'paperlab': patch
---

Stage mode's source no longer speckles green in Safari. The glow plane faded
through its alpha channel, and a 2D canvas stores premultiplied pixels — so
uploading it un-premultiplied made the browser divide the colour back out,
which along the near-transparent tail amplified 8-bit rounding into off-hue
texels. WebKit's rounding made those visible as a drift of green dots across
the far wall. The falloff is now premultiplied into the colour on an opaque
texture and added to the room, which is also the more honest model of a light.
