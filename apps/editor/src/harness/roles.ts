import type { GestureFrame } from './gestures'

/**
 * Two hands, and which one is doing what.
 *
 * The second hand is not a second grab. The sim holds ONE particle — a single
 * `grabbedIndex` — so two hands pulling the sheet is not something the library
 * can be asked for today. What two hands unlock instead is the posture every
 * physical thing you do to paper actually uses: one hand steadies it, the
 * other acts on it. That works against today's library because HOLDING is the
 * one grab and ACTING — scoring, flicking, turning a dial — never touches the
 * vertices at all.
 *
 * So the roles are exactly two, and they are decided here rather than in the
 * frame loop, because the rule that matters is a stickiness rule and sticky
 * state written inline is state nobody can test.
 */

/** The tracker's own label. Only used as an identity — never as a side. */
export type Handedness = 'Left' | 'Right'

export interface HandRead {
  handedness: Handedness
  frame: GestureFrame
  /** Where this hand is aimed from, in normalised camera coordinates. */
  anchor: { x: number; y: number } | null
}

export interface Roles {
  /** The hand whose pinch owns the pointer, and through it the sim's grab. */
  hold: Handedness | null
  /** The hand whose gesture is read as an action. */
  act: Handedness | null
}

export const NO_ROLES: Roles = { hold: null, act: null }

/**
 * Who holds and who acts, this frame.
 *
 * Three rules, in order of how much trouble they save:
 *
 *   1. A hand that has hold KEEPS it while it keeps pinching. Reassigning the
 *      grab because the other hand happened to close would hand the sheet to
 *      a hand that is not holding it, and the sim would re-grab whichever
 *      particle is nearest — which looks like the paper jumping.
 *   2. With two hands, the one that is not holding is the one that acts. That
 *      is the whole point of the second hand.
 *   3. With one hand, it does both — which is exactly how this worked before
 *      there was a second hand, and the reason that path is untouched.
 */
export function assignRoles(hands: readonly HandRead[], previous: Roles = NO_ROLES): Roles {
  if (hands.length === 0) return NO_ROLES

  const has = (which: Handedness | null) => which !== null && hands.some((hand) => hand.handedness === which)
  const pinching = hands.filter((hand) => hand.frame.name === 'pinch')

  const hold =
    previous.hold !== null && pinching.some((hand) => hand.handedness === previous.hold)
      ? previous.hold
      : (pinching[0]?.handedness ?? null)

  if (hands.length === 1) {
    const only = hands[0]!.handedness
    return { hold, act: only }
  }

  const other = hands.find((hand) => hand.handedness !== hold)?.handedness ?? null
  const act = hold !== null ? other : has(previous.act) ? previous.act : hands[0]!.handedness
  return { hold, act }
}

/**
 * The hand filling a role this frame, if any.
 *
 * Generic over the read so a caller carrying more than the roles need — the
 * landmarks, the palm, the roll of the wrist — gets its own type back rather
 * than the minimum this module asks for.
 */
export function handFor<T extends HandRead>(hands: readonly T[], role: Handedness | null): T | null {
  if (role === null) return null
  return hands.find((hand) => hand.handedness === role) ?? null
}
