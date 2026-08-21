import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type { WalkPath } from './path'
import {
  coast,
  dragWalk,
  holdOnWalk,
  nextStop,
  travelBetween,
  travelEase,
  TRAVEL_SECONDS,
  wheelWalk,
  type StageMotion,
} from './navigate'

/**
 * The walk, and whoever is driving it.
 *
 * One ref, updated once a frame, read by the camera and by the figure — the
 * scene's single source of "how far along are we". Handing those two their
 * own copies is the same failure as handing them their own paths.
 *
 * A ref rather than state on purpose: this number changes sixty times a
 * second, and re-rendering a scene graph to tell it a float is the most
 * expensive way to say anything in React.
 */

export interface WalkDrive {
  /** Distance walked, in normalized walk (0..1), live. */
  walk: React.RefObject<number>
  /** Step to a specific point on the walk, eased. Used by the arrow keys and by clicking a paper. */
  travelTo(target: number): void
  /** Step to the stop before or after wherever we are. */
  step(direction: 1 | -1): void
  /**
   * Whether the gesture that just ended was a DRAG rather than a click.
   *
   * Letting go of a drag over a paper fires a click on it, and travelling to
   * whatever happened to be under the cursor when you stopped pulling is not
   * something anyone asked for. A few pixels of slop, because a real click
   * always moves the mouse a little.
   */
  dragged: React.RefObject<boolean>
}

export interface UseWalkOptions {
  path: WalkPath
  motion: StageMotion
  /** Controlled position. When set, the viewer is not driving and nothing here listens. */
  progress?: number
  /** Pace for `autoplay`, world units per second. */
  figureSpeed: number
  /** Where the papers stand, normalized. Empty means nothing to step between. */
  stops: readonly number[]
  /** Freeze, and land steps instantly rather than gliding. */
  reduced: boolean
  /** Reports the live position, every frame it changes. */
  onProgress?(walk: number): void
}

