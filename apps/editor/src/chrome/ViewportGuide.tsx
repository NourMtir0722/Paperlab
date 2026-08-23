import { useState } from 'react'
import { getBehavior } from 'paperlab'
import { useEditor } from '../state/store'

/**
 * The help panel: everything the viewport can do, keyed to the current
 * behavior.
 *
 * It no longer opens itself on a first visit. A panel that appears unasked
 * has to be read and dismissed before the thing it describes can be touched,
 * and it was describing four gestures at once — so first-run teaching moved
 * to `CoachMark`, which says ONE thing, next to the thing it is about. This
 * stayed as what it always really was: the reference you open from "?" when
 * you want to know what else is here.
 */

/** What the blue handle does for behaviors that expose one. */
const HANDLE_GESTURE: Record<string, string> = {
  unroll: 'to roll and unroll it',
  peel: 'to peel a corner up',
  flip: 'to flip it face-over',
  'letter-fold': 'to fold the flaps in',
}

export function ViewportGuide() {
  const behaviorType = useEditor((s) => s.config.behavior?.type ?? null)
  const isCloth = useEditor((s) => typeof s.config.physics === 'object')
  const [open, setOpen] = useState(false)

  const behavior = behaviorType ? getBehavior(behaviorType) : null
  const hasHandles = Boolean(behavior?.handles?.length)

  const dismiss = () => setOpen(false)

  if (!open) {
    return (
      <button
        type="button"
        className="guide-toggle"
        title="How to edit this paper"
        aria-label="How to edit this paper"
        onClick={() => setOpen(true)}
      >
        ?
      </button>
    )
  }

  return (
    <div className="viewport-guide" role="dialog" aria-label="How to edit this paper">
      <div className="guide-head">
        <strong>Sculpting this paper</strong>
        <button type="button" className="guide-close" aria-label="Dismiss guide" onClick={dismiss}>
          ✕
        </button>
      </div>
      <ul className="guide-steps">
        {isCloth ? (
          <li>
            <span className="guide-dot cloth" /> Grab the sheet anywhere and drag to pull the cloth.
          </li>
        ) : hasHandles ? (
          <li>
            <span className="guide-dot" /> Drag the <b>blue dot</b> on the paper{' '}
            {HANDLE_GESTURE[behavior!.id] ?? 'to shape it'}.
          </li>
        ) : behavior ? (
          <li>
            <span className="guide-dot" /> Press <b>Space</b> to play the {behavior.label.toLowerCase()}, or
            drag the timeline to pose it by hand.
          </li>
        ) : (
          <li>
            <span className="guide-dot" /> Pick a <b>Behavior</b> on the right to bring the paper to life.
          </li>
        )}
        <li>
          <span className="guide-key">Space</span> play / pause · <b>drag the timeline</b> to scrub
        </li>
        <li>
          <span className="guide-key">drag</span> empty space to orbit ·{' '}
          <span className="guide-key">scroll</span> to zoom
        </li>
      </ul>
      <button type="button" className="guide-got-it" onClick={dismiss}>
        Close
      </button>
    </div>
  )
}
