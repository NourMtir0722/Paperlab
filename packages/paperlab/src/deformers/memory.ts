import type { CreaseConfig } from '../config/schema'
import type { FoldOptions } from './fold'
import type { DeformerInstance } from './types'

/**
 * Paper memory: the sheet keeps what has been done to it.
 *
 * Every deformer is a pure function of its options — a sheet folded to 180°
 * and back to 0° flows through the stack and comes out pristine. That is
 * correct for cloth and wrong for paper, which is PLASTIC: the fibres break
 * along the fold and the crease outlives it.
 *
 * The fix lives here rather than inside the deformers, and deliberately.
 * Deformer purity is load-bearing — it is what gives the GLSL twins
 * something to be identical to, what lets the field scale one instance's
 * bend by a per-sheet bias, and what `test:parity` checks. So memory sits
 * ABOVE the stack: it watches the stack the behavior built, and it rewrites
 * that stack before it runs. Nothing below this file knows it exists.
 *
 * The whole layer is hero-path only. The field composes one GLSL program for
 * every sheet in an instanced draw call, and a crease is per-sheet state —
 * so a field of a hundred papers cannot carry a hundred crease sets without
 * per-instance attributes that don't exist yet. `applyMemory` is called from
 * `PaperMesh` and from nowhere in `field/`.
 */

/**
 * What a paper at `takesSet: 1` keeps of a fold, as a fraction of the angle
 * it was folded to.
 *
 * Kraft folded flat (180°) comes to rest around 30° open, which is `180 ×
 * 0.85 × 0.2`. Keeping this multiplier here rather than folding it into the
 * stock values is what lets `memory.set` and `Stock.takesSet` both be honest
 * 0..1 knobs that use their whole range, instead of designer-facing sliders
 * that do everything interesting in their bottom fifth.
 */
export const MAX_SET = 0.2

/**
 * Hinge width of a remembered crease, world units.
 *
 * Sharper than `fold`'s own 0.04 default, because a crease is not a fold: a
 * fold bends fibres that are pushing back, a crease is the line where they
 * already gave up. It is a constant rather than a schema field because it is
 * a property of broken paper and not a thing anyone tunes — `depth` is the
 * knob, and a second one here would only ever be set wrong.
 */
export const CREASE_RADIUS = 0.03

/**
 * How far a fold has to CLOSE, from however open it last was and at a line
 * that stays put, before it leaves a crease. Degrees.
 *
 * This is the rule that separates the two things `fold` is used for, and it
 * has to, because they are the same deformer. A crease is made by the ACT of
 * folding: the angle closes while the line is held. `unroll`'s landing hinge
 * is a fold instance that sits at exactly 90° forever while its line travels
 * down the sheet (a fixed floor is a moving line in sheet coordinates) —
 * paper coming off a roll and turning at the floor is BENT, not creased, and
 * a trail of creases left behind it would be the obvious bug. Measuring the
 * closing rather than the angle gets both right, and gets them right without
 * asking a behavior to declare anything about its own folds.
 */
export const CREASE_MIN_GROWTH = 45

/** How far a crease line may drift and still be the same crease. World units. */
export const CREASE_DRIFT = 0.02

/** And in degrees, for the travel direction. */
export const CREASE_DRIFT_ANGLE = 2

/** Below this the crease is neither visible nor worth a slot. Degrees. */
export const MIN_DEPTH = 1

/** What the crease shader carries, and so what memory may record. */
export const MAX_CREASES = 4

/**
 * A crease line in canonical form, for identity only.
 *
 * `(angle, offset)` and `(angle + 180, -offset)` name the same line through
 * the sheet — they differ in which half `fold` treats as the flap, not in
 * where the crease is. `letter-fold` uses exactly that pair (270 at +h/6 and
 * 90 at +h/6) and they are two DIFFERENT lines; folding both into a half-turn
 * range is what keeps them apart, and what stops a residual fold being
 * stacked on top of a live one that is already there.
 */
function canonicalLine(angle: number, offset: number): [number, number] {
  let a = ((angle % 360) + 360) % 360
  let o = offset
  if (a >= 180) {
    a -= 180
    o = -o
  }
  return [a, o]
}

/** Whether two folds/creases describe the same physical line on the sheet. */
export function sameLine(
  a: { angle: number; offset: number },
  b: { angle: number; offset: number },
): boolean {
  const [aa, ao] = canonicalLine(a.angle, a.offset)
  const [ba, bo] = canonicalLine(b.angle, b.offset)
  // Near 0/180 the canonical angle wraps, so compare the way an angle has to be.
  const d = Math.abs(aa - ba)
  const angleClose = Math.min(d, 180 - d) <= CREASE_DRIFT_ANGLE
  return angleClose && Math.abs(ao - bo) <= CREASE_DRIFT
}

