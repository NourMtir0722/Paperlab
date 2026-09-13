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
   * How much of the sheet the fire has eaten by the time it is out, 0..1. 1
   * burns all of it.
   *
   * What a person asks for is how much burns, and a fire cannot be told to
   * stop there: its front has momentum, and once it starts to die it takes
   * `decay` seconds to. So this becomes WHEN it starts to die — `decayAtFor`
   * guesses, and `planBurn` measures the burn that guess gives and corrects
   * it until the cold sheet is what was asked for.
   */
  amount: number
  /**
   * When the fire starts to die, as how much of the sheet is gone, 0..1 —
   * worked out from `amount` unless it is set here. 1 never dies: it eats
   * the sheet. Measured on what is gone rather than on the clock, so
   * "halfway" means the same thing from the centre and from a corner.
   */
  decayAt?: number
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
  // A third: the fire gives up while the hole is still a hole, with paper all
  // round it. Before this was an amount the fire started to die at 0.22 gone,
  // which measured out at 33% burnt. It had been 0.5, which at the field's
  // pace ran past 13 s and ate 62% of the sheet — "dying" was a strip of paper
  // under huge flames.
  amount: 0.33,
  decay: 2.5,
  smoulder: 2.2,
  ash: 1,
  smoke: true,
}

/** At or past this, "how much burns" means all of it: the fire is never told to die. */
const ALL = 0.995

/**
 * How much of the sheet a burn has eaten once it is out, for when it starts
 * to die — `[decayAt, burnt]`, measured with the defaults, per origin.
 *
 * The fire overshoots. Past the moment it starts to die its front runs on
 * for the `decay` seconds dying takes, and from the centre that is about a
 * tenth of the sheet more. The corner's line of fire is shorter than the
 * centre's ring, so it overshoots less.
 *
 * Only a first guess: `planBurn` measures the burn it gives and corrects it,
 * so a change to the field's rates costs a correction step, not a wrong
 * answer. `burn.test.ts` checks the guess stays close enough to be worth
 * making.
 */
const BURNT_FOR: Record<BurnOrigin, readonly (readonly [number, number])[]> = {
  center: [
    [0.005, 0.024],
    [0.02, 0.053],
    [0.05, 0.1],
    [0.1, 0.171],
    [0.15, 0.237],
    [0.22, 0.326],
    [0.3, 0.42],
    [0.4, 0.499],
    [0.5, 0.591],
    [0.6, 0.662],
    [0.7, 0.737],
    [0.8, 0.835],
    [0.9, 0.937],
    [1, 1],
  ],
  corner: [
    [0.005, 0.015],
    [0.02, 0.037],
    [0.05, 0.078],
    [0.1, 0.136],
    [0.15, 0.193],
    [0.22, 0.271],
    [0.3, 0.36],
    [0.4, 0.453],
    [0.5, 0.544],
    [0.6, 0.643],
    [0.7, 0.74],
    [0.8, 0.838],
    [0.9, 0.936],
    [1, 1],
  ],
}

/**
 * When to start the fire dying so that `amount` of the sheet ends up burnt —
 * the table's guess, read backwards. Past the table's ends it carries on
 * along the nearest segment.
 */
export function decayAtFor(amount: number, origin: BurnOrigin): number {
  if (amount >= ALL) return 1
  const table = BURNT_FOR[origin]
  let k = 1
  while (k < table.length - 1 && table[k]![1] < amount) k++
  const [d0, b0] = table[k - 1]!
  const [d1, b1] = table[k]!
  const d = d0 + ((amount - b0) * (d1 - d0)) / (b1 - b0)
  return Math.min(0.99, Math.max(0.005, d))
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
  return planBurn(config).phases
}

/**
 * The longest a burn is ever stepped for, simulated seconds. Told to eat the
 * whole sheet, a burn from the corner goes out at about 45 s and is cold at
 * about 49; this has room past that, and still ends a burn that never does.
 */
export const LONGEST = 60

/** How near the amount asked for a burn has to end up, as a share of the sheet. */
const WITHIN = 0.01

/** At most this many burns are stepped to find the one that ends up as asked. */
const TRIES = 4

/**
 * How much of the sheet has to come loose before it counts as a piece — a
 * twentieth of a percent less than this is a few stray texels on the rim.
 */
const LOOSE = 0.005

