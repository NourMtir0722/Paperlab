import {
  Afterglow,
  DamageField,
  FIXED_DT,
  FireEmitter,
  HEAT,
  PRESENCE,
  ParticlePool,
  fxQualityFor,
  type FieldStats,
  type FireEmitterOptions,
  type FxQualityTier,
  type SurfaceLocator,
} from 'paperlab/fx'
import { FLAME_RADIUS, flameHeat } from './flame'

/**
 * One burn, scripted, seekable, and the same every time.
 *
 * `/hands` burns paper when a hand holds a flame against it, which is the
 * point of `/hands` and useless for judging how fire LOOKS: no two runs are
 * the same burn, and the frame you wanted has already gone. `/fx-lab` needs
 * the opposite — a burn with no camera, no hand and no wall clock in it, that
 * can be asked for the same 2.2 seconds a hundred times and answer with the
 * same pixels. That is what this is, and it is why the capture script can
 * photograph a phase at all.
 *
 * Everything here runs on the SIMULATED clock. Time only ever moves in whole
 * `FIXED_DT` steps, in the same order as `/hands` runs them — ignite, step the
 * field, emit, step the pool — so what the lab draws at t is what the page
 * would have drawn at t, not an approximation of it. Seeking rebuilds from
 * zero rather than rewinding, because a diffusion field has no inverse; 8
 * seconds is 960 steps of a 64² grid and costs a few milliseconds.
 *
 * The numbers in `PHASES` are MEASURED off this script, not copied out of the
 * spec's §9 table. Where the two disagree the phase says so — see `gap`. That
 * disagreement is a finding, not a rounding error, and `burn.test.ts` pins it
 * so it cannot quietly go away.
 */

/** Where a burn starts. */
export type BurnOrigin = 'center' | 'corner'

/**
 * Where the scripted flame is held, for each origin, in the sheet's UV.
 *
 * - **center** — the lower middle, where `Hero.png` burns: below centre so
 *   the fire climbs through the sheet, with paper all round it, and a hole
 *   opens and grows. The same spot `/hands` strikes its match at.
 * - **corner** — the bottom-left corner. The paper's fibre runs across the
 *   sheet and fire spreads three times faster along it than across, so the
 *   flame runs along the bottom edge and the front climbs as a line —
 *   measured: the top of the burnt paper rises about 0.14 of the sheet a
 *   second, steadily, and no hole opens in the middle. Nothing forces it; it
 *   is the field's own spread.
 */
export const ORIGINS: Record<BurnOrigin, { readonly u: number; readonly v: number }> = {
  center: { u: 0.5, v: 0.32 },
  corner: { u: 0.05, v: 0.03 },
}

/**
 * How long the flame is held against the paper, in simulated seconds.
 *
 * Long enough to be past `FLAME_DWELL` and properly alight rather than
 * scorched. It barely matters, which is itself worth knowing: measured at
 * 0.9, 1.6 and 2.5 seconds, the three burns are the same burn to three
 * decimal places from about a second in. Once the field is charring,
 * `combustion` (2.4) sustains it and the flame is no longer part of the
 * story.
 */
export const HOLD = 1.6

/**
 * How a burn starts, and how it ends.
 *
 * It used to end with a scripted blow at 1.75 s — the fire put out a moment
 * after its peak, which is how a burn on `/hands` ends, and which left
 * "dying", "smoulder" and "cold" as photographs of a fire that had been
 * stopped rather than one that had finished. Now it carries on past its
 * longest front and dies by itself: the sheet loses heat faster than the
 * front can make it, the flames gutter and shrink, the edge sheds ash as it
 * cools, the last beads smoulder, and it goes cold.
 */
export interface BurnSettings {
  origin: BurnOrigin
  /**
   * How much of the sheet is gone when the fire starts to die, 0..1 — past
   * its longest front at the default half. 1 never dies: it eats the sheet.
   * Measured on what is gone rather than on the clock, so "halfway" means
   * the same thing from the centre and from a corner.
   */
  decayAt: number
  /** Seconds the fire takes to die once it starts to. */
  decay: number
  /** The longest a bead smoulders once its heat has gone, seconds (`Afterglow`'s hold). */
  smoulder: number
  /** How much ash a cooling edge sheds as the fire dies — 0 sheds none, 1 is the default. */
  ash: number
  /** Smoke at all: the puffs, the simulator's smoke and the wisps. Off keeps the background clean. */
  smoke: boolean
}

