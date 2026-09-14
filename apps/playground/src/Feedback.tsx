import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef, useState } from 'react'

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

const FOCUSABLE =
  'button:not(:disabled), input:not(:disabled), textarea, select, iframe, [href], [tabindex]:not([tabindex="-1"])'

/**
 * Keep Tab inside the open dialog: past either end, it wraps to the other.
 * `aria-modal` does not stop the Tab key reaching the page behind. The framed
 * form in the middle needs no help — the browser tabs through an iframe on
 * its own. The editor's copy is `trapTab` in its controls/ui.tsx.
 */
function trapTab(e: ReactKeyboardEvent, dialog: HTMLElement | null): void {
  if (e.key !== 'Tab' || !dialog) return
  const list = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)]
  const first = list[0]
  const last = list.at(-1)
  if (!first || !last) {
    e.preventDefault()
    return
  }
  const at = list.indexOf(document.activeElement as HTMLElement)
  if (at === -1) {
    e.preventDefault()
    ;(e.shiftKey ? last : first).focus()
  } else if (e.shiftKey && at === 0) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && at === list.length - 1) {
    e.preventDefault()
    first.focus()
  }
}

type View = 'closed' | 'choose' | FeedbackKind | 'thanks'

/** `link` reopens the scene being looked at — asked for when a form opens. */
export function Feedback({ link }: { link: () => string | null }) {
  const [view, setView] = useState<View>('closed')
  const [src, setSrc] = useState<string | null>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const firstChoice = useRef<HTMLButtonElement>(null)
  const back = useRef<HTMLButtonElement>(null)
  const wasOpen = useRef(false)
  const kind = view === 'problem' || view === 'idea' ? view : null
  const chosen = CHOICES.find((c) => c.kind === kind)

  // Focus goes where the next key is wanted, and back to the tab on every way
  // out — keyed on the view, so no close path can forget it.
  useEffect(() => {
    if (view === 'closed') {
      if (wasOpen.current) trigger.current?.focus()
      wasOpen.current = false
      return
    }
    wasOpen.current = true
    if (view === 'choose') firstChoice.current?.focus()
    else if (view === 'thanks') dialogRef.current?.focus()
    else back.current?.focus()
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
      <button
        ref={trigger}
        type="button"
        className="feedback-tab"
        aria-haspopup="dialog"
        onClick={() => setView('choose')}
      >
        Feedback
      </button>
      {view !== 'closed' && (
        // biome-ignore lint/a11y/noStaticElementInteractions: click-outside is the pointer path; Escape and the Close button are the keyboard ones.
        <div className="feedback-scrim" onMouseDown={close}>
          <div
            ref={dialogRef}
            tabIndex={-1}
            className={`feedback-dialog${kind ? ' has-form' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-label={chosen?.title ?? 'Feedback'}
            onMouseDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') close()
              trapTab(e, dialogRef.current)
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
                  <button ref={back} type="button" className="chip" onClick={() => setView('choose')}>
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