/** Everything the lab needs to know about a burn before it draws a frame of it. Measured, not written down. */
export interface BurnPlan {
  /** When it starts to die, as how much of the sheet is gone — the setting that ends at `burnt`. */
  decayAt: number
  /** How much of the sheet it has eaten once it is cold, 0..1. */
  burnt: number
  /** How long it is worth watching: past cold, and never shorter than `DURATION`. */
  duration: number
  /** When the last flame went out, or null if none did inside `LONGEST`. */
  wentOut: number | null
  /**
   * When the burn first cut a piece loose — paper no longer joined to the top
   * edge the lab hangs the sheet by — or null if it never did. That piece
   * falls.
   */
  severedAt: number | null
  /** §9's moments, at the times this burn reaches them. */
  phases: Phase[]
}

/**
 * How much of the sheet is paper no longer joined to its top edge, 0..1: a
 * piece the burn has cut loose, which drops off a sheet hung by that edge.
 * Flooded from the top row through the four neighbours, on the line the
 * sheet cuts at.
 */
export function looseShare(field: DamageField): number {
  const size = field.size
  const pixels = field.pixels
  const seen = new Uint8Array(size * size)
  const stack: number[] = []
  let present = 0
  for (let i = 0; i < size * size; i++) if (pixels[i * 4 + PRESENCE]! >= 128) present++
  const visit = (cell: number) => {
    if (seen[cell] || pixels[cell * 4 + PRESENCE]! < 128) return
    seen[cell] = 1
    stack.push(cell)
  }
  for (let x = 0; x < size; x++) visit((size - 1) * size + x)
  let held = 0
  while (stack.length > 0) {
    const cell = stack.pop()!
    held++
    const x = cell % size
    if (x > 0) visit(cell - 1)
    if (x < size - 1) visit(cell + 1)
    if (cell >= size) visit(cell - size)
    if (cell < size * (size - 1)) visit(cell + size)
  }
  return (present - held) / (size * size)
}

const plans = new Map<string, BurnPlan>()

/**
 * The burn these settings ask for, stepped headlessly and measured — the
 * seven moments of §9, how much it eats, how long it lasts, and whether it
 * cuts a piece loose.
 *
 * Asked for an amount, it guesses when the fire should start to die
 * (`decayAtFor`), steps that burn to cold, and corrects the guess along the
 * line through its last two tries until the sheet ends up within a percent
 * of the amount. At the defaults the guess is already there and one burn is
 * stepped, as it always was. Remembered per settings: the lab asks on every
 * render.
 */
