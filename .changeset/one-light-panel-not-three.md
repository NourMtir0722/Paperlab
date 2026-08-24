---
'paperlab': minor
---

Light overrides reach a single sheet and a field, not just a stage.

`scene.light` joins `scene.lighting`, so a `<Paper>` can be "studio, but the
key is lower and the room is dimmer" — the authorable half that stage mode has
always had. `<PaperLighting>` has accepted these overrides all along; nothing
was passing them, and a lone sheet could only ever be one of seven rigs exactly
as shipped.

`lightSchema` moves from `scene/lighting.ts` into `config/schema.ts`, where the
rest of the serialized config lives. It has to: `sceneSchema` needs it, and
`lighting.ts` imports FROM the schema, so the dependency could not run the
other way. It is re-exported from its old home, where a caller reaching for the
overrides beside `resolveLighting` will still find it.

`<PaperField>` takes a `scene` too, and lights itself with `<PaperLighting>`
rather than the bare ambient-and-directional pair it had. **This changes how an
existing `<PaperField>` looks** — and it changes it to what the editor has been
showing all along, which is the point: the gallery you composed and the gallery
the exported code produced were lit by two different rigs, and the export was
the one nobody had looked at.

`diffFieldProps` also now compares structurally rather than by reference. No
object or array copied from a default is ever reference-equal to it, so a
layout option holding an array exported a prop that said exactly what the
default already said.
