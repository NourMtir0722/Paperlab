import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { FEEDBACK_FORM, feedbackUrl, isSubmitted } from './feedbackForm'

const FORM = 'abc123'

describe('feedbackUrl', () => {
  it('has nothing to open while the form does not exist', () => {
    expect(feedbackUrl('idea', { page: 'hands' }, 'UA', '')).toBeNull()
  })

  it('frames the form and carries the context as hidden fields', () => {
    const url = new URL(
      feedbackUrl('problem', { page: 'editor/paper', link: 'https://x.test/?p=abc' }, 'Firefox', FORM) ?? '',
    )
    expect(url.origin + url.pathname).toBe('https://tally.so/embed/abc123')
    expect(url.searchParams.get('kind')).toBe('problem')
    expect(url.searchParams.get('page')).toBe('editor/paper')
    expect(url.searchParams.get('browser')).toBe('Firefox')
    expect(url.searchParams.get('link')).toBe('https://x.test/?p=abc')
    expect(url.searchParams.get('hideTitle')).toBe('1')
  })

  it('opens the same form for an idea, saying so', () => {
    const url = new URL(feedbackUrl('idea', { page: 'hands' }, 'Safari', FORM) ?? '')
    expect(url.pathname).toBe('/embed/abc123')
    expect(url.searchParams.get('kind')).toBe('idea')
    expect(url.searchParams.has('link')).toBe(false)
  })
})

describe('isSubmitted', () => {
  const message = (origin: string, data: unknown) => ({ origin, data }) as MessageEvent

  it('hears Tally saying the form was sent', () => {
    const sent = JSON.stringify({ event: 'Tally.FormSubmitted', payload: {} })
    expect(isSubmitted(message('https://tally.so', sent))).toBe(true)
  })

  it('believes nothing else', () => {
    const sent = JSON.stringify({ event: 'Tally.FormSubmitted' })
    const loaded = JSON.stringify({ event: 'Tally.FormLoaded' })
    expect(isSubmitted(message('https://tally.so', loaded))).toBe(false)
    expect(isSubmitted(message('https://elsewhere.test', sent))).toBe(false)
    expect(isSubmitted(message('https://tally.so', { event: 'Tally.FormSubmitted' }))).toBe(false)
    expect(isSubmitted(message('https://tally.so', 'not json'))).toBe(false)
  })
})

/**
 * The playground and the docs share no code with the editor, so each holds
 * its own copy of the form id — and a copy is the thing that drifts.
 */
describe('the form id is one decision, in three apps', () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
  const id = (file: string) =>
    readFileSync(resolve(root, file), 'utf8').match(/FEEDBACK_FORM\b[^=]*=\s*'([^']*)'/)?.[1] ?? null

  for (const file of ['apps/playground/src/Feedback.tsx', 'apps/docs/src/App.tsx']) {
    it(`${file} opens the same form as the editor`, () => {
      expect(id(file)).toBe(FEEDBACK_FORM)
    })
  }
})
