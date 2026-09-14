import { useEffect, useRef, useState } from 'react'
import {
  type FeedbackContext,
  type FeedbackKind,
  FEEDBACK_FORM,
  feedbackUrl,
  isSubmitted,
} from './feedbackForm'

/**
 * The feedback tab: a quiet edge on the canvas that opens two choices —
 * report a problem, or suggest an idea — and then the one form, told which.
 *
 * On the canvas's edge rather than in the top bar, because the top-right is
 * Export's alone, and on every surface because every surface wears one frame.
 * It floats over the sheet, so it is glass (docs/design.md, amendment 1).
 *
 * `context` is asked at the moment a form opens, not at render: the link it
 * carries is a snapshot of the paper as it is when someone decides to write.
 */

const CHOICES: { kind: FeedbackKind; title: string; hint: string }[] = [
  {
    kind: 'problem',
    title: 'Report a problem',
    hint: 'Something broke, looks wrong, or did not do what you expected.',
  },
  { kind: 'idea', title: 'Suggest an idea', hint: 'Something you wish Paperlab could do.' },
]

/** How long the thank-you stays before the dialog closes itself. */
const THANKS_MS = 2400

type View = 'closed' | 'choose' | FeedbackKind | 'thanks'

export function Feedback({ context }: { context: () => FeedbackContext }) {
  const [view, setView] = useState<View>('closed')
  const [src, setSrc] = useState<string | null>(null)
  const firstChoice = useRef<HTMLButtonElement>(null)
  const kind = view === 'problem' || view === 'idea' ? view : null
  const chosen = CHOICES.find((c) => c.kind === kind)

  useEffect(() => {
    if (view === 'choose') firstChoice.current?.focus()
  }, [view])

  // Tally says when the form has been sent; the dialog answers and goes.
  useEffect(() => {
    if (!kind) return
    const onMessage = (message: MessageEvent) => {
      if (isSubmitted(message)) setView('thanks')
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [kind])

  useEffect(() => {
    if (view !== 'thanks') return
    const timer = setTimeout(() => setView('closed'), THANKS_MS)
    return () => clearTimeout(timer)
  }, [view])

  if (!FEEDBACK_FORM) return null

  const open = (next: FeedbackKind) => {
    setSrc(feedbackUrl(next, context()))
    setView(next)
  }
  const close = () => setView('closed')

  return (
    <>
      <button type="button" className="feedback-tab" aria-haspopup="dialog" onClick={() => setView('choose')}>
        Feedback
      </button>
      {view !== 'closed' && (
        // biome-ignore lint/a11y/noStaticElementInteractions: as in ui.tsx's dialog — click-outside is the pointer path; Escape and the Close button are the keyboard ones.
        <div className="dialog-backdrop" onMouseDown={close}>
          <div
            className={`dialog feedback-dialog${kind ? ' has-form' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-label={chosen?.title ?? 'Feedback'}
            onMouseDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') close()
            }}
          >
            {view === 'choose' && (
              <>
                <h3 className="dialog-title">Tell us something</h3>
                <p className="dialog-message">
                  It goes straight to the person who makes Paperlab. No account needed.
                </p>
                <div className="feedback-choices">
                  {CHOICES.map((c, i) => (
                    <button
                      key={c.kind}
                      ref={i === 0 ? firstChoice : undefined}
                      type="button"
                      className="feedback-choice"
                      onClick={() => open(c.kind)}
                    >
                      <strong className="feedback-choice-title">{c.title}</strong>
                      <span className="feedback-choice-hint">{c.hint}</span>
                    </button>
                  ))}
                </div>
                <div className="dialog-actions">
                  <button type="button" className="dialog-btn" onClick={close}>
                    Cancel
                  </button>
                </div>
              </>
            )}
            {kind && src && (
              <>
                <div className="feedback-head">
                  <button type="button" className="feedback-back" onClick={() => setView('choose')}>
                    ← Back
                  </button>
                  <h3 className="dialog-title">{chosen?.title}</h3>
                </div>
                <iframe className="feedback-form" src={src} title={chosen?.title} />
                <div className="dialog-actions">
                  <button type="button" className="dialog-btn" onClick={close}>
                    Close
                  </button>
                </div>
              </>
            )}
            {view === 'thanks' && (
              <>
                <h3 className="dialog-title">Thank you</h3>
                <p className="dialog-message">It has been sent, and every one is read.</p>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
