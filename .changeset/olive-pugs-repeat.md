---
'paperlab': patch
---

Stop the stage agent brief promising a figure that is not there.

`showFigure` defaults to false and every built-in stage preset leaves it
there, so the common export is a camera moving through an empty hall.
`describeStage` already knew that and withheld the "a small dark figure
walking between them" clause — but the payload's opening sentence claimed
"with a figure walking through it" unconditionally, and the scroll clause was
gated on `scroll` rather than on the figure, so it promised "scrolling the
page walks the figure deeper into it" as well. Both now follow the figure, and
the scroll clause names the camera when there is nobody to walk.

This matters because the brief's description is the acceptance test a
receiving agent checks the render against: a figure named there is a figure it
goes looking for, and the library ships no assets — a figure is always the
caller's own model on the caller's own URL.
