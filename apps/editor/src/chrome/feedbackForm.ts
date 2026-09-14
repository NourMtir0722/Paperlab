/**
 * Where someone tells us that something is broken, or that something should
 * exist — without a GitHub account, and without this site running a server.
 *
 * The site is static, so something else has to receive a message. That is
 * Tally: ONE form, opened INSIDE the page in a plain iframe. No Tally script is
 * loaded, ever — nothing third-party runs until someone opens the dialog, and
 * even then it runs in a frame of its own with nothing from this page but what
 * the URL hands it.
 *
 * What the URL hands it is the context nobody should have to type, as Tally
 * hidden fields (a form reads them off its own query string):
 *
 *   kind     `problem` or `idea` — the dialog asks before the form opens, so
 *            one form serves both and the answers can be filtered by it
 *   page     which surface they were on — `editor/paper`, `hands`, …
 *   browser  the user agent, which is half of every rendering bug
 *   link     a link that reopens exactly what they were looking at, where
 *            there is one — a report that carries its own repro
 *
 * The form needs hidden fields by those four names to receive them.
 *
 * The id is copied into the playground and the docs, which share no code with
 * this app; `feedbackForm.test.ts` fails if the copies drift.
 */

export type FeedbackKind = 'problem' | 'idea'

/**
 * The Tally form, by id — the part after `tally.so/r/`. Empty means no tab at
 * all: a button that opens a dead dialog is worse than none.
 */
export const FEEDBACK_FORM: string = 'vGldDg'

export interface FeedbackContext {
  page: string
  link?: string
}

const TALLY = 'https://tally.so'

/** The framed form, with the context on it — or null if the form does not exist yet. */
export function feedbackUrl(
  kind: FeedbackKind,
  context: FeedbackContext,
  browser: string = navigator.userAgent,
  form: string = FEEDBACK_FORM,
): string | null {
  if (!form) return null
  const url = new URL(`${TALLY}/embed/${form}`)
  // The dialog carries its own title. The form keeps its own ground: made
  // transparent, a light-themed form would be dark text on the dark dialog.
  url.searchParams.set('alignLeft', '1')
  url.searchParams.set('hideTitle', '1')
  url.searchParams.set('kind', kind)
  url.searchParams.set('page', context.page)
  url.searchParams.set('browser', browser)
  if (context.link) url.searchParams.set('link', context.link)
  return url.href
}

/**
 * Whether a message is Tally saying the form was sent.
 *
 * Tally posts its events to the parent as JSON strings. Anything can post a
 * message to this window, so the origin is checked before the contents are
 * believed.
 */
export function isSubmitted(message: MessageEvent): boolean {
  if (message.origin !== TALLY || typeof message.data !== 'string') return false
  try {
    return JSON.parse(message.data)?.event === 'Tally.FormSubmitted'
  } catch {
    return false
  }
}
