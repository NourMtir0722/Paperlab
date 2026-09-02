---
'paperlab': minor
---

Move to zod 4.

`zod` is a runtime dependency of this package and its schemas are part of the
public API — `paperConfigSchema`, `sceneSchema`, `paperStatesSchema` and
`stageSchema` are all exported — so the major version is part of what Paperlab
promises. Anyone composing those schemas into their own zod 3 tree will need
to move too. Calling `.parse()` on them is unchanged in what it returns and what
it accepts — but zod 4 reshaped the error it throws, so anyone READING a
`ZodError` off these schemas rather than just letting it throw has a change to
make.

The `.paper` file format does NOT change. Every built-in preset, every stage
preset and the empty-object case for all four exported schemas were parsed
under both versions and diffed: byte-identical, 1095 lines.

That check was the point rather than a formality. zod 4 redefines `.default()`
to short-circuit — it hands back the literal value instead of parsing it — so
the sixteen `schema.default({})` calls that fill in nested defaults would have
silently started producing `{}`. They are `.prefault({})` now, which is the
old behaviour under its new name, and nothing about that is visible to a
typecheck.