export const BURN_DEFAULTS: BurnSettings = {
  origin: 'center',
  // Was 0.5 — half the sheet gone before the fire began to give up, which at
  // the old pace was 2.3 s in and at the new one would run the burn past 13 s
  // and eat 62% of the sheet. The fire should give up while the hole is still
  // a hole. Measured at the new pace, centre: 0.18 → 10.1 s and 27% gone,
  // 0.22 → 10.9 s and 33%, 0.26 → 11.7 s and 38%.
  decayAt: 0.22,
  decay: 2.5,
  smoulder: 2.2,
  ash: 1,
  smoke: true,
}

/**
 * How fast the whole sheet loses heat once the fire is fully dying, per
 * second. Measured: 1.2 from the peak puts a centre burn out 2.5 s later
 * with a quarter of the sheet left, 0.6 lets it eat everything, 2.4 snuffs
 * it in a second and a half. The ramp (`BurnSettings.decay`) is what makes
 * it die rather than stop.
 */
const DECAY_COOL = 1.5

/**
 * Ash a rim texel sheds per second at `ash` 1, while the fire is dying.
 * Measured: at 0.08 a dying rim shed three flakes in all — none of it
 * visible. The tier's cap on flakes in the air is the other half: at the
 * tuned burn-through rate it filled with the burning's own ash, and the
 * shed found no room until it doubled.
 */
const SHED_PER_SECOND = 0.5

/**
 * How long the whole scripted burn is worth watching, in simulated seconds.
 *
 * 12 while the field's clock ran six times too fast and a centre burn was over
 * in 4.8 s. At the pace `fx/field.ts` now runs, a centre burn's flames go out
 * at about 10.9 s and it is cold at 17 s; a CORNER burn — which spreads along
 * the sheet's fibre as a line rather than a disc, so it covers the sheet more
 * slowly — goes out at 16.6 s and is cold at 20.2 s. This has to outlast the
 * longer of the two with room to spare, or `phasesFor` clamps "cold" to the
 * end of the scrubber and the last phase photographs a sheet that is still
 * warm.
 */
export const DURATION = 24

/**
 * What the effects are allowed to cost here — `/hands`'s own tier.
 *
 * The lab is for looking at the fire the product ships, so it draws the fire
 * the product ships. The simulation is not tiered at all (see `fx/field.ts`),
 * so this changes how much is DRAWN and nothing about what happens.
 */
export const TIER: FxQualityTier = 'medium'

/** Is the scripted match on the paper at this simulated time? */
export function flameOn(t: number): boolean {
  return t < HOLD
}

/**
 * What the match deposits on the step that starts at `t`.
 *
 * Through `flame.ts` rather than beside it. Those numbers were measured
 * against a browser once already — a flame that deposits too little never
 * lights the paper and every unit test still passes — and a lab burning at a
 * rate of its own would be a lab for a fire nobody can light.
 */
export function flameHeatAt(t: number): number {
  return flameHeat(t + FIXED_DT, FIXED_DT)
}

/** One moment of the burn worth photographing. */
export interface Phase {
  id: string
  /** Simulated seconds from the flame touching the paper. */
  at: number
  /** What this moment is, in the spec's words (§9). */
  label: string
  /** The still in `fx-refs/fire/` this frame is judged against. */
  reference: string
  /** What the reference shows, for the caption under the pair. */
  shows: string
  /**
   * Where the simulation and the spec's §9 disagree about this phase, if they
   * do. Printed by the capture script and shown in the lab, because a
   * comparison against a reference that the burn cannot reach is worse than
   * no comparison — it invites tuning the LOOK to hide a hole in the
   * SIMULATION.
   */
  gap?: string
}

/** Rounded to a twentieth of a second — a phase is a moment to jump to, not a measurement to quote. */
const moment = (t: number) => Math.round(t * 20) / 20