/**
 * Fold a sheet's remembered creases into the stack that is about to run.
 *
 * A crease is a FLOOR on the fold at its line, never an addition. Where the
 * behavior is already folding that line further, the crease is invisible and
 * contributes nothing; as the behavior lets go, the fold angle falls to the
 * crease's depth and stops there. That is what makes the crease appear on
 * the way back out of a fold without anything having to detect the release —
 * and it is why the residual is written INTO the live instance rather than
 * added beside it. Two folds on one line would not be a deeper crease, they
 * would be two creases a hair apart, and `fold` does not commute.
 *
 * Creases with no live fold on their line are prepended: a sheet that is
 * already creased is creased BEFORE the behavior gets hold of it, so the
 * behavior bends a creased sheet rather than the crease bending a bent one.
 */
export function applyMemory(stack: DeformerInstance[], creases: CreaseConfig[]): DeformerInstance[] {
  if (creases.length === 0) return stack

  let out = stack
  const loose: CreaseConfig[] = []

  for (const crease of creases) {
    if (Math.abs(crease.depth) < MIN_DEPTH) continue
    const index = out.findIndex(
      (i) => i.type === 'fold' && i.enabled !== false && sameLine(i.options as FoldOptions, crease),
    )
    if (index === -1) {
      loose.push(crease)
      continue
    }
    const live = out[index]!
    const options = live.options as FoldOptions
    if (Math.abs(options.foldAngle) >= Math.abs(crease.depth)) continue
    // Copy on first write — the stack a behavior returns is not ours to edit,
    // and on a resting sheet it is the same array every frame.
    if (out === stack) out = [...stack]
    out[index] = { ...live, options: { ...options, foldAngle: crease.depth } }
  }

  if (loose.length === 0) return out
  return [...loose.map(toFold), ...out]
}

/** A remembered crease as the deformer that draws it. */
function toFold(crease: CreaseConfig): DeformerInstance {
  return {
    type: 'fold',
    options: {
      angle: crease.angle,
      offset: crease.offset,
      foldAngle: crease.depth,
      radius: CREASE_RADIUS,
    } satisfies FoldOptions,
  }
}

interface Slot {
  angle: number
  offset: number
  /** The most OPEN this line has been — every closing is measured from here. */
  trough: number
  /** The largest closing it has made from a trough. */
  bestGrowth: number
  /** How far shut it was at the top of that closing — the crease's own angle. */
  bestPeak: number
  /** Which way it was folded, so the crease opens back the way it came. */
  sign: number
}

/**
 * Watches a running deformer stack and records the creases it leaves.
 *
 * One per sheet, driven from the frame loop. It is deliberately not a
 * reducer over config: recording has to happen at frame rate to catch the
 * peak of a fold, and routing sixty writes a second through React would cost
 * more than the whole rest of the feature. Instead this holds the live truth
 * and says when it has changed, and the host persists that at its own pace —
 * the same split `onBehaviorChange` already uses for handle drags.
 *
 * Slots are keyed by POSITION in the stack, which is the only stable identity
 * a fold has: a behavior's stack is a pure function of its options, so
 * `stack[1]` is the same fold from frame to frame, while its angle and offset
 * are exactly the things that may legitimately move.
 */
export class CreaseTracker {
  private slots = new Map<number, Slot>()
  private recorded: CreaseConfig[] = []
  private authored: CreaseConfig[] = []

  constructor(authored: CreaseConfig[] = []) {
    this.authored = authored
  }

  /**
   * Forget how the paper got here without forgetting the creases.
   *
   * Called when the stack is replaced wholesale (a new behavior, a new
   * sheet): the slots describe folds that no longer exist, but a crease is a
   * property of the paper and survives being put down and picked up.
   */
  reset(authored: CreaseConfig[] = this.creases): void {
    this.slots.clear()
    this.recorded = []
    this.authored = authored
  }

  /**
   * Take on a crease set that came from outside — a config edit, a shared
   * link, or this tracker's own recording after the host has persisted it.
   *
   * Slots are deliberately left alone. They describe the folds currently
   * running, which is a different question from what the paper carries, and
   * clearing them here would stall a crease mid-fold: the host writes back
   * the moment a crease appears, and if that write reset the peak, the rest
   * of the same fold would count as growth from a base it had already passed.
   */
  adopt(creases: CreaseConfig[]): void {
    this.authored = creases
    this.recorded = []
  }

