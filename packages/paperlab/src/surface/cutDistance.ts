/**
 * How far every texel of a damage field is from the cut, in millimetres — the
 * one measure a burnt edge's zones are laid out on: the ash lip, the ember
 * line, the char and the scorch, each so many millimetres out from where the
 * paper ends.
 *
 * Worked out here, on the CPU, once per change of the field, rather than in
 * the shader. The shader used to estimate it per pixel from sixteen reads on a
 * ring, and every speck of burnt-through paper near the rim counted as a cut:
 * each grew its own little lip, char and scorch, and the bands came apart into
 * blotches. Here a speck can be recognised for what it is, and dropped, before
 * anything is measured from it.
 *
 * Pure arithmetic, so it runs in node under vitest.
 */

/** How far out the distance is measured, mm — past the widest zones a look draws. */
export const CUT_REACH_MM = 16

/** Burnt-through islands of this many texels or fewer are specks, not a cut. */
const SPECK_TEXELS = 3

/** Presence below this, as a byte, is paper that is gone — the shader's own line. */
const GONE_BELOW = 128

let scratch: { size: number; dist: Float32Array; kept: Uint8Array; stack: Int32Array } | null = null

/**
 * Fill `out` (one byte per texel, row 0 at v = 0 like the field) with each
 * texel's distance from the nearest gone texel that belongs to a real cut,
 * as a fraction of {@link CUT_REACH_MM}: 0 on the cut, 255 at the reach or
 * beyond — which is every texel of a sheet with no cut at all.
 *
 * `texelMm` is the size of one texel step across and down the sheet, in
 * millimetres. A sheet that is not square has texels that are not either, so
 * a step down a sheet of A4 is 4.7 mm and a step across it 3.3.
 *
 * The distance is between texel CENTRES. Sampled with bilinear filtering, the
 * drawn edge — halfway between a gone texel and the paper beside it — reads
 * half a texel, which the shader takes back off.
 */
export function cutDistance(
  pixels: Uint8Array,
  size: number,
  texelMm: readonly [number, number],
  out: Uint8Array,
): void {
  const n = size * size
  if (!scratch || scratch.size !== size) {
    scratch = { size, dist: new Float32Array(n), kept: new Uint8Array(n), stack: new Int32Array(n) }
  }
  const { dist, kept, stack } = scratch
  const gone = (i: number) => pixels[i * 4 + 3]! < GONE_BELOW

  // A cut is a burnt-through island bigger than a speck. Flood each island
  // once, by its 4-neighbours, and keep it only if it is big enough.
  kept.fill(0)
  const seen = dist // borrowed as a visited mark until the distances start
  seen.fill(0)
  for (let start = 0; start < n; start++) {
    if (seen[start] || !gone(start)) continue
    let top = 0
    let count = 0
    stack[top++] = start
    seen[start] = 1
    const first = top
    // Collect the island into the front of `stack`, walking it as a queue.
    let head = 0
    while (head < top) {
      const i = stack[head++]!
      count++
      const x = i % size
      const y = (i / size) | 0
      const next = [
        x > 0 ? i - 1 : -1,
        x < size - 1 ? i + 1 : -1,
        y > 0 ? i - size : -1,
        y < size - 1 ? i + size : -1,
      ]
      for (const j of next) {
        if (j < 0 || seen[j] || !gone(j)) continue
        seen[j] = 1
        stack[top++] = j
      }
    }
    if (count > SPECK_TEXELS) for (let k = first - 1; k < top; k++) kept[stack[k]!] = 1
  }

  // Two passes of a chamfer transform, each step weighted by how far it
  // really is on the sheet.
  const [dx, dy] = texelMm
  const dd = Math.hypot(dx, dy)
  for (let i = 0; i < n; i++) dist[i] = kept[i] ? 0 : Number.POSITIVE_INFINITY
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x
      let v = dist[i]!
      if (v === 0) continue
      if (x > 0) v = Math.min(v, dist[i - 1]! + dx)
      if (y > 0) {
        v = Math.min(v, dist[i - size]! + dy)
        if (x > 0) v = Math.min(v, dist[i - size - 1]! + dd)
        if (x < size - 1) v = Math.min(v, dist[i - size + 1]! + dd)
      }
      dist[i] = v
    }
  }
  for (let y = size - 1; y >= 0; y--) {
    for (let x = size - 1; x >= 0; x--) {
      const i = y * size + x
      let v = dist[i]!
      if (v === 0) continue
      if (x < size - 1) v = Math.min(v, dist[i + 1]! + dx)
      if (y < size - 1) {
        v = Math.min(v, dist[i + size]! + dy)
        if (x < size - 1) v = Math.min(v, dist[i + size + 1]! + dd)
        if (x > 0) v = Math.min(v, dist[i + size - 1]! + dd)
      }
      dist[i] = v
    }
  }
  for (let i = 0; i < n; i++) out[i] = Math.round((Math.min(dist[i]!, CUT_REACH_MM) / CUT_REACH_MM) * 255)
}
