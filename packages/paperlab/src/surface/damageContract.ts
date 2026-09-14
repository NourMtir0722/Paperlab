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
  /**
   * The burn's own clock, in seconds; omitted means the frame clock.
   *
   * Presentation only. The ember line on a burning edge is beaded and alive —
   * its beads flicker and crawl — and a source that can be replayed wants
   * that motion to replay too: the same moment of the same burn should draw
   * the same beads, which the frame clock cannot promise. `DamageField`
   * hands over its simulated time.
   */
  readonly time?: number
  /**
   * How a burn is DRAWN — widths, intensities and shapes the sheet's damage
   * shading reads each frame. Presentation only; the physics never sees it.
   * Anything left out takes {@link DAMAGE_LOOK_DEFAULTS}.
   */
  readonly look?: DamageLook
  /**
   * The light the damage gives off, as the room around the sheet should feel
   * it. Presentation only; the physics never sees it. Omitted, the room is
   * lit exactly as its lighting says.
   */
  readonly firelight?: DamageFirelight
}

/**
 * What a burning sheet does to the light around it.
 *
 * A fire big enough to see by is the key light while it burns, and a room's
 * own light yields to it — a sheet burning under an unchanged studio key
 * looks like a flame pasted onto a photograph. The source says by how much,
 * because only the source knows how big its fire is; the lighting does the
 * dimming, because only the lighting knows what its lights are.
 */
export interface DamageFirelight {
  /**
   * How much of the room's own light is left, 0..1; omitted means 1. The key,
   * the ambient fill and the studio light are all scaled by it, every frame,
   * without rebuilding anything.
   */
  readonly room?: number
}

/**
 * How much of the room's light `source` leaves, 0..1 — the one reading of
 * {@link DamageFirelight.room}, so every lighting rig reads it alike. Anything
 * that is not a number in range is the room untouched: a firelight is a
 * dimmer, and the worst a bad one may do is nothing.
 */
export function roomLight(source: DamageSource | null | undefined): number {
  const room = source?.firelight?.room
  if (room === undefined || !(room >= 0)) return 1
  return Math.min(1, room)
}

/**
 * The knobs on what a burn looks like, in the units a person tunes by —
 * millimetres of A4 and plain multipliers. Every one is optional.
 */
export interface DamageLook {
  /** The ember line's widest bead, mm. */
  emberWidth?: number
  /** How bright the beads burn, × the default. */
  emberIntensity?: number
  /** How much of the edge is lit at once, 0..1. */
  emberCoverage?: number
  /** How fast the beads flicker and crawl, × the default. */
  emberFlicker?: number
  /** The dim crimson glow beside the beads, reaching into the char, 0..2. */
  emberGlow?: number
  /** Specks of glowing fibre along the edge, 0..2. */
  sparkle?: number
  /** How wide the pale ash lip is, from the cut out to the ember line, mm. */
  lipWidth?: number
  /** How wide the black char band is, past the ember line, mm. */
  charWidth?: number
  /** How pale the ash lip is, × the sampled grey. */
  lipBrightness?: number
  /** 0 is grey char, 1 is dark orange to deep brown. */
  charWarmth?: number
  /** How visible the crack network in the char is, 0..1. */
  charCracks?: number
  /** How far the scorch reaches UP past the burn, mm. */
  scorchReach?: number
  /** How dark the scorch browns go, × the sampled ramp. */
  scorchDarkness?: number
  /** How strongly the scorch front breaks into fingers, × the default. */
  fingers?: number
  /** The burnt edge's long waves, ±mm. */
  edgeWave?: number
  /** The burnt edge's small bites in and out, ±mm. */
  edgeBite?: number
}

/**
 * What every burn is drawn with unless told otherwise — the tune made in the
 * lab's sidebar, and the source of truth for how a burn looks:
 * the lab starts from it, `/hands` inherits it, and a user changes it through
 * `look`. The values it replaced, and why each of those had moved, are in the
 * history of this file.
 */
export const DAMAGE_LOOK_DEFAULTS: Required<DamageLook> = {
  emberWidth: 1.25,
  emberIntensity: 1.05,
  emberCoverage: 0.6,
  emberFlicker: 1.65,
  emberGlow: 1.25,
  sparkle: 0.5,
  // As wide as the char band: the lip has to be seen. At
  // 0.95 mm it was a hairline tracing the edge.
  lipWidth: 3.5,
  charWidth: 3.5,
  lipBrightness: 0.76,
  charWarmth: 0.32,
  charCracks: 0.45,
  scorchReach: 9,
  scorchDarkness: 0.86,
  fingers: 1.95,
  edgeWave: 13,
  edgeBite: 6,
}

/**
 * Which byte of a texel means what.
 *
 * char — scorch colour, the brown halo; on cloth, shrinkage and a curl toward the front.
 * saturation — wet darkening and smoothing; on cloth, added mass.
 * heat — how hot the paper is. Drawn only where it burns: the ember line, not the sheet.
 * presence — how much paper is there at all; below half, none is drawn.
 */
export const DAMAGE_CHANNELS = { char: 0, saturation: 1, heat: 2, presence: 3 } as const
