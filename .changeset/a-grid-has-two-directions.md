---
"paperlab": minor
---

`segments: 'auto'` now subdivides the direction a deformer actually bends, and stops subdividing the one it does not.

`segmentsForArc(spanAlong(sheet, angle), r)` has always meant "this many segments **along `angle`**". `resolveSegments` threw the direction away: it took the number, spread it over the sheet's long edge, and gave the short edge whatever was left. On a 1 × 1.4 page nobody could see that. On a banner it is the entire picture — the stage's 1.5 × 8.5 banner is draped in folds that run across its **width**, the arithmetic asks for 133 segments across, and what it got was 48 across and 48 down a drop that needs eight.

A deformer now declares `geometry.axis(options, sheet)` beside its floor and its target, and the demand is projected onto the sheet's own axes by it — `width·|cos θ|·density` and `height·|sin θ|·density`, which is exact, because the demand was always a density along a direction rather than a count for a rectangle. `stackMinSegments` and `stackAutoSegments` return a pair now; `resolveSegments` and `createSheetGeometry` accept one. **A bare number still means what it always meant**, so an unchanged call to either exported helper answers exactly what it answered before. `crumple` returns `null` — its creases run every way at once — and keeps the aspect spread, which for it is the honest answer.

Fewer triangles everywhere, and in the case that needed it, a better-looking sheet:

| preset | grid | triangles | chord error |
| --- | --- | --- | --- |
| `receipt-unroll` | 49×128 → 8×128 | 12,544 → 2,048 | unchanged |
| `letter-fold` | 91×128 → 8×128 | 23,296 → 2,048 | unchanged |
| `hanging-poster` | 91×128 → 24×96 | 23,296 → 4,608 | 2.8e-4 → 4.8e-4 |
| `page-flip` | 48×48 → 48×8 | 4,608 → 768 | unchanged |
| `photo-print` | 16×16 → 16×8 | 512 → 256 | unchanged |
| the stage banner | 48×128 → 128×8 | 12,288 → 2,048 | **5.3e-3 → 7.7e-4** |

The banner row is the one worth reading twice: six times fewer triangles **and seven times less faceting**, because the density finally lands on the axis that bends. Every hero preset and both stage presets were rendered before and after and are indistinguishable; the sagitta test now measures the grid a sheet actually gets rather than the arithmetic behind it.

**`<PaperStage>`'s `quality` tier now reaches the geometry, which it never did.** The tier's `segments` was written straight over the sheet's `segments` as a number — and a number applies to both axes, field mode caps it at 48 on the way down, and `drape`'s floor of 48 raised it back on the way up. `low`, `medium` and `high` all drew the identical 48 × 48 banner, measured at 143,644 triangles a frame whatever the tier said. It is now a ceiling on what `'auto'` may ask for (`segmentCeiling` on `<PaperFieldMesh>`, a device knob that never serializes), so it can lower the grid and never raise it.

**The hero re-deform loop is ~2.6× faster**, which is the other half of the same frame. At the 128 ceiling one `drape + wave` sheet cost 2.30 ms a frame, of which 1.44 ms was `BufferGeometry.computeVertexNormals()`. `computeSheetNormals` does the same arithmetic straight over the typed arrays and is **bit-identical** to three's answer — asserted as exact equality, not a tolerance — at about an eighth of the cost. The loop itself now runs one deformer over every vertex instead of every deformer over one vertex, putting a single function behind the inner call site instead of a registry lookup and a megamorphic call per vertex per deformer. A resting sheet also stops expanding its whole deformer stack sixty times a second to discover it has nothing to do.

| grid | verts | was | now |
| ---: | ---: | ---: | ---: |
| 72 | 3,796 | 0.74 ms | 0.27 ms |
| 128 | 11,868 | 2.30 ms | 0.84 ms |
| 192 | 26,634 | 5.01 ms | 1.89 ms |
| 256 | 47,288 | 8.74 ms | 3.38 ms |

End to end on a stage (`pnpm perf`): `medium` 65.8 ms → 51.0 ms (15 → 20 fps), `low` 36.2 ms → 26.1 ms (28 → 38 fps), `archive` at 44 banners 34.4 ms → 26.0 ms. `high` moves least, because its ceiling keeps 72 across the folds and its frame is dominated by the contact-shadow pass and dpr 2.

**And the ceilings came up, because the axis split made them cheap.** No shipped preset reaches even 128 after the change, so `AUTO_CEILING` had stopped binding anything the library hands out — it only bound people asking for a tighter crease than any preset uses. Since a demand now lands on one axis, satisfying those costs ~0.02 ms rather than the 1.89 ms a square grid implies.

| | was | now | who feels it |
| --- | --- | --- | --- |
| `AUTO_CEILING` (hero) | 128 | **192** | hand-authored tight creases — `drape` at its defaults (154), `roll`/`fold` at `radius: 0.02` (175), `curl` at 0.02 (142). No preset changes. |
| `FIELD_AUTO_CEILING` | 72 | **128** | only a field with no `segmentCeiling`; the quality tiers cap themselves lower. |
| `qualityTiers.high.segments` | 72 | **128** | the stage's folds, on machines that measured fast enough to earn them. |

The third is the visible one: a banner's drape asks 133 across and had been getting 72, so at `high` the fold highlights now roll instead of stepping (sagitta 2e-3 → 7.7e-4). `medium` and `low` are untouched and measure identically to before; explicit `high` costs more on weak hardware and no machine that cannot hold it is ever promoted to it.

**The ladder could pump, and now cannot.** Promotion needs 55 fps and demotion fires under 26, so any machine where the next tier costs more than ~2.1× the current one satisfies both forever — and raising `high` is what put it at exactly that ratio on a software rasterizer. `auto`'s policy is now a pure `settleTier(tier, fps, failed)`, and a tier that has once failed is never offered again: the ladder tries the top once and settles. Still capped, and still said out loud: `wave` at `amplitude: 0.3` wants 272 and a 16-fold `drape` at full depth wants 1377; `segments: <number>` is the way past.

Those stage numbers are a **software-rasterizer floor**, not frame rates. `pnpm perf` used to print `renderer: native GPU` whenever `--soft` was absent, which was the launch flag it had been handed rather than the driver that answered; asked properly, headless Chromium draws all of it through ANGLE/SwiftShader either way. Both harnesses now report what actually drew the frame, and both take **`--gpu`**, which gets the real platform renderer headless. On an M4 Pro the stage holds 120 fps at every tier — 120 banners at 16 megapixels included — so these numbers are the floor and not the ceiling.