/**
 * The seven moments of §9, at the times THIS burn reaches them.
 *
 * Measured, not written down: the burn is stepped headlessly with the given
 * settings and each moment is read off it — the first burn-through, the
 * front at its longest, halfway through dying, just after the flames go out,
 * and once the field and its last beads are asleep. A table of numbers was
 * right for one burn; with an origin and an ending the user can change, a
 * table would photograph "peak" a second after the peak, which is exactly the
 * failure the visual gate exists to stop. Cheap: a 64² field for twelve
 * seconds, with no sheet to throw particles at.
 */
export function phasesFor(config: Partial<BurnSettings> = {}): Phase[] {
  const burn = new ScriptedBurn(() => null, config)
  const settings = { ...BURN_DEFAULTS, ...config }
  let caught = -1
  let browned = -1
  let peakAt = 0
  let best = -1
  let asleepAt = -1
  while (burn.time < DURATION - FIXED_DT / 2) {
    burn.advance()
    const s = burn.stats
    if (browned < 0 && s.charred > 0) browned = burn.time
    if (caught < 0 && s.remaining < 1) caught = burn.time
    if (s.front > best) {
      best = s.front
      peakAt = burn.time
    }
    if (asleepAt < 0 && burn.wentOut !== null && burn.field.asleep) asleepAt = burn.time
  }
  const out = burn.wentOut
  const from = burn.decayStarted
  const peak = moment(peakAt)
  const catchAt = moment(Math.min(Math.max(caught, 0) + 0.35, peakAt - 0.3))
  // Measured, like every moment below it. These two were the last constants in
  // this table — 0.25 s and 0.45 s, written down when the field's clock ran six
  // times too fast. At the pace it runs now the paper first browns at 0.35 s
  // and first burns through at 1.41 s, so a "scorch" photographed at 0.45 s
  // caught paper that had barely started to change colour and was compared
  // against a reference of a brown teardrop. Nothing here may be a constant
  // that a change to the field's rates can silently invalidate.
  const first = Math.max(browned, 0)
  // Before anything has charred: the flame is on the paper and the paper has
  // not answered yet.
  const contactAt = moment(Math.max(0.05, first * 0.6))
  // Brown ahead of the front and no hole yet — halfway between the two.
  const scorchAt = moment(first + (Math.max(caught, first) - first) * 0.5)
  const end = out ?? DURATION - 0.5
  const dying = moment(Math.min(from !== null ? from + settings.decay * 0.5 : (peakAt + end) / 2, end - 0.1))
  const smoulder = moment(Math.min(end + 0.4, DURATION - 0.3))
  const cold = moment(Math.min(DURATION - 0.05, Math.max(asleepAt, end + settings.smoulder) + 0.6))
  const unfinished =
    out === null
      ? `the fire is still burning at ${DURATION} s — it has not gone out, so this is not yet the end`
      : undefined
  const corner = settings.origin === 'corner'
  return [
    {
      id: 'contact',
      at: contactAt,
      label: 'contact · the flame on the paper, nothing burnt yet',
      reference: 'Base_plate.png',
      shows: 'the scene with nothing happening to it',
      gap: 'the reference is the clean plate: this frame should differ from it only by the first light of the fire — no match is drawn',
    },
    {
      id: 'scorch',
      at: scorchAt,
      label: 'scorch · brown ahead of the front, no hole yet',
      reference: 'Stage_1__ignition.png',
      shows: 'straw → brown, growing upward as a teardrop',
    },
    {
      id: 'catch',
      at: catchAt,
      label: corner
        ? `catch · burnt through at the corner (${caught.toFixed(2)} s), running along the bottom edge`
        : `catch · burnt through (first hole at ${caught.toFixed(2)} s), first flames`,
      reference: 'Stage_2__catching.png',
      shows: 'a small hole, first flames on the upper rim, warm light around it',
    },
    {
      id: 'peak',
      at: peak,
      label: corner
        ? 'peak · the front at its longest, a line climbing the sheet'
        : 'peak · the front at its longest, the hole still growing',
      reference: 'Hero.png',
      shows: 'the target frame — tall flames above, short below, the whole sheet warmed',
    },
    {
      id: 'dying',
      at: dying,
      label: 'dying · past its longest the fire dies: flames gutter and shrink, the cooling edge sheds ash',
      reference: 'Stage_4__dying.png',
      shows: 'flames out, glow surviving as separate beads, thin smoke',
      gap: unfinished,
    },
    {
      id: 'smoulder',
      at: smoulder,
      label: 'smoulder · no flames; beads on the rim going out one by one',
      reference: 'Stage_4__dying.png',
      shows: 'beads crawling along the edge, wisps rising from them',
      gap: unfinished,
    },
    {
      id: 'cold',
      at: cold,
      label: 'cold · the burn is over: void, ash, char and scorch remain',
      reference: 'Stage_5__cold.png',
      shows: 'no glow; void, ash, char and scorch remain, one S-curving wisp',
      gap: unfinished,
    },
  ]
}

