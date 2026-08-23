---
'paperlab': minor
---

**Breaking: the public API is 83 names instead of 214.**

Every exported name is a promise kept for years, and this library was exporting
its own internals: shader builders (`buildFieldVertexShader`,
`buildDisplacementGLSL`), texture painters (`barcodeBars`, `makeGoboTexture`,
`silhouetteRects`), tessellation constants (`SHEET_LIFT`, `TRANSMISSION_GAIN`),
the cloth integrator, the state machine class, and 36 individual behavior,
deformer and layout functions that the registries already reach.

None of that is API. It is the inside of the box, and shipping it means a
refactor of a private helper becomes a breaking change for somebody. The
surface is now what a caller genuinely needs: the four components, the schema
and its types, the registries and their three `register*` hooks, presets and
the `.paper` file format, the export helpers, lighting-as-data, interaction
states, and the accessibility utilities.

**Behaviors, deformers and layouts are reached through their registries.**
`getBehavior('peel')`, `getDeformer('roll')` and `getLayout('ring')` return
exactly what the removed named exports did, and `listBehaviors()`,
`listDeformers()` and `listLayouts()` enumerate them. Nothing was deleted from
the library — only from its front door.

Three things that look internal are still exported, each with the reasoning
written where it is exported: the GPU/CPU **parity harness**, because it is the
only gate on the invariant the contribution ladder rests on; the **tessellation
arithmetic**, because `registerDeformer` is public and a third-party deformer
must answer the segment-count question the same way the built-in seven do; and
**`wrapLines`**, because a caller measuring type before laying out a sheet has
to get the same answer the painter will.

`paperlab/stage` loses seven names the same way — a magic constant, four
sub-schemas, and two export helpers — keeping the sixteen that `llms.txt`
documents.

This lands now, at 0.4.0, precisely because nobody has built on the old surface
yet. Doing it later would cost real users a migration for no benefit to them.
