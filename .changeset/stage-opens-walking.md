---
"@paperlab/playground": patch
"@paperlab/editor": patch
"@paperlab/docs": patch
---

The editor's Stage tab opens walking, and all three apps hand the walk to the visitor.

The Stage tab opened paused at 42% along the walk with the scrubber disabled until you found the play button, so the first thing anyone saw of the mode was a still photograph of it. It plays on open, and touching the scrubber takes over — which is how the Paper tab's timeline has always behaved, and there was no reason this one did not.

The playground drops its own requestAnimationFrame clock and its own `% 1`. Both existed because an autoplaying walk used to run off the end of an open path; it wraps now, and handing the walk back to the scene is what lets a visitor drag it, since a page writing `progress` every frame is a controlled component that no driver may touch. Its scrubber follows the walk through `onProgress` writing to the input directly, so tracking the position costs no re-renders.

The docs' stage cards are draggable and arrow-steppable but set `motion={{ capture: false }}`: five of them sit in a scrolling column, and a card that eats a reader's scroll on the way past is hostile.

The stage harness gained `?drive=1`, which lets go of `progress` — the only way anything can exercise the viewer driving the walk, since a controlled stage never listens — and reports the live position and the last visited paper on `window.__STAGE__` for `pnpm test:drive` to read.
