---
'paperlab': patch
---

Stop the generated scroll component shipping a comment about a figure that is
not in the scene.

The stage brief's figure claims were gated on `showFigure`, but the comment
baked into the generated component source was not — so a scroll export planted
`// Scroll the section, walk the figure.` in the receiver's own file whether or
not one was drawn. `showFigure` is off by default and every built-in stage
preset leaves it there. It now names the camera when nobody is walking.