export function useWalk({
  path,
  motion,
  progress,
  figureSpeed,
  stops,
  reduced,
  onProgress,
}: UseWalkOptions): WalkDrive {
  const gl = useThree((s) => s.gl)
  const walk = useRef(progress ?? 0)
  const velocity = useRef(0)
  const dragged = useRef(false)
  const travel = useRef<{ from: number; to: number; t: number } | null>(null)
  const controlled = progress !== undefined
  const interactive = !controlled && motion.driver === 'drag'
  /**
   * Whether the viewer has taken the walk over. Until they do, `drag` drifts
   * on the clock — so the stage is moving when it opens AND is yours the
   * moment you touch it. A ref, not state: taking over must not re-render a
   * scene graph mid-gesture.
   */
  const engaged = useRef(false)

  const travelTo = useCallback(
    (target: number) => {
      engaged.current = true
      velocity.current = 0
      const to = holdOnWalk(target, path.closed)
      if (reduced) {
        // Reduced motion means do not animate it. A jump is the honest
        // answer; easing it more slowly would be MORE motion, not less.
        walk.current = to
        travel.current = null
        return
      }
      travel.current = { from: walk.current, to, t: 0 }
    },
    [path.closed, reduced],
  )

  const step = useCallback(
    (direction: 1 | -1) => {
      // Steps go from where a travel is HEADED, not from where the camera has
      // got to — otherwise holding an arrow key down crawls, because every
      // press re-measures from a position still halfway to the last target.
      const from = travel.current?.to ?? walk.current
      travelTo(nextStop(stops, from, direction, path.closed))
    },
    [stops, path.closed, travelTo],
  )

  // Keep the controlled value in the same ref everything else reads, so there
  // is exactly one answer to "how far along are we" in either mode.
  useEffect(() => {
    if (controlled) {
      walk.current = progress
      travel.current = null
      velocity.current = 0
    }
  }, [controlled, progress])

  const canvas = gl.domElement

  useEffect(() => {
    if (!interactive) return

    // The canvas has to be reachable by keyboard before it can be driven by
    // one, and it has to say what it is once it is focusable.
    const hadTabIndex = canvas.hasAttribute('tabindex')
    if (!hadTabIndex) canvas.tabIndex = 0
    const hadRole = canvas.getAttribute('role')
    const hadLabel = canvas.getAttribute('aria-label')
    if (!hadRole) canvas.setAttribute('role', 'application')
    if (!hadLabel) {
      canvas.setAttribute(
        'aria-label',
        'A walk through hanging paper. Drag or use the arrow keys to move along it.',
      )
    }
    // Touch-dragging a canvas scrolls the page under it otherwise, and the
    // gesture we want IS a vertical drag, so the two collide directly. Only
    // when this stage is allowed to take it: a card in a column of prose
    // that traps a reader's finger is a worse bug than one that cannot be
    // swiped.
    const hadTouch = canvas.style.touchAction
    if (motion.capture) canvas.style.touchAction = 'none'

    let pointer: number | null = null
    let lastY = 0
    let lastAt = 0
    let startY = 0
    /** Past this many pixels the gesture is a drag and cannot also be a click. */
    const SLOP = 5

    const down = (event: PointerEvent) => {
      if (!event.isPrimary) return
      engaged.current = true
      pointer = event.pointerId
      dragged.current = false
      startY = event.clientY
      lastY = event.clientY
      lastAt = event.timeStamp
      velocity.current = 0
      travel.current = null
      canvas.setPointerCapture(event.pointerId)
      canvas.style.cursor = 'grabbing'
    }

    const move = (event: PointerEvent) => {
      if (pointer !== event.pointerId) return
      const dy = event.clientY - lastY
      if (Math.abs(event.clientY - startY) > SLOP) dragged.current = true
      const dt = Math.max((event.timeStamp - lastAt) / 1000, 1 / 240)
      const moved = dragWalk(dy, motion.speed)
      walk.current = holdOnWalk(walk.current + moved, path.closed)
      // Velocity from the LAST move rather than the whole gesture: a flick is
      // the speed of the hand as it let go, not its average since it landed.
      velocity.current = moved / dt
      lastY = event.clientY
      lastAt = event.timeStamp
    }

    const up = (event: PointerEvent) => {
      if (pointer !== event.pointerId) return
      pointer = null
      canvas.style.cursor = 'grab'
      // A gesture that ended still is a release, not a throw. Without this,
      // a slow drag that paused before letting go kept creeping.
      if (event.timeStamp - lastAt > 90) velocity.current = 0
    }

    const wheel = (event: WheelEvent) => {
      const lines = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1
      const moved = wheelWalk(event.deltaY * lines, motion.speed)
      // At the end of an open walk, hand the wheel back rather than pressing
      // into a wall — the page carries on scrolling, which is what a reader
      // who has reached the last banner is asking for.
      if (!path.closed && ((walk.current >= 1 && moved > 0) || (walk.current <= 0 && moved < 0))) return
      engaged.current = true
      travel.current = null
      velocity.current = 0
      walk.current = holdOnWalk(walk.current + moved, path.closed)
      event.preventDefault()
    }

    const key = (event: KeyboardEvent) => {
      const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown' || event.key === 'PageDown'
      const back = event.key === 'ArrowLeft' || event.key === 'ArrowUp' || event.key === 'PageUp'
      if (forward || back) step(forward ? 1 : -1)
      else if (event.key === 'Home') travelTo(stops[0] ?? 0)
      else if (event.key === 'End') travelTo(stops[stops.length - 1] ?? 1)
      else return
      engaged.current = true
      event.preventDefault()
    }

    canvas.style.cursor = 'grab'
    canvas.addEventListener('pointerdown', down)
    canvas.addEventListener('pointermove', move)
    canvas.addEventListener('pointerup', up)
    canvas.addEventListener('pointercancel', up)
    // Not passive: the whole point is to take the wheel off the page.
    if (motion.capture) canvas.addEventListener('wheel', wheel, { passive: false })
    canvas.addEventListener('keydown', key)

    return () => {
      canvas.removeEventListener('pointerdown', down)
      canvas.removeEventListener('pointermove', move)
      canvas.removeEventListener('pointerup', up)
      canvas.removeEventListener('pointercancel', up)
      canvas.removeEventListener('wheel', wheel)
      canvas.removeEventListener('keydown', key)
      canvas.style.cursor = ''
      canvas.style.touchAction = hadTouch
      if (!hadTabIndex) canvas.removeAttribute('tabindex')
      if (!hadRole) canvas.removeAttribute('role')
      if (!hadLabel) canvas.removeAttribute('aria-label')
    }
  }, [canvas, interactive, motion.speed, motion.capture, path.closed, step, travelTo, stops])

  const reported = useRef(-1)
  useFrame((_, delta) => {
    // Reported even while controlled: a consumer mirroring the position into
    // a scrubber wants it whoever is driving.
    if (onProgress && Math.abs(walk.current - reported.current) > 1e-4) {
      reported.current = walk.current
      onProgress(walk.current)
    }
    if (controlled) return
    const dt = Math.min(delta, 0.1)

    if (travel.current) {
      travel.current.t += dt / TRAVEL_SECONDS
      const { from, to, t } = travel.current
      walk.current = travelBetween(from, to, travelEase(t), path.closed)
      if (t >= 1) travel.current = null
      return
    }

    // `drag` drifts until it is taken over; `autoplay` never hands over.
    const drifting = motion.driver === 'autoplay' || (interactive && !engaged.current)
    if (drifting && !reduced) {
      // Wrapped, not extrapolated. An open walk used to run past its own end
      // for as long as the tab was open, which is a camera stationed in the
      // dark past the last banner — the playground had to keep its own clock
      // and its own `% 1` to avoid it.
      const perSecond = path.length > 0 ? (figureSpeed * motion.speed) / path.length : 0
      walk.current = (((walk.current + perSecond * dt) % 1) + 1) % 1
      return
    }

    if (velocity.current !== 0) {
      walk.current = holdOnWalk(walk.current + velocity.current * dt, path.closed)
      velocity.current = coast(velocity.current, dt)
      // Clamped against a wall, a flick has nowhere to go and should stop
      // rather than press silently into the end for another second.
      if (!path.closed && (walk.current <= 0 || walk.current >= 1)) velocity.current = 0
    }
  })

  return useMemo(() => ({ walk, travelTo, step, dragged }), [travelTo, step])
}
