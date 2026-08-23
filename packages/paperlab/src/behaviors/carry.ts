import { z } from 'zod'
import type { Behavior } from './types'
import { cornerNames } from '../deformers/curl'

export const carryOptionsSchema = z.object({
  /**
   * The grab point — where the pointer was on the paper at pick time.
   * 'auto' is resolved by the carry controller (usually the peeled corner:
   * continuity from peel → carry is the immersion moment).
   */
  grab: z.enum([...cornerNames, 'auto']).default('auto'),
  /** From stock feel: a stamp is stiff — it flutters, it doesn't flow. */
  stiffness: z.number().min(0).max(1).default(0.7),
  flutter: z.number().min(0).max(1).default(0.5),
  /** How far the paper's yaw trails the drag direction (runtime transform). */
  lag: z.number().min(0).max(1).default(0.35),
  /** Drag-speed drive (0..1). Written live by the carry controller. */
  drive: z.number().min(0).max(1).default(0.25),
})

export type CarryOptions = z.infer<typeof carryOptionsSchema>

type Corner = (typeof cornerNames)[number]

const concreteGrab = (g: CarryOptions['grab']): Corner => (g === 'auto' ? 'top-left' : g)

/** Bend-axis angle pointing from the grab corner toward the sheet center. */
const DROOP_ANGLE: Record<Corner, number> = {
  'top-left': -45,
  'top-right': -135,
  'bottom-left': 45,
  'bottom-right': 135,
}

/** The edge the grab corner hangs from — that edge doesn't flutter. */
const PIN_EDGE: Record<Corner, 'top' | 'bottom'> = {
  'top-left': 'top',
  'top-right': 'top',
  'bottom-left': 'bottom',
  'bottom-right': 'bottom',
}

/**
 * A held paper, alive from motion (the field/cheap path):
 * droop away from the grab point + drag-velocity flutter. The hero path —
 * cloth with a single pin following the cursor — is the existing
 * `physics: 'cloth'` grab; this behavior is what fields and exports run.
 */
export const carry: Behavior<CarryOptions> = {
  id: 'carry',
  label: 'Carry',
  defaults: carryOptionsSchema.parse({}),
  optionsSchema: carryOptionsSchema,
  signature: ['stiffness', 'flutter'],
  progressParam: 'drive',
  duration: 2.4,
  loopMode: 'yoyo',
  stack(o) {
    const grab = concreteGrab(o.grab)
    // Softer paper droops harder from the pinch; motion adds a touch more.
    const droop = (1 - o.stiffness) * 1.6 + o.drive * 0.35
    return [
      {
        type: 'bend',
        options: { curvature: -droop, angle: DROOP_ANGLE[grab] },
      },
      {
        type: 'wave',
        options: {
          amplitude: o.flutter * (0.012 + o.drive * 0.085),
          wavelength: 0.55,
          speed: 1.4 + o.drive * 1.8,
          angle: DROOP_ANGLE[grab],
          pinnedEdge: PIN_EDGE[grab],
        },
      },
    ]
  },
}
