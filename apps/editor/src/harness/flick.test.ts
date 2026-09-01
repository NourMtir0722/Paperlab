import { describe, expect, it } from 'vitest'
import { FLICK_HOLD_MS, FLICK_SPEED, FlickTracker, PIGMENTS, isFlick, washFromFlick } from './flick'

/** Move a pinched hand along a straight line, then open it at `openAt`. */
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
  // Pinch, travel for `held` ms at `speed` camera widths a second, then open.
  for (; t <= held; t += step) {
    tracker.push({ x, y }, true, t)
    x += ((dx / length) * speed * step) / 1000
    y += ((dy / length) * speed * step) / 1000
  }
  return tracker.push({ x, y }, false, t)
}

describe('FlickTracker', () => {
  it('reads a fast snap as a flick', () => {
    const release = snap({ speed: 2.5 })
    expect(release).not.toBeNull()
    expect(release!.speed).toBeGreaterThan(FLICK_SPEED)
    expect(release!.dx).toBeGreaterThan(0)
    expect(isFlick(release!)).toBe(true)
  })

  it('reports a slow release too, and it is not a flick', () => {
    // Every release is reported. Whether it MEANT anything is the page's
    // call, because the same snap with the sheet in your hand is a throw.
    const release = snap({ speed: 0.3 })
    expect(release).not.toBeNull()
    expect(isFlick(release!)).toBe(false)
  })

  it('does not call a fast release at the end of a long pull a flick', () => {
    // The one that keeps tearing an edge from spattering the sheet: a yank is
    // fast when it gives, but it is a pull you have been making for a second.
    const release = snap({ speed: 2.5, held: FLICK_HOLD_MS + 200 })
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
    for (let x = 0.5; t <= 100; t += 20, x += 0.05) tracker.push({ x, y: 0.5 }, true, t)
    expect(tracker.push({ x: 0.8, y: 0.5 }, false, t)).not.toBeNull()
    expect(tracker.push({ x: 0.8, y: 0.5 }, false, t + 20)).toBeNull()
  })

  it('forgets everything when the hand leaves the frame', () => {
    const tracker = new FlickTracker()
    let t = 0
    for (let x = 0.5; t <= 100; t += 20, x += 0.05) tracker.push({ x, y: 0.5 }, true, t)
    expect(tracker.push(null, true, t)).toBeNull()
    // The hand came back open: no pinch was ever seen closing, so no flick.
    expect(tracker.push({ x: 0.8, y: 0.5 }, false, t + 20)).toBeNull()
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
    const hard = washFromFlick({ speed: 4, dx: -1, dy: 0 }, 0)
    expect(hard.blooms).toBeGreaterThan(soft.blooms)
    expect(hard.intensity).toBeGreaterThan(soft.intensity)
    expect(hard.spread).toBeLessThan(soft.spread)
  })

  it('keeps the edge darkening whatever the flick did', () => {
    // Without it a wash reads as an airbrush rather than as watercolour, so
    // it is not something a gesture is allowed to turn down.
    expect(washFromFlick({ speed: 9, dx: -1, dy: 0 }, 0).edge).toBeGreaterThan(0.5)
  })

  it('keeps the seed inside the schema whatever it is handed', () => {
    expect(washFromFlick({ speed: 2, dx: -1, dy: 0 }, 517).seed).toBe(17)
    expect(washFromFlick({ speed: 2, dx: -1, dy: 0 }, -3).seed).toBe(97)
  })
})
