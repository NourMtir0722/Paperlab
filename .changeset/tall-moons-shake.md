---
'paperlab': patch
---

Hand the WebGL context back when a canvas unmounts.

A browser allows a page about sixteen live WebGL contexts and then starts
killing the oldest. React Three Fiber disposes the renderer's own resources on
unmount, but the drawing context itself survives until the garbage collector
reaches the canvas — so anything that mounts and unmounts paper as it scrolls
exhausts the ceiling with contexts belonging to sheets that are no longer on
screen. `<Paper>`, `<PaperField>` and `<PaperStage>` now release the context
explicitly. Measured on the reference page: one scroll to the bottom went from
101 "Too many active WebGL contexts" warnings to none, at an unchanged peak of
thirteen simultaneous canvases.
