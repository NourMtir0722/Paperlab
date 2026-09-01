import { describe, expect, it } from 'vitest'
import { ASPECT, PALM, POSES, hand } from './hands.fixtures'
import {
  FINGERS,
  INDEX_TIP,
  THUMB_TIP,
  distance,
  fingerCurl,
  handCurl,
  isExtended,
  palmLength,
  palmRoll,
  palmsApart,
  spatialDistance,
  pinchAperture,
  pinchPoint,
  type Landmark,
} from './landmarks'

describe('palmLength', () => {
  it('measures the ruler everything else is divided by', () => {
    expect(palmLength(hand(), ASPECT)!).toBeCloseTo(PALM, 6)
  })

  it('returns null when there is no palm to measure', () => {
    expect(palmLength([], ASPECT)).toBeNull()
    const collapsed: Landmark[] = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }))
    expect(palmLength(collapsed, ASPECT)).toBeNull()
  })
})

describe('pinchAperture', () => {
  it('reads a closed pinch as a fraction of a palm and an open hand as more', () => {
    expect(pinchAperture(POSES.pinch(), ASPECT)!).toBeCloseTo(0.2, 6)
    expect(pinchAperture(POSES.palm(), ASPECT)!).toBeCloseTo(1.5, 6)
  })

  it('is unchanged by distance from the camera', () => {
    // The same hand, half the size: leaning back must not release the grab,
    // which is the entire reason the aperture is normalised by the palm.
    const near = POSES.pinch()
    const far = near.map((l) => ({ x: 0.5 + (l.x - 0.5) / 2, y: 0.5 + (l.y - 0.5) / 2, z: 0 }))
    expect(pinchAperture(far, ASPECT)!).toBeCloseTo(pinchAperture(near, ASPECT)!, 6)
  })

  it('measures a sideways pinch the same as an upright one', () => {
    // Normalised landmarks divide x by width and y by height. Without the
    // aspect correction the same gesture reads 33% wider held sideways on a
    // 4:3 camera, and the grab lets go when you rotate your wrist.
    const upright = POSES.pinch()
    const sideways = upright.map((l, i) =>
      i === THUMB_TIP ? { x: 0.5 + (0.2 * PALM) / ASPECT, y: upright[INDEX_TIP]!.y, z: 0 } : l,
    )
    expect(pinchAperture(sideways, ASPECT)!).toBeCloseTo(pinchAperture(upright, ASPECT)!, 6)
  })

  it('returns null rather than NaN for a hand it cannot measure', () => {
    expect(pinchAperture([], ASPECT)).toBeNull()
  })
})

describe('pinchPoint', () => {
  it('holds at the midpoint of thumb and finger, not at the fingertip', () => {
    const h = hand()
    const mid = pinchPoint(h)!
    expect(mid.y).toBeCloseTo((h[THUMB_TIP]!.y + h[INDEX_TIP]!.y) / 2, 6)
  })

  it('returns null when the pinch landmarks are missing', () => {
    expect(pinchPoint([])).toBeNull()
  })
})

describe('fingerCurl', () => {
  it('is 0 for a straight finger and 1 for one folded into the palm', () => {
    expect(fingerCurl(hand({ reach: [2, 2, 2, 2] }), FINGERS[0], ASPECT)!).toBeCloseTo(0, 6)
    expect(fingerCurl(hand({ reach: [1, 1, 1, 1] }), FINGERS[0], ASPECT)!).toBeCloseTo(1, 6)
  })

  it('clamps rather than running past either end', () => {
    expect(fingerCurl(hand({ reach: [2.6, 2, 2, 2] }), FINGERS[0], ASPECT)).toBe(0)
    expect(fingerCurl(hand({ reach: [0.4, 2, 2, 2] }), FINGERS[0], ASPECT)).toBe(1)
  })

  it('reads each finger independently', () => {
    const h = hand({ reach: [2, 1, 2, 1] })
    expect(fingerCurl(h, FINGERS[0], ASPECT)).toBeCloseTo(0, 6)
    expect(fingerCurl(h, FINGERS[1], ASPECT)).toBeCloseTo(1, 6)
    expect(fingerCurl(h, FINGERS[3], ASPECT)).toBeCloseTo(1, 6)
  })
})