  /** Everything the sheet currently carries, authored and recorded merged. */
  get creases(): CreaseConfig[] {
    return merge(this.authored, this.recorded)
  }

  /**
   * Take one frame's reading. Returns true when the crease set changed by
   * enough to be worth telling anyone about.
   */
  observe(stack: DeformerInstance[], set: number): boolean {
    if (set <= 0) return false

    for (let i = 0; i < stack.length; i++) {
      const instance = stack[i]!
      if (instance.type !== 'fold' || instance.enabled === false) continue
      const o = instance.options as FoldOptions
      const magnitude = Math.abs(o.foldAngle)
      const slot = this.slots.get(i)

      // A fold we have not seen, or one whose line has travelled out from
      // under itself. Either way the paper it is bending now is not the paper
      // it was bending, so counting starts again from where it is.
      //
      // The comparison is against where the line SETTLED, never against last
      // frame — absorbing drift a frame at a time would let a slowly
      // travelling hinge creep the length of the sheet without ever tripping
      // the tolerance it exists to trip.
      if (
        !slot ||
        Math.abs(slot.angle - o.angle) > CREASE_DRIFT_ANGLE ||
        Math.abs(slot.offset - o.offset) > CREASE_DRIFT
      ) {
        this.slots.set(i, {
          angle: o.angle,
          offset: o.offset,
          trough: magnitude,
          bestGrowth: 0,
          bestPeak: magnitude,
          sign: o.foldAngle < 0 ? -1 : 1,
        })
        continue
      }

      // The crease is the biggest CLOSING this line has made, measured from
      // however open it last was — not from wherever we happened to start
      // watching. A letter that arrives folded and is opened has closed
      // nothing, and creases nothing; open it and fold it again and the same
      // line has now made the whole travel, and creases. Both readings fall
      // out of a running minimum and nothing else.
      if (magnitude < slot.trough) slot.trough = magnitude
      const growth = magnitude - slot.trough
      if (growth > slot.bestGrowth) {
        slot.bestGrowth = growth
        slot.bestPeak = magnitude
        slot.sign = o.foldAngle < 0 ? -1 : 1
      }
    }

    const next: CreaseConfig[] = []
    for (const slot of this.slots.values()) {
      if (slot.bestGrowth < CREASE_MIN_GROWTH) continue
      const depth = slot.sign * slot.bestPeak * set * MAX_SET
      if (Math.abs(depth) < MIN_DEPTH) continue
      next.push({ angle: slot.angle, offset: slot.offset, depth })
    }

    if (same(next, this.recorded)) return false
    this.recorded = next
    return true
  }
}

/**
 * Merge two crease sets, deepest wins per line, capped at what the shader
 * carries.
 *
 * Recorded creases meet authored ones on the same line whenever a preset
 * ships pre-creased and then gets folded along its own crease — and the
 * answer there is the deeper of the two, not their sum: folding a creased
 * sheet along its crease does not double the crease, it just re-makes it.
 */
function merge(authored: CreaseConfig[], recorded: CreaseConfig[]): CreaseConfig[] {
  const out: CreaseConfig[] = []
  for (const crease of [...recorded, ...authored]) {
    const existing = out.find((c) => sameLine(c, crease))
    if (!existing) {
      // Copied, not shared. The deeper-wins line below WRITES to whatever is
      // in `out`, and pushing the argument by reference pointed that write
      // straight back into `this.recorded` — so reading the merged view
      // rewrote the depth that had just been recorded, the next frame saw a
      // change that was nothing but its own echo, and the tracker reported
      // one every frame for as long as an authored crease sat deeper than
      // the fold could make it.
      out.push({ ...crease })
      continue
    }
    if (Math.abs(crease.depth) > Math.abs(existing.depth)) existing.depth = crease.depth
  }
  // Over the cap, the deepest creases are the ones anyone would miss.
  if (out.length > MAX_CREASES) {
    out.sort((a, b) => Math.abs(b.depth) - Math.abs(a.depth))
    out.length = MAX_CREASES
  }
  return out
}

/** Whether two crease sets are the same to within a degree of depth. */
function same(a: CreaseConfig[], b: CreaseConfig[]): boolean {
  if (a.length !== b.length) return false
  return a.every((crease, i) => {
    const other = b[i]!
    return sameLine(crease, other) && Math.abs(crease.depth - other.depth) < 0.5
  })
}
