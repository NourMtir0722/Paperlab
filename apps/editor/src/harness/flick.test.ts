import { describe, expect, it } from 'vitest'
import { FLICK_HOLD_MS, FLICK_SPEED, FlickTracker, PIGMENTS, isFlick, washFromFlick } from './flick'

/** A hand's own ruler, the same fixed 0.2 the pose fixtures use. */
const PALM = 0.2
/** 4:3, the shape of the camera the harness asks for. */
const ASPECT = 4 / 3

/**
 * Move a pinched hand along a straight line, then open it.
 *
 * `speed` is in PALMS A SECOND, which is what the tracker now reports — and
 * the travel is laid out so that it really is: the step is divided back
 * through the palm and, on x, through the aspect the tracker multiplies in.
 * A flick has to mean the same thing in every direction, and writing the
 * fixture this way is what makes `dy` a real test of that rather than a
 * repeat of `dx`.
 */
function snap({
  speed,
  held = 200,
  dx = 1,
  dy = 0,
}: {
  speed: number
  held?: number
  dx?: number
  dy?: number
}) {
  const tracker = new FlickTracker()
  const step = 20
  const length = Math.hypot(dx, dy)
  let x = 0.5
  let y = 0.5
  let t = 0
  const travel = (speed * PALM * step) / 1000 / length
  for (; t <= held; t += step) {
    tracker.push({ x, y }, true, t, ASPECT, PALM)
    x += (dx * travel) / ASPECT
    y += dy * travel
  }
  return tracker.push({ x, y }, false, t, ASPECT, PALM)
}

describe('FlickTracker', () => {
  it('reads a fast snap as a flick', () => {
    const release = snap({ speed: 12 })
    expect(release).not.toBeNull()
    expect(release!.speed).toBeCloseTo(12, 6)
    expect(release!.dx).toBeGreaterThan(0)
    expect(isFlick(release!)).toBe(true)
  })

  it('reads a snap the same speed in any direction', () => {
    // The measurement used to mix units: x normalised by the frame's WIDTH
    // and y by its HEIGHT, hypotenused together. On a 4:3 camera that made a
    // vertical flick read a third slower than the identical horizontal one,
    // so the gesture had a preferred direction. Every scripted flick in this
    // file travelled sideways, which is why nothing caught it.
    const across = snap({ speed: 12, dx: 1, dy: 0 })
    const down = snap({ speed: 12, dx: 0, dy: 1 })
    const diagonal = snap({ speed: 12, dx: 1, dy: 1 })
    expect(across!.speed).toBeCloseTo(down!.speed, 6)
    expect(diagonal!.speed).toBeCloseTo(across!.speed, 6)
  })

  it('does not fire faster because the hand came closer to the camera', () => {
    // A hand nearer the lens covers more of the frame at the same real speed.
    // Everything else in this harness is measured in palms for exactly that
    // reason; this was the one measurement that was not.
    const tracker = new FlickTracker()
    let t = 0
    // The same travel, reported by a hand that reads twice as large.
    for (let x = 0.5; t <= 100; t += 20, x += 0.05) tracker.push({ x, y: 0.5 }, true, t, ASPECT, PALM * 2)
    const near = tracker.push({ x: 0.8, y: 0.5 }, false, t, ASPECT, PALM * 2)

    const far = new FlickTracker()
    t = 0
    for (let x = 0.5; t <= 100; t += 20, x += 0.025) far.push({ x, y: 0.5 }, true, t, ASPECT, PALM)
    const small = far.push({ x: 0.65, y: 0.5 }, false, t, ASPECT, PALM)
    // Half the frame travelled by half the hand is the same gesture.
    expect(near!.speed).toBeCloseTo(small!.speed, 6)
  })

  it('reports a slow release too, and it is not a flick', () => {
    // Every release is reported. Whether it MEANT anything is the page's
    // call, because the same snap with the sheet in your hand is a throw.
    const release = snap({ speed: 1.5 })
    expect(release).not.toBeNull()
    expect(isFlick(release!)).toBe(false)
  })

  it('does not call a fast release at the end of a long pull a flick', () => {
    // The one that keeps tearing an edge from spattering the sheet: a yank is
    // fast when it gives, but it is a pull you have been making for a second.
    const release = snap({ speed: 12, held: FLICK_HOLD_MS + 200 })
    expect(release!.speed).toBeGreaterThan(FLICK_SPEED)
    expect(release!.heldMs).toBeGreaterThan(FLICK_HOLD_MS)
    expect(isFlick(release!)).toBe(false)
    // A throw does not read the duration at all — you can hold a sheet as
    // long as you like and still whip it away at the end.
    expect(release!.speed >= FLICK_SPEED).toBe(true)
  })

  it('fires once, not on every open frame after', () => {
    const tracker = new FlickTracker()
    let t = 0
    for (let x = 0.5; t <= 100; t += 20, x += 0.05) tracker.push({ x, y: 0.5 }, true, t, ASPECT, PALM)
    expect(tracker.push({ x: 0.8, y: 0.5 }, false, t, ASPECT, PALM)).not.toBeNull()
    expect(tracker.push({ x: 0.8, y: 0.5 }, false, t + 20, ASPECT, PALM)).toBeNull()
  })

  it('forgets everything when the hand leaves the frame', () => {
    const tracker = new FlickTracker()
    let t = 0
    for (let x = 0.5; t <= 100; t += 20, x += 0.05) tracker.push({ x, y: 0.5 }, true, t, ASPECT, PALM)
    expect(tracker.push(null, true, t, ASPECT, PALM)).toBeNull()
    // The hand came back open: no pinch was ever seen closing, so no flick.
    expect(tracker.push({ x: 0.8, y: 0.5 }, false, t + 20, ASPECT, PALM)).toBeNull()

    // A hand with no measurable palm is a hand the tracker cannot measure at
    // all, and is treated as one that left.
    const noRuler = new FlickTracker()
    let u = 0
    for (let x = 0.5; u <= 100; u += 20, x += 0.05) noRuler.push({ x, y: 0.5 }, true, u, ASPECT, PALM)
    expect(noRuler.push({ x: 0.8, y: 0.5 }, false, u, ASPECT, null)).toBeNull()
  })
})