export function phase(id: string, phases: readonly Phase[] = PHASES): Phase {
  const hit = phases.find((p) => p.id === id)
  if (!hit) throw new Error(`[fx-lab] no phase "${id}" — have ${phases.map((p) => p.id).join(', ')}`)
  return hit
}

/** A close crop on the burning edge: where to put the camera, and what to judge it against. */
export interface Crop {
  id: string
  label: string
  /** On the sheet, in UV — chosen off the live front, not guessed. */
  u: number
  v: number
  reference: string
}

/**
 * Three points on the edge of the hole: the top of it, the bottom of it, and
 * its left side.
 *
 * Off the hole's RIM — paper with no paper beside it — and not off
 * the field's `frontCells`, and the difference is a finding. The field's
 * "front" is every cell that is charring and hot, and at the peak that band is
 * three to four times wider than the hole: its extremes sit out at the leading
 * edge of the scorch, on unburnt paper, and a macro aimed there photographs
 * nothing but the glow. The ember line (§5.3) lives on the rim, so the crops
 * aim there.
 *
 * Kept two cells in from the sheet's own edges: the burn spreads three times
 * faster along the fibre than across it and reaches the sides of the sheet,
 * and a crop of where the sheet ENDS says nothing about how a burn looks.
 * Picked by extremes, so the same burn at the same time always returns the
 * same three — the capture script asks the page for these and photographs
 * them.
 *
 * The compass matters for what the crops are FOR. §6 says upper-rim flames
 * are tall and lower-rim ones short; §5.3 says the ember line is beaded
 * everywhere. A crop of each is how you tell whether either is true.
 */
export function rimCrops(field: DamageField): Crop[] {
  const size = field.size
  const last = size - 1
  const pixels = field.pixels
  let top = -1
  let bottom = -1
  let left = -1
  for (let y = 2; y < size - 2; y++) {
    for (let x = 2; x < size - 2; x++) {
      const cell = y * size + x
      // On the contour the sheet cuts along: still paper, with paper that is
      // gone right beside it. A band of "part-consumed" is not enough — the
      // grain leaves stray half-eaten cells ahead of the hole, and the
      // extremes of that band sat a centimetre out on the glow.
      if (pixels[cell * 4 + PRESENCE]! < 128) continue
      const gone =
        pixels[(cell - 1) * 4 + PRESENCE]! < 128 ||
        pixels[(cell + 1) * 4 + PRESENCE]! < 128 ||
        pixels[(cell - size) * 4 + PRESENCE]! < 128 ||
        pixels[(cell + size) * 4 + PRESENCE]! < 128
      if (!gone) continue
      if (top < 0 || y > ((top / size) | 0)) top = cell
      if (bottom < 0 || y < ((bottom / size) | 0)) bottom = cell
      if (left < 0 || x < left % size) left = cell
    }
  }
  const uv = (cell: number) => ({ u: (cell % size) / last, v: ((cell / size) | 0) / last })
  const named: [string, number, string, string][] = [
    ['upper', top, 'the top of the hole — where flames should be tallest', 'Ember_line.png'],
    ['lower', bottom, 'the bottom of the hole — where flames should be shortest', 'Flame_base.png'],
    [
      'side',
      left,
      'the side of the hole — ash lip, beads, char, scorch in order',
      'Ember_line__annotated.png',
    ],
  ]
  return named
    .filter(([, cell]) => cell >= 0)
    .map(([id, cell, label, reference]) => ({ id, label, reference, ...uv(cell) }))
}

