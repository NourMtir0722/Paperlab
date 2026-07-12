import { useState } from 'react'
import { getBehavior } from 'paperlab'
import { useEditor } from './store'

/**
 * First-run guide for the paper editor. Sculpting is direct-manipulation
 * (drag a handle on the mesh) plus a transport, which isn't obvious cold — this
 * spells it out, keyed to the current behavior. Dismissed state is remembered;
 * the "?" affordance brings it back.
 */

const SEEN_KEY = 'paperlab.guideSeen'

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
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(SEEN_KEY) !== '1'
    } catch {
      return true
    }
  })

  const behavior = behaviorType ? getBehavior(behaviorType) : null
  const hasHandles = Boolean(behavior?.handles?.length)

  const dismiss = () => {
    setOpen(false)
    try {
      localStorage.setItem(SEEN_KEY, '1')
    } catch {
      /* private mode — fine, it just re-shows next load */
    }
  }

  if (!open) {
    return (
      <button className="guide-toggle" title="How to edit this paper" onClick={() => setOpen(true)}>
        ?
      </button>
    )
  }

  return (
    <div className="viewport-guide" role="dialog" aria-label="How to edit this paper">
      <div className="guide-head">
        <strong>Sculpting this paper</strong>
        <button className="guide-close" aria-label="Dismiss guide" onClick={dismiss}>
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
          <span className="guide-key">drag</span> empty space to orbit · <span className="guide-key">scroll</span> to zoom
        </li>
      </ul>
      <button className="guide-got-it" onClick={dismiss}>
        Got it
      </button>
    </div>
  )
}