describe('handCurl', () => {
  it('runs from an open hand to a tight fist', () => {
    expect(handCurl(POSES.palm(), ASPECT)!).toBeCloseTo(0, 6)
    expect(handCurl(POSES.fist(), ASPECT)!).toBeCloseTo(1, 6)
  })

  it('is continuous in between, so a squeeze can drive something', () => {
    const half = handCurl(hand({ reach: [1.5, 1.5, 1.5, 1.5] }), ASPECT)!
    expect(half).toBeCloseTo(0.5, 6)
  })

  it('returns null for a hand it cannot measure', () => {
    expect(handCurl([], ASPECT)).toBeNull()
  })
})

describe('isExtended', () => {
  it('separates a reaching finger from a folded one', () => {
    expect(isExtended(POSES.point(), FINGERS[0], ASPECT)).toBe(true)
    expect(isExtended(POSES.point(), FINGERS[1], ASPECT)).toBe(false)
  })
})

describe('palmRoll', () => {
  it('reads a hand with its fingers up as zero', () => {
    expect(palmRoll(hand(), ASPECT)!).toBeCloseTo(0, 6)
  })

  it('reads a turn the way it looks on screen, not the way the camera sees it', () => {
    // The feed is mirrored. A hand tilted to YOUR right appears tilted right,
    // and that is the direction anyone aiming at a dial will expect — so the
    // sign here is the difference between a dial and a puzzle.
    const tilted = hand()
    // Move the knuckle toward increasing camera x, which is toward your LEFT.
    tilted[9] = { x: tilted[0]!.x + 0.1, y: tilted[0]!.y - 0.1, z: 0 }
    expect(palmRoll(tilted, ASPECT)!).toBeLessThan(0)
  })

  it('reports nothing when there is no hand to measure', () => {
    expect(palmRoll([], ASPECT)).toBeNull()
  })
})

describe('palmsApart', () => {
  it('measures in palms, so leaning toward the camera is not a pull', () => {
    const near = palmsApart({ x: 0.3, y: 0.5 }, { x: 0.7, y: 0.5 }, 0.2, 1)
    const leaning = palmsApart({ x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 }, 0.3, 1)
    expect(near).toBeCloseTo(2, 6)
    expect(leaning).toBeCloseTo(2, 6)
  })
})

describe('the depth axis', () => {
  it('measures the same pinch the same, whichever way the hand is turned', () => {
    // The tracker reports a `z` and nothing used to read it. A hand turned
    // side-on puts the thumb BEHIND the finger rather than beside it, and in
    // the image plane those two landmarks are on top of each other.
    const across = hand({ gap: 1.5 })
    const intoFrame = hand({ gap: 1.5, towardCamera: true })
    expect(pinchAperture(across, ASPECT)!).toBeCloseTo(1.5, 6)
    expect(pinchAperture(intoFrame, ASPECT)!).toBeCloseTo(1.5, 6)
  })

  it('would have read a wide open hand as a closed pinch without it', () => {
    // What the bug actually was: the same hand, measured in the image plane
    // alone, has its thumb and finger in the same place.
    const intoFrame = hand({ gap: 1.5, towardCamera: true })
    expect(distance(intoFrame[THUMB_TIP]!, intoFrame[INDEX_TIP]!, ASPECT)).toBeCloseTo(0, 6)
    expect(spatialDistance(intoFrame[THUMB_TIP]!, intoFrame[INDEX_TIP]!, ASPECT)).toBeCloseTo(1.5 * PALM, 6)
  })

  it('can only ever make a pinch harder to register, never invent one', () => {
    // A 3D distance is never shorter than its own projection, so depth noise
    // pushes the aperture up. That one-sidedness is why the pinch reads `z`
    // and the curls do not — there, inflation would ratchet a crush.
    for (const z of [-0.05, -0.01, 0, 0.01, 0.05]) {
      const noisy = hand({ gap: 0.2 })
      noisy[THUMB_TIP] = { ...noisy[THUMB_TIP]!, z }
      expect(pinchAperture(noisy, ASPECT)!).toBeGreaterThanOrEqual(0.2 - 1e-9)
    }
  })
})