/**
 * Which parts of the burn the sheet is allowed to show.
 *
 * The first four are the field's own channels, turned off by handing the
 * sheet a copy with that channel flattened — which is the only way to take
 * one apart without changing a line of the shader, and the reason step 1
 * changes nothing about how fire is drawn. The last three are the emitters'
 * rates (see `ScriptedBurn.setEmit`).
 *
 * The zones the spec actually names — ash lip, ember line, the char surface,
 * the scorch front — are not here because they do not exist yet. The lab
 * lists them as unbuilt with the step that owes them, which is a more useful
 * thing for this page to say than a toggle that does nothing.
 */
export interface Layers {
  char: boolean
  heat: boolean
  presence: boolean
  saturation: boolean
  /** `FxFireFluid` — the fire simulated: gas, combustion, heat, smoke. */
  fluid: boolean
  /** `FxFireLight` — the warm light the burn throws on the sheet, and through it. */
  light: boolean
  /** `FxWisps` — the thread of smoke rising from a smouldering bead. */
  wisps: boolean
  embers: boolean
  smoke: boolean
  ash: boolean
}

export const ALL_LAYERS: Layers = {
  char: true,
  heat: true,
  presence: true,
  saturation: true,
  fluid: true,
  light: true,
  wisps: true,
  embers: true,
  smoke: true,
  ash: true,
}

/**
 * The scripted burn itself: a field, a pool, an emitter and a clock.
 *
 * Owns no rendering and no React. The lab steps it and draws whatever it
 * holds; `burn.test.ts` steps it and reads numbers off it, with no browser
 * anywhere — which is the only reason the phase table above could be measured
 * rather than guessed.
 */
export class ScriptedBurn {
  field!: DamageField
  /**
   * What the sheet draws: the field, with the embers a dying edge keeps
   * after its heat has gone (`Afterglow`). Flames and the fire light read
   * the field; only the sheet reads this.
   */
  glow!: Afterglow
  pool!: ParticlePool
  private emitter!: FireEmitter
  private locate: SurfaceLocator
  /**
   * Which kinds of particle this burn is allowed to throw.
   *
   * Turned off at the SOURCE — the emitter's own rate, which is public API —
   * rather than by hiding them at draw time. A lab toggle that only stopped
   * drawing them would leave them in the pool, shift every other particle's
   * draw of the shared random stream, and quietly make the burn a different
   * burn. Changing one costs a re-seek, which is what every other control
   * here costs too.
   */
  private emit = { embers: true, smoke: true, ash: true }
  /** How much of each is thrown when it is on — the emitter's own rates; undefined keeps its default. */
  private rates: { embers?: number; smoke?: number; ash?: number } = {}
  /** Where it starts and how it ends — see `BurnSettings`. */
  private config: BurnSettings
  private t = 0
  /** When the fire started to die, and when its front went out — simulated seconds. */
  private decayFrom: number | null = null
  private outAt: number | null = null
  /** The shed's own random stream, so ash off a cooling edge cannot shift the emitter's. */
  private shedState = 11
  private ashCap: number | undefined
  private last: FieldStats = {
    front: 0,
    charred: 0,
    consumed: 0,
    wetted: 0,
    saturation: 0,
    remaining: 1,
  }

  constructor(locate: SurfaceLocator, config: Partial<BurnSettings> = {}) {
    this.locate = locate
    this.config = { ...BURN_DEFAULTS, ...config }
    this.reset()
  }

  /** Simulated seconds since the flame touched the paper. */
  get time(): number {
    return this.t
  }

  /** What the last step produced. */
  get stats(): FieldStats {
    return this.last
  }

  /** How it starts and ends, as it is burning now. */
  get settings(): BurnSettings {
    return this.config
  }

  /** 0 while the fire grows; rising to 1 over `decay` seconds once it starts to die. */
  get dying(): number {
    if (this.decayFrom === null) return 0
    return Math.min(1, Math.max(0, (this.t - this.decayFrom) / Math.max(0.1, this.config.decay)))
  }

  /** When the fire started to die, or null while it is still growing. */
  get decayStarted(): number | null {
    return this.decayFrom
  }

  /** When the front went out, or null while anything is burning. */
  get wentOut(): number | null {
    return this.outAt
  }