describe('washFromFlick', () => {
  it('picks its pigment by where the paint went, in screen terms', () => {
    // The camera is mirrored, so a flick to the RIGHT on screen travels
    // toward decreasing camera x. Getting this backwards paints the colour
    // you aimed away from.
    expect(washFromFlick({ speed: 2, dx: -1, dy: 0 }, 0).color).toBe(PIGMENTS[0].color)
    expect(washFromFlick({ speed: 2, dx: 1, dy: 0 }, 0).color).toBe(PIGMENTS[2].color)
    expect(washFromFlick({ speed: 2, dx: 0, dy: 1 }, 0).color).toBe(PIGMENTS[1].color)
    expect(washFromFlick({ speed: 2, dx: 0, dy: -1 }, 0).color).toBe(PIGMENTS[3].color)
  })

  it('throws more, smaller pools the harder it is flicked', () => {
    const soft = washFromFlick({ speed: FLICK_SPEED, dx: -1, dy: 0 }, 0)
    const hard = washFromFlick({ speed: 14, dx: -1, dy: 0 }, 0)
    expect(hard.blooms).toBeGreaterThan(soft.blooms)
    expect(hard.intensity).toBeGreaterThan(soft.intensity)
    expect(hard.spread).toBeLessThan(soft.spread)
  })

  it('keeps the edge darkening whatever the flick did', () => {
    // Without it a wash reads as an airbrush rather than as watercolour, so
    // it is not something a gesture is allowed to turn down.
    expect(washFromFlick({ speed: 30, dx: -1, dy: 0 }, 0).edge).toBeGreaterThan(0.5)
  })

  it('keeps the seed inside the schema whatever it is handed', () => {
    expect(washFromFlick({ speed: 2, dx: -1, dy: 0 }, 517).seed).toBe(17)
    expect(washFromFlick({ speed: 2, dx: -1, dy: 0 }, -3).seed).toBe(97)
  })
})
