---
'paperlab': patch
---

Fix `diffConfig` throwing away everything in a scene except `lighting`.

It read `if (config.scene.lighting !== 'studio') out.scene = { lighting }`,
which was true while `lighting` was the only thing a scene had — and silently
discarded every field added beside it. So a hand-tuned light rig, and now a
backdrop, were shown by the editor and carried by nothing that left it: not a
`.paper` file, not a share link, not a JSX snippet or an agent payload.

The scene is diffed like every other branch of the config now, and a test
round-trips it: what the diff emits parses back to what went in.

Code exports also stop pasting uploaded pictures into source. An upload is a
data URL of a hundred kilobytes and up, and there are two places one can now
be — the sheet's content and the backdrop behind it. A snippet gets a numbered
path in the same position and a line saying so; a referenced URL is untouched.
The `.paper` file and the share link still carry the real bytes, because a file
has room for them and dropping them there would lose the artwork rather than
reformat it.
