---
'paperlab': patch
---

The npm page now shows the library that actually shipped.

No code changes: the tarball's only difference is `README.md`, which npm serves
as the package page and which had drifted badly from 0.3.0. It documented a peer
floor of `three >= 0.160` where the package requires `>= 0.162`; it never once
mentioned `<PaperMesh>`; it described deformers, content types and interaction
states nowhere on the page; and every moving image on it predated both the
current design language and the switch of demo content to paper artifacts, so
the pictures were selling a product that no longer looked like that.

It also linked to a planning document that has been removed from the repository,
which on npm is a dead link with nothing behind it.

The page now carries the catalogues rather than describing them — the six stage
presets, twelve field layouts, eight lighting rigs and seven paper stocks, each
photographed side by side, because a catalogue only means anything when you can
compare its entries. Every asset is regenerated from the registries by
`pnpm media`, `pnpm shot:catalogue` and `pnpm sheet`, so the page cannot
silently drift from the library again.