  /** Which kinds of particle to throw from here on. Takes effect on the next reset. */
  setEmit(
    emit: { embers: boolean; smoke: boolean; ash: boolean },
    rates: { embers?: number; smoke?: number; ash?: number } = {},
  ): void {
    this.emit = { ...emit }
    this.rates = { ...rates }
  }

  /** Where it starts and how it ends. Takes effect on the next reset. */
  configure(config: Partial<BurnSettings>): void {
    this.config = { ...BURN_DEFAULTS, ...config }
  }

  /** Back to an untouched sheet. */
  reset(): void {
    const quality = fxQualityFor(TIER)
    this.field = new DamageField()
    this.field.detail = quality.detail
    // Beads hold their glow for up to `smoulder` seconds once the heat has
    // gone; the shortest for about a quarter of that, so they go out one by
    // one rather than together.
    const longest = Math.max(0.2, this.config.smoulder)
    this.glow = new Afterglow(this.field, { hold: [longest * 0.27, longest] })
    // Seeded, both of them, and never reseeded: two seeks to the same time
    // have to throw the same sparks as well as burn the same hole.
    this.pool = new ParticlePool(quality.particles, 1)
    // Keys are left OUT rather than set to undefined: the emitter merges over
    // its defaults, and an explicit undefined would overwrite one with NaN.
    // The tier's caps on each kind of particle, as the product runs them.
    const off: FireEmitterOptions = { caps: quality.caps }
    if (this.rates.embers !== undefined) off.embers = this.rates.embers
    if (this.rates.smoke !== undefined) off.smoke = this.rates.smoke
    if (this.rates.ash !== undefined) off.ash = this.rates.ash
    if (!this.emit.embers) off.embers = 0
    if (!this.emit.smoke || !this.config.smoke) off.smoke = 0
    if (!this.emit.ash) off.ash = 0
    this.emitter = new FireEmitter(this.field, this.pool, this.locate, off)
    this.ashCap = quality.caps.ash
    this.t = 0
    this.decayFrom = null
    this.outAt = null
    this.shedState = 11
    this.last = { front: 0, charred: 0, consumed: 0, wetted: 0, saturation: 0, remaining: 1 }
  }

  /**
   * One fixed step. The only way time moves.
   *
   * The same order as `<Fire>` on `/hands`: what the flame deposits, then the
   * field, then what the field throws off, then where that lands. A different
   * order here would make the lab a picture of a fire the product does not
   * have.
   */
  advance(): void {
    const origin = ORIGINS[this.config.origin]
    if (flameOn(this.t)) {
      this.field.ignite(origin.u, origin.v, FLAME_RADIUS, flameHeatAt(this.t))
    }
    // Past its longest front the fire starts to die — once enough of the
    // sheet is gone — and from then the whole sheet loses heat faster and
    // faster, the field's own paint with the heat taken off. Only while
    // something is still burning: a paint wakes the field, and a field that
    // is never let sleep is never cold.
    const gone = 1 - this.last.remaining
    if (this.decayFrom === null && this.config.decayAt < 1 && gone >= this.config.decayAt)
      this.decayFrom = this.t
    const dying = this.dying
    // …and it goes on cooling for `smoulder` seconds after the last flame, not
    // only while one is still alight.
    //
    // `cooling` is one number doing two jobs, and dilating the field's clock
    // (`fx/field.ts`) pulled them apart. It has to be SMALL against
    // charRate · combustion or the front cannot sustain itself — and it is
    // also what makes a spent sheet go cold. At 0.18/s the front is healthy
    // and residual heat needs `ln(1000) / 0.18` ≈ 38 s to fall under the
    // field's rest threshold, so the field never slept, "cold" never arrived,
    // and the last three phases photographed a sheet that was still warm.
    //
    // The sheet keeps losing heat to the room after the flames are gone, so
    // this paint keeps running — but only until the smoulder window closes,
    // because a paint WAKES the field and one that never stops would mean the
    // field is never allowed to sleep. `Afterglow` is what keeps the beads
    // visible through that window; it reads the texture, not the field, so
    // cooling the field quickly costs nothing on screen.
    const coolUntil = this.outAt === null ? Number.POSITIVE_INFINITY : this.outAt + this.config.smoulder
    if (dying > 0 && (this.last.front > 0 || this.t < coolUntil)) {
      this.field.paint(HEAT, 0.5, 0.5, 1, -DECAY_COOL * dying * FIXED_DT, 1)
    }
    this.last = this.field.step(FIXED_DT)
    if (this.outAt === null && this.t > HOLD && this.last.front === 0 && this.last.remaining < 1) {
      this.outAt = this.t
    }
    this.glow.step(FIXED_DT)
    this.emitter.update(FIXED_DT)
    this.shed(FIXED_DT)
    this.pool.step(FIXED_DT)
    this.t += FIXED_DT
  }

