---
"paperlab": patch
---

Four crashes, one shape: a value reaching a strict parse from inside a render.

The report was "when I interact with anything the whole app freezes", then "whenever I try to manage speed the app gets closed". Both were real, neither was what it sounded like, and the second one turned out to be a class rather than a bug.

### The freeze: a notification that had become a pump

`<PaperStageScene>` reported its settled quality tier from an effect that named the callback in its own dependency list. The natural way to pass that prop is an inline arrow, which is a new function on every render of the page above — so the effect fired on every **consumer render**, not on every tier change. The consumer stores the tier, which re-renders, which makes another arrow, which fires the effect again.

Measured at ~6 App renders a second at rest in stage mode, each one a full `stageSchema.parse` and walk resample. That is why every interaction felt frozen, and why dragging the scrubber could take the tab out with an out-of-memory crash. The callback now lives in a ref and the effect depends on `tier` alone.

The general rule, since it is not specific to this prop: **a callback prop is a notification, not a dependency.** If an effect exists to tell the consumer something, it depends on the thing being told and reaches the callback through a ref.

### The crash: `.int()`, and everywhere else the same shape hid

The editor's generated sliders took two facts off a schema — `min` and `max` — and derived a step of `(max - min) / 200`. They never read `.int()`. So touching `seed` on a colonnade wrote `2.5` into a field declared `z.number().int()`, and `<PaperStageScene>` re-parses its layout options **during render** to place the walk's stops. A strict parse does not warn about a fraction; it throws, inside a render, which unmounts the tree.

Ten fields across the library carry `.int()`. Fixed once, in the control model: an int field gets `step: 1` **and** its emitted value is rounded, because the readout you can type into clamps but never snaps.

Asking where else that shape hid found three more:

- **A second copy of the schema walk** in the editor's states bar, missing `.int()` in exactly the same way, crashing through a different parse (`resolveFieldSlotConfig`, also during render). Fixed by deleting the copy — there is now one reader of a `z.ZodNumber`.
- **Exclusive bounds.** `.positive()` is stored as `min: 0, inclusive: false` — one boolean away from `.min(0)` — and reading the value while dropping the boolean gives a slider whose end is the one number the schema rejects. Latent; handled anyway.
- **The same shape on the text side, and live.** A stage's sky colours are text fields, and a text field emits per keystroke, so the library is handed `#f` and `#ff` while somebody types `#ffaa22`. `addColorStop` is one of the few canvas calls that *throws* rather than ignoring what it cannot parse, and the sky is built during render. Three.js is the forgiving one, which is why the gradient was the only path that broke. `cssColorOr` now asks a canvas whether a string is a colour — the canvas's own opinion rather than a regex, because CSS colours are a larger set than a regex should be trusted with.

The rule worth keeping: **a schema is a contract in both directions.** Anything generated from one has to emit what that schema accepts, because the code receiving it is entitled to parse strictly — and a strict parse inside a render is an app-level crash, not a validation message.

### Also: dependency arrays are evaluated every render

`PaperFieldMesh`, `FitCamera`, `useContentAtlas` and the resolved-config memo all used `JSON.stringify` as a memo dependency. A dependency array is evaluated on **every** render, so the serialization was paid every render whether or not anything changed — and paid in garbage rather than in time. A field of fourteen photographs re-serialized roughly seventeen megabytes per render, because an image slot carries its bitmap inline as a data URL.

Replaced with `useStable`, a deep compare that allocates nothing and short-circuits on `Object.is` at every level, so the common case — a fresh wrapper around the same inner objects — costs a handful of pointer checks however large the data URL underneath.
