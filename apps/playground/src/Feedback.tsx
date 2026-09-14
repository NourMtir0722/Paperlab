import { useEffect, useRef, useState } from 'react'

/**
 * The feedback tab, for the playground: a glass edge on the scene that opens
 * two choices — report a problem, or suggest an idea — and then the one Tally
 * form, framed inside the page and told which.
 *
 * The editor's own (`apps/editor/src/chrome/feedbackForm.ts`) explains the
 * choices: a plain iframe and never Tally's script, the context carried as
 * hidden fields (`kind`, `page`, `browser`, `link`). This app shares no code
 * with the editor, so the form id is copied here, and the editor's
 * `feedbackForm.test.ts` fails if it drifts.
 */

type FeedbackKind = 'problem' | 'idea'

/** The Tally form, by id. Empty means no tab. */
const FEEDBACK_FORM: string = 'vGldDg'

const TALLY = 'https://tally.so'

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

function formUrl(kind: FeedbackKind, link: string | null): string {
  const url = new URL(`${TALLY}/embed/${FEEDBACK_FORM}`)
  url.searchParams.set('alignLeft', '1')
  url.searchParams.set('hideTitle', '1')
  url.searchParams.set('kind', kind)
  url.searchParams.set('page', 'playground')
  url.searchParams.set('browser', navigator.userAgent)
  if (link) url.searchParams.set('link', link)
  return url.href
}

/** Tally posts its events as JSON strings; only its own origin is believed. */
function isSubmitted(message: MessageEvent): boolean {
  if (message.origin !== TALLY || typeof message.data !== 'string') return false
  try {
    return JSON.parse(message.data)?.event === 'Tally.FormSubmitted'
  } catch {
    return false
  }
}

type View = 'closed' | 'choose' | FeedbackKind | 'thanks'

/** `link` reopens the scene being looked at — asked for when a form opens. */
export function Feedback({ link }: { link: () => string | null }) {
  const [view, setView] = useState<View>('closed')
  const [src, setSrc] = useState<string | null>(null)
  const firstChoice = useRef<HTMLButtonElement>(null)
  const kind = view === 'problem' || view === 'idea' ? view : null
  const chosen = CHOICES.find((c) => c.kind === kind)

  useEffect(() => {
    if (view === 'choose') firstChoice.current?.focus()
  }, [view])

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
    setSrc(formUrl(next, link()))
    setView(next)
  }
  const close = () => setView('closed')

  return (
    <>
      <button type="button" className="feedback-tab" aria-haspopup="dialog" onClick={() => setView('choose')}>
        Feedback
      </button>
      {view !== 'closed' && (
        // biome-ignore lint/a11y/noStaticElementInteractions: click-outside is the pointer path; Escape and the Close button are the keyboard ones.
        <div className="feedback-scrim" onMouseDown={close}>
          <div
            className={`feedback-dialog${kind ? ' has-form' : ''}`}
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
                <h2>Tell us something</h2>
                <p>It goes straight to the person who makes Paperlab. No account needed.</p>
                <div className="feedback-choices">
                  {CHOICES.map((c, i) => (
                    <button
                      key={c.kind}
                      ref={i === 0 ? firstChoice : undefined}
                      type="button"
                      className="feedback-choice"
                      onClick={() => open(c.kind)}
                    >
                      <strong>{c.title}</strong>
                      <span>{c.hint}</span>
                    </button>
                  ))}
                </div>
                <div className="feedback-actions">
                  <button type="button" className="chip" onClick={close}>
                    Cancel
                  </button>
                </div>
              </>
            )}
            {kind && src && (
              <>
                <div className="feedback-head">
                  <button type="button" className="chip" onClick={() => setView('choose')}>
                    ← Back
                  </button>
                  <h2>{chosen?.title}</h2>
                </div>
                <iframe className="feedback-form" src={src} title={chosen?.title} />
                <div className="feedback-actions">
                  <button type="button" className="chip" onClick={close}>
                    Close
                  </button>
                </div>
              </>
            )}
            {view === 'thanks' && (
              <>
                <h2>Thank you</h2>
                <p>It has been sent, and every one is read.</p>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
