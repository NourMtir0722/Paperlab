/**
 * What damage IS, as far as a sheet is concerned. The whole seam.
 *
 * The split is by responsibility. What has happened to the paper belongs to
 * the sheet — it is shading, alpha and eventually stiffness, and only the
 * sheet can draw or simulate those. What CAUSES it belongs to `paperlab/fx`:
 * a flame, a cup of water, a pair of scissors. The main entry draws whatever
 * damage it is handed and has no idea where it came from, which is exactly
 * how `content` already works — `<Paper>` renders a texture without knowing
 * who painted it.
 *
 * The alternative was a public plugin API for the surface composer and the
 * cloth solver, so that fx could reach in. More flexible, and it would have
 * had to be supported for years before a single effect existed to justify its
 * shape. This is one interface and four constants.
 *
 * **This file imports nothing, on purpose.** `paperlab/fx` depends on it —
 * the field is a `DamageSource` and its channel offsets are these — and the
 * boundary test allows fx to reach this one file and nothing else in the
 * library. The moment it imports three, React or the config schema, fx starts
 * dragging the library in behind it.
 */

/**
 * A grid of damage over the sheet's UV, as the sheet reads it.
 *
 * Satisfied structurally by `DamageField` in `paperlab/fx`, and by anything
 * else that can produce four bytes per texel — a baked texture, a recorded
 * burn played back, a test fixture.
 */
export interface DamageSource {
  /** Texels along each edge. The grid is square and covers the whole sheet. */
  readonly size: number
  /**
   * RGBA per texel, 0..255, row-major from v = 0 — the channels are
   * {@link DAMAGE_CHANNELS}. Read in place, never copied: the source mutates
   * it and bumps `version`.
   *
   * Eight bits, deliberately. The simulation behind it can run in float; what
   * reaches the GPU is 16 KB per changed frame at 64², against 256 KB for a
   * 128² float texture, and it does not depend on float-texture filtering,
   * which not every phone GPU guarantees.
   */
  readonly pixels: Uint8Array
  /** Bumped whenever `pixels` changes. The sheet uploads on a change and never otherwise. */
  readonly version: number
  /**
   * How ragged a burnt or cut edge is DRAWN, 0..1; omitted means 1.
   *
   * Presentation only: per-fragment noise that moves the edge within the
   * grid's soft band, finer than the grid itself can carry. The physics reads
   * the grid and never this. It is the one part of drawing damage that costs
   * per pixel, which is why it is a number a source can turn down — `paperlab/fx`
   * sets it from its quality tier.
   */
  readonly detail?: number
}

/**
 * Which byte of a texel means what.
 *
 * char — scorch colour, the brown halo; on cloth, shrinkage and a curl toward the front.
 * saturation — wet darkening and smoothing; on cloth, added mass.
 * heat — the glowing ignition line.
 * presence — how much paper is there at all; below half, none is drawn.
 */
export const DAMAGE_CHANNELS = { char: 0, saturation: 1, heat: 2, presence: 3 } as const
