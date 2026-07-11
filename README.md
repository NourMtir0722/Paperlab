# Paperlab

*The all-in-one paper effect builder for the web.* A React paper engine, a Figma-familiar editor, and a gallery composer on top. Open source, preset-driven, agent-first export.

Web designers constantly need paper: a hero image that peels, a receipt that unrolls, a letter that hangs and ripples, a portfolio ring of prints. Today that means either a flat CSS fake or a bespoke Three.js build. Paperlab makes physical, realistic paper a component.

**Realism is geometry-true**: content is a texture on a mesh that genuinely bends — text and imagery curl with perfect continuity, never a 2D trick.

## Packages

| Package | What it is |
|---|---|
| [`packages/paperlab`](packages/paperlab/) | The npm library — `<Paper />` (one sculptable sheet) and `<PaperField />` (many, arranged by layouts) |
| [`apps/editor`](apps/editor/) | The hosted editor — Paper Editor (sculpt one sheet) + Field Composer (arrange many) |

## Development

```sh
pnpm install
pnpm dev        # editor at http://localhost:5173
pnpm test       # deformer math + schema tests
pnpm build
```

Built with React Three Fiber, GSAP, zustand, and zod. The zod schema is the single source of truth: every Paper serializes to a `.paper` JSON preset that round-trips through the library, the editor, and code export.

MIT.
