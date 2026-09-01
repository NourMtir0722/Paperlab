/**
 * Blowing at the paper.
 *
 * `cloth.wind` is the best-behaved knob in the library: the sim reads it every
 * frame and wakes on a change, so it moves in place with no rebuild and no
 * snap. That makes it the one parameter that can be driven CONTINUOUSLY by a
 * body, and the body part for wind is obvious.
 *
 * The signal is MediaPipe's `mouthPucker` blendshape, which ships in the same
 * package as the hand model and is literally the shape of blowing. Nothing
 * here listens to a microphone: a puckered mouth is a pose, it works in a
 * silent room, and it does not ask anyone for a second permission.
 */

/** A relaxed mouth is not perfectly zero, so the bottom of the range is spent. */
export const PUCKER_AT = 0.25
/** Past here you are blowing as hard as the sheet will ever be asked to notice. */
export const PUCKER_FULL = 0.75

/** 0 = not blowing, 1 = blowing hard. */
export function blowFromPucker(pucker: number): number {
  return Math.min(1, Math.max(0, (pucker - PUCKER_AT) / (PUCKER_FULL - PUCKER_AT)))
}

/** `cloth.wind` is capped at 1 by the schema; a blow spends the rest of it. */
export const WIND_MAX = 1

export function windFromBlow(blow: number, base: number): number {
  return base + (WIND_MAX - base) * blow
}

/**
 * The wind is a React prop, and a prop written every frame re-renders the tree
 * that owns the canvas — the one thing a harness measuring feel must not do.
 * So the value is quantised, and only a step change is published. Fifteen
 * steps between rest and a gale is finer than anyone can see the sheet
 * respond to, and it turns thirty renders a second into one or two.
 */
export const WIND_STEP = 0.05

export function quantiseWind(wind: number): number {
  return Math.round(Math.round(wind / WIND_STEP) * WIND_STEP * 100) / 100
}

/** How much of each new reading to believe. Blendshapes are noisy frame to frame. */
export const BREATH_SMOOTHING = 0.3

/**
 * The blow, smoothed and quantised into a wind the paper can be handed.
 *
 * Stateful for both reasons at once: the smoothing needs the last value, and
 * the deadband needs the last PUBLISHED value — a raw reading sitting exactly
 * on a step boundary would otherwise flip the prop back and forth forever.
 */
export class Breath {
  private level = 0
  private wind: number

  constructor(private readonly base: number) {
    this.wind = quantiseWind(base)
  }

  /** Feed a `mouthPucker` score, or `null` when there is no face to read. */
  push(pucker: number | null): number {
    const target = pucker === null ? 0 : blowFromPucker(pucker)
    this.level += (target - this.level) * BREATH_SMOOTHING
    const next = windFromBlow(this.level, this.base)
    if (Math.abs(next - this.wind) > WIND_STEP * 0.6) this.wind = quantiseWind(next)
    return this.wind
  }

  /** How hard the blow is reading, 0..1 — for the readout, not the paper. */
  get blow(): number {
    return this.level
  }

  reset(): void {
    this.level = 0
    this.wind = quantiseWind(this.base)
  }
}