  /**
   * Ash off the edge as it cools.
   *
   * While the fire burns, ash leaves where paper burns THROUGH (the
   * emitter's). Dying, a burnt edge sheds more: crumbs of the ash lip and
   * the char beside it, breaking off as the heat goes out of them — the
   * visible ash of a burn that is finishing. Rising with the decay, then
   * fading over the smoulder once the flames are out.
   */
  private shed(dt: number): void {
    if (!this.emit.ash || !(this.config.ash > 0)) return
    let k = this.dying
    if (this.outAt !== null) k = Math.max(0, 1 - (this.t - this.outAt) / Math.max(0.1, this.config.smoulder))
    if (k <= 0) return
    const { field, pool } = this
    if (this.ashCap !== undefined && pool.countOf('ash') >= this.ashCap) return
    const size = field.size
    const last = size - 1
    const pixels = field.pixels
    const chance = this.config.ash * SHED_PER_SECOND * k * dt
    for (let y = 1; y < last; y++) {
      for (let x = 1; x < last; x++) {
        const cell = y * size + x
        if (pixels[cell * 4 + PRESENCE]! < 128) continue
        // On the rim: paper with paper gone beside it.
        if (
          pixels[(cell - 1) * 4 + PRESENCE]! >= 128 &&
          pixels[(cell + 1) * 4 + PRESENCE]! >= 128 &&
          pixels[(cell - size) * 4 + PRESENCE]! >= 128 &&
          pixels[(cell + size) * 4 + PRESENCE]! >= 128
        ) {
          continue
        }
        if (this.nextShed() >= chance) continue
        const at = this.locate(x / last, y / last)
        if (at) pool.spawn('ash', at.x, at.y, at.z)
      }
    }
  }

  /** xorshift32. */
  private nextShed(): number {
    let s = this.shedState
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    this.shedState = s >>> 0
    return this.shedState / 4294967296
  }

  /**
   * Run to a simulated time, from zero.
   *
   * Rebuilt rather than rewound — diffusion has no inverse — and rebuilt even
   * when seeking FORWARD, so that scrubbing to 3 s and scrubbing to 3 s after
   * watching it play give the same frame. (They would anyway: every path
   * through this class moves in whole `FIXED_DT` steps. Rebuilding is what
   * makes that a property of the code rather than a thing to remember.)
   */
  seek(t: number): void {
    this.reset()
    // `>= FIXED_DT / 2` rather than `> 0`: floating point puts the sum of n
    // steps a hair either side of n × dt, and the half-step slack keeps the
    // phase at 2.2 from sometimes being 264 steps and sometimes 263.
    const steps = Math.max(0, Math.round(t / FIXED_DT))
    for (let k = 0; k < steps; k++) this.advance()
  }

  /**
   * Play: advance by a frame of real time, scaled.
   *
   * Whole steps only, with the remainder carried, so playing to 3 s and
   * seeking to 3 s land on the same step count — a lab whose play and scrub
   * disagreed would be untrustworthy in exactly the way this page exists to
   * fix.
   */
  private owed = 0
  play(delta: number, speed: number, until = DURATION): void {
    this.owed += Math.max(0, Math.min(0.25, delta)) * speed
    while (this.owed >= FIXED_DT && this.t < until) {
      this.owed -= FIXED_DT
      this.advance()
    }
  }
}

/**
 * The default burn's phases — the centre burn the capture script photographs.
 * Down here because measuring them runs a `ScriptedBurn`, and a class does
 * not exist until the line that declares it has run.
 */
export const PHASES: readonly Phase[] = phasesFor()