export function planBurn(config: Partial<BurnSettings> = {}): BurnPlan {
  const settings: BurnSettings = { ...BURN_DEFAULTS, ...config }
  const key = JSON.stringify(settings)
  const known = plans.get(key)
  if (known) return known

  let decayAt = settings.decayAt ?? decayAtFor(settings.amount, settings.origin)
  let run = measure(settings, decayAt)
  if (settings.decayAt === undefined && decayAt < 1) {
    let best = run
    let bestAt = decayAt
    let prev: { decayAt: number; burnt: number } | null = null
    for (let tries = 1; tries < TRIES && Math.abs(best.burnt - settings.amount) > WITHIN; tries++) {
      // A secant through the last two tries; the first has only the guess, and
      // the table says a burn's overshoot moves about one for one with it.
      const slope =
        prev && Math.abs(run.burnt - prev.burnt) > 1e-4
          ? (decayAt - prev.decayAt) / (run.burnt - prev.burnt)
          : 1
      prev = { decayAt, burnt: run.burnt }
      decayAt = Math.min(
        0.99,
        Math.max(0.005, decayAt + (settings.amount - run.burnt) * Math.min(3, Math.max(0.2, slope))),
      )
      run = measure(settings, decayAt)
      if (Math.abs(run.burnt - settings.amount) < Math.abs(best.burnt - settings.amount)) {
        best = run
        bestAt = decayAt
      }
    }
    run = best
    decayAt = bestAt
  }

  const { burn, caught, holed, browned, peakAt, asleepAt, severedAt } = run
  const out = burn.wentOut
  const from = burn.decayStarted
  const peak = moment(peakAt)
  const catchAt = moment(Math.min(Math.max(holed, caught, 0) + 0.35, peakAt - 0.3))
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
  // As long as this burn is worth watching: to cold and a second past it. The
  // scrubber used to be 24 s for every burn, which was right for the default
  // and cut the ending off any burn asked to eat more of the sheet.
  const coldAt = coldFor(asleepAt, out, settings.smoulder)
  const duration = Math.max(DURATION, Math.min(LONGEST, Math.ceil(coldAt + 1.6)))
  const end = out ?? duration - 0.5
  const dying = moment(Math.min(from !== null ? from + settings.decay * 0.5 : (peakAt + end) / 2, end - 0.1))
  const smoulder = moment(Math.min(end + 0.4, duration - 0.3))
  const cold = moment(Math.min(duration - 0.05, coldAt + 0.6))
  const unfinished =
    out === null
      ? `the fire is still burning at ${LONGEST} s — it has not gone out, so this is not yet the end`
      : undefined
  const corner = settings.origin === 'corner'
  const phases: Phase[] = [
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
  const plan: BurnPlan = { decayAt, burnt: run.burnt, duration, wentOut: out, severedAt, phases }
  // A handful is plenty — the lab asks again for the settings on screen, not
  // for every combination it has ever shown.
  if (plans.size > 32) plans.clear()
  plans.set(key, plan)
  return plan
}

/** One burn, stepped from contact until it is cold, with no sheet to throw particles at — and read as it goes. */
function measure(settings: BurnSettings, decayAt: number) {
  const burn = new ScriptedBurn(() => null, { ...settings, decayAt })
  let caught = -1
  let holed = -1
  let browned = -1
  let peakAt = 0
  let best = -1
  let asleepAt = -1
  let severedAt: number | null = null
  let steps = 0
  while (burn.time < LONGEST - FIXED_DT / 2) {
    burn.advance()
    steps++
    const s = burn.stats
    if (browned < 0 && s.charred > 0) browned = burn.time
    if (caught < 0 && s.remaining < 1) caught = burn.time
    // A HOLE, not the first texel starting to go. `flameAnchors` stands a
    // flame on hot paper with a cut beside it, and "a cut" means a neighbour
    // under half presence — so until one texel is actually through, there is
    // no rim and the fire has no flames to draw. `caught` is the first loss
    // of any presence at all, which at the field's dilated clock is most of a
    // second earlier: the "catch · first flames" frame photographed a scorch
    // mark with nothing standing on it.
    if (holed < 0 && s.consumed > 0) holed = burn.time
    if (s.front > best) {
      best = s.front
      peakAt = burn.time
    }
    // Every tenth of a second is fine enough to say when a piece came loose,
    // and a flood fill on every step is not free.
    if (severedAt === null && holed >= 0 && steps % 12 === 0 && looseShare(burn.field) > LOOSE) {
      severedAt = burn.time
    }
    const out = burn.wentOut
    if (asleepAt < 0 && out !== null && burn.field.asleep) asleepAt = burn.time
    // Cold, and a second past it: nothing else is going to happen.
    if (out !== null && burn.time >= coldFor(asleepAt, out, settings.smoulder) + 1) break
  }
  return { burn, caught, holed, browned, peakAt, asleepAt, severedAt, burnt: 1 - burn.stats.remaining }
}

/**
 * The longest "cold" waits past the last bead's smoulder for the field to
 * sleep, in seconds.
 *
 * Cold is when the field sleeps — the last of its heat under the rest
 * threshold — and by then that heat has long stopped drawing anything. Once
 * the flames are out the field cools at its own slow rate, and how long its
 * last warmth takes depends on where the fire happened to stop: a third of
 * the sheet from a corner slept fifteen seconds after its last bead went out,
 * and waiting for it stretched the scrubber over a quarter of a minute of a
 * picture that never changed.
 */
const COLD_WAIT = 2

/** When a burn is over: its field asleep — never before the beads' smoulder ends, and never more than {@link COLD_WAIT} after. */
function coldFor(asleepAt: number, out: number | null, smoulder: number): number {
  if (out === null) return LONGEST
  const beadsOut = out + smoulder
  const slept = asleepAt < 0 ? Number.POSITIVE_INFINITY : asleepAt
  return Math.min(beadsOut + COLD_WAIT, Math.max(slept, beadsOut))
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
  /** `FxMatchFlame` — the match that lights it, for as long as it is held. */
  match: boolean
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
  match: true,
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
    const decayAt = this.config.decayAt ?? decayAtFor(this.config.amount, this.config.origin)
    if (this.decayFrom === null && decayAt < 1 && gone >= decayAt) this.decayFrom = this.t
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
