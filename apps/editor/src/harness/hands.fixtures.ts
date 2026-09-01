import type { Landmark } from './landmarks'

/**
 * A hand built from how far each fingertip reaches, in palm lengths.
 *
 * Only the landmarks the code reads are meaningful — wrist, middle knuckle,
 * the four fingertips and the thumb tip — and the palm is a fixed 0.2 tall,
 * so a `reach` of 2 is a straight finger and 1 is one folded into the palm.
 * Writing poses in palms rather than in coordinates is what keeps these
 * fixtures readable as gestures instead of as numbers.
 */
export const PALM = 0.2
const WRIST_Y = 0.8

export function hand(
  {
    reach = [2, 2, 2, 2],
    gap = 1.5,
    towardCamera = false,
  }: {
    reach?: [number, number, number, number]
    gap?: number
    /**
     * Put the thumb's gap along the view axis instead of across the frame — a
     * hand turned side-on, so the pinch is exactly as open as it ever was and
     * projects to nothing. Divided by the aspect because `z` is on the same
     * scale as `x`, so the same physical span is a smaller number.
     */
    towardCamera?: boolean
    aspect?: number
  } = {},
  aspect = 4 / 3,
): Landmark[] {
  const lm: Landmark[] = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }))
  lm[0] = { x: 0.5, y: WRIST_Y, z: 0 }
  lm[9] = { x: 0.5, y: WRIST_Y - PALM, z: 0 }
  const tips = [8, 12, 16, 20] as const
  tips.forEach((tip, i) => {
    lm[tip] = { x: 0.5, y: WRIST_Y - reach[i]! * PALM, z: 0 }
  })
  // The thumb sits `gap` palms from the index tip, which is the aperture.
  lm[4] = towardCamera
    ? { x: 0.5, y: lm[8]!.y, z: -(gap * PALM) / aspect }
    : { x: 0.5, y: lm[8]!.y - gap * PALM, z: 0 }
  return lm
}

/** Four poses the gesture layer has to tell apart. */
export const POSES = {
  palm: () => hand({ reach: [2, 2, 2, 2], gap: 1.5 }),
  // A fist closes the thumb onto the index too — which is exactly why the
  // aperture alone cannot tell a fist from a pinch.
  fist: () => hand({ reach: [1, 1, 1, 1], gap: 0.2 }),
  pinch: () => hand({ reach: [1.5, 2, 2, 2], gap: 0.2 }),
  point: () => hand({ reach: [2, 1, 1, 1], gap: 1 }),
}

/** 4:3, the shape of the camera the harness asks for. */
export const ASPECT = 4 / 3
