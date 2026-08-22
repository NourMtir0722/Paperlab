import * as THREE from 'three'
import { useEffect, useRef, useState, type RefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { getBehavior, type PaperHandle } from 'paperlab'
import { useEditor } from './store'

/**
 * The first-run instruction.
 *
 * The editor's one gesture that nothing on screen suggests is dragging the
 * blue dot on the paper. It used to be explained by a four-line panel in the
 * corner of the viewport — which is a legend, not an instruction: it says
 * three other things at the same time, it sits nowhere near the dot, and the
 * fastest way past it is the dismiss button.
 *
 * So: one sentence, drawn touching the handle, gone the moment the handle
 * moves. Behaviors with no handle get nothing here — the transport already
 * names their gesture ("Space plays the fall") on the line below the canvas,
 * and a second coach-mark saying the same thing would be the legend again.
 *
 * ## Where the dot is
 *
 * The handle rides the deformed surface, so its position is a fact about the
 * frame, not about the config: only the renderer knows it, and only after the
 * deformer stack has run. `<HandleAnchor>` lives inside the canvas, asks the
 * paper for that point every frame, projects it, and pushes pixels through
 * the channel below. Nothing here goes through React state — a per-frame
 * `setState` would re-render the editor sixty times a second to move a label
 * a few pixels.
 */

const SEEN_KEY = 'paperlab.coachSeen'

/** Fallback width before the card has been measured, and the tether's length. */
const CARD_WIDTH = 260
const TETHER = 22
/** A handle this close to the bottom gets the card lifted above it instead. */
const RAISE_BELOW = 90
/** How far inside the viewport the tether's dot is held. */
const EDGE = 10

interface Anchor {
  x: number
  y: number
  /** False when there is no handle, or it has gone behind the camera. */
  visible: boolean
}

const anchor: Anchor = { x: 0, y: 0, visible: false }
let listener: ((a: Anchor) => void) | null = null

/** Canvas-side, in the scene: the only thing that knows where the dot is. */
export function HandleAnchor({ paperRef }: { paperRef: RefObject<PaperHandle | null> }) {
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  const point = useRef(new THREE.Vector3())

  useFrame(() => {
    if (!listener) return
    const world = paperRef.current?.handlePoint(undefined, point.current)
    if (!world) {
      if (anchor.visible) {
        anchor.visible = false
        listener(anchor)
      }
      return
    }
    const ndc = point.current.project(camera)
    // z > 1 is behind the camera; projecting it gives a point on screen that
    // is a reflection of where the handle really is.
    const visible = ndc.z <= 1
    const x = (ndc.x * 0.5 + 0.5) * size.width
    const y = (-ndc.y * 0.5 + 0.5) * size.height
    if (visible === anchor.visible && Math.abs(x - anchor.x) < 0.5 && Math.abs(y - anchor.y) < 0.5) {
      return
    }
    anchor.x = x
    anchor.y = y
    anchor.visible = visible
    listener(anchor)
  })
  return null
}

/** What the dot does, per behavior — the whole instruction, in one clause. */
const GESTURE: Record<string, string> = {
  peel: 'Drag this to peel the corner up',
  unroll: 'Drag this to unroll it',
  flip: 'Drag this to turn the page',
  'letter-fold': 'Drag this to fold the flaps in',
}

let dismissed = false
let onDismissed: (() => void) | null = null

/**
 * Called when the handle is actually used. "Gone when you use it" has to be
 * driven by the drag itself: a coach-mark that survives the gesture it was
 * teaching is just a label.
 */
export function coachMarkUsed(): void {
  if (dismissed) return
  dismissed = true
  try {
    localStorage.setItem(SEEN_KEY, '1')
  } catch {
    /* private mode — it re-shows next load, which is the harmless direction */
  }
  onDismissed?.()
}

export function CoachMark() {
  const behaviorType = useEditor((s) => s.config.behavior?.type ?? null)
  const isCloth = useEditor((s) => typeof s.config.physics === 'object')
  const [seen, setSeen] = useState(() => {
    if (dismissed) return true
    try {
      return localStorage.getItem(SEEN_KEY) === '1'
    } catch {
      return false
    }
  })
  const ref = useRef<HTMLDivElement>(null)
  const [placed, setPlaced] = useState(false)

  useEffect(() => {
    onDismissed = () => setSeen(true)
    return () => {
      onDismissed = null
    }
  }, [])

  const behavior = behaviorType ? getBehavior(behaviorType) : null
  const hasHandle = Boolean(!isCloth && behavior?.handles?.length)
  const show = !seen && hasHandle

  // Follow the dot. Imperative on purpose — see the note at the top.
  useEffect(() => {
    if (!show) {
      listener = null
      setPlaced(false)
      return
    }
    listener = (a) => {
      const el = ref.current
      if (!el) return
      // A handle sits wherever the sheet put it, including the far right of
      // the frame and the bottom edge above the transport. The card flips to
      // whichever side has room rather than running off the viewport — the
      // one thing a coach-mark cannot survive is being partly off screen.
      const box = el.parentElement?.getBoundingClientRect()
      const width = el.offsetWidth || CARD_WIDTH
      // The viewport does not clip, so a handle at the very edge of frame —
      // or just past it — would draw the tether's dot over the inspector
      // rail. Held inside the canvas: it still points at the nearest place
      // the handle actually is.
      const x = box ? Math.min(Math.max(a.x, EDGE), box.width - EDGE) : a.x
      const y = box ? Math.min(Math.max(a.y, EDGE), box.height - EDGE) : a.y
      el.dataset.flip = box && x + TETHER + width > box.width ? 'left' : 'right'
      el.dataset.raise = box && y > box.height - RAISE_BELOW ? 'true' : 'false'
      el.style.transform = `translate(${x}px, ${y}px)`
      el.style.visibility = a.visible ? 'visible' : 'hidden'
      setPlaced((was) => was || a.visible)
    }
    return () => {
      listener = null
    }
  }, [show])

  if (!show) return null

  return (
    <div
      ref={ref}
      className={`coach-mark${placed ? ' placed' : ''}`}
      // Hidden until the tracker has reported a real position, so it never
      // flashes at the top-left corner of the viewport on the first frame.
      style={{ visibility: 'hidden' }}
      role="note"
    >
      <span className="coach-mark-tether" aria-hidden="true" />
      <span className="coach-mark-text">
        {behavior ? (GESTURE[behavior.id] ?? 'Drag this to shape the paper') : ''}
      </span>
      <button
        type="button"
        className="coach-mark-close"
        aria-label="Dismiss this tip"
        onClick={coachMarkUsed}
      >
        ✕
      </button>
    </div>
  )
}
