import { describe, expect, it } from 'vitest'
import { getPreset, paperConfigSchema } from 'paperlab'
import {
  MAX_SHARE_LENGTH,
  SHARE_PARAM,
  decodePaperShare,
  encodePaperShare,
  paperShareUrl,
  readPaperShare,
  tryEncodePaperShare,
} from './paperShare'

const receipt = getPreset('receipt-unroll')

describe('encoding a paper into a link', () => {
  it('round-trips a built-in through the schema', () => {
    const decoded = decodePaperShare(encodePaperShare('my receipt', receipt))
    expect(decoded?.name).toBe('my receipt')
    // The diff travels, so compare what both sides resolve to.
    expect(paperConfigSchema.parse(decoded!.config)).toEqual(receipt)
  })

  it('keeps a paper short enough to paste anywhere', () => {
    // A bare sheet is nearly all defaults, so its link is tiny. The receipt
    // is the content-heavy end of the built-ins — a store name and a line
    // of items — and still lands an order of magnitude under the cap.
    expect(encodePaperShare('blank', getPreset('blank-sheet')).length).toBeLessThan(200)
    expect(encodePaperShare('receipt', receipt).length).toBeLessThan(MAX_SHARE_LENGTH / 4)
  })

  it('carries a sculpted edit, not just the preset name', () => {
    const sculpted = paperConfigSchema.parse({
      ...receipt,
      behavior: { type: 'unroll', progress: 0.42, tightness: 0.9 },
    })
    const decoded = decodePaperShare(encodePaperShare('sculpted', sculpted))
    const resolved = paperConfigSchema.parse(decoded!.config)
    expect(resolved.behavior).toMatchObject({ type: 'unroll', progress: 0.42, tightness: 0.9 })
  })

  it('survives the alphabets people name things in', () => {
    for (const name of ['日本語のメモ', 'رسالة', 'note 🕯️', 'åäö é']) {
      expect(decodePaperShare(encodePaperShare(name, receipt))?.name).toBe(name)
    }
  })

  it('is url-safe — a link with + or / in it breaks on paste', () => {
    const encoded = encodePaperShare('ÿÿÿ>>>???~~~ØØØ', receipt)
    expect(encoded).not.toMatch(/[+/=]/)
  })
})

describe('refusing what cannot travel', () => {
  it('refuses a paper carrying an uploaded image rather than emitting a broken link', () => {
    // An uploaded image lands in the config as a data URL. A downscaled JPEG
    // is still ~100 KB, which no URL survives — say so instead of truncating.
    const withUpload = paperConfigSchema.parse({
      ...receipt,
      content: { type: 'image', src: `data:image/jpeg;base64,${'A'.repeat(120_000)}` },
    })
    const attempt = tryEncodePaperShare('photo', withUpload)
    expect(attempt.ok).toBe(false)
    if (attempt.ok) throw new Error('expected a refusal')
    expect(attempt.reason).toBe('too-long')
    expect(paperShareUrl('https://paperlab.dev/editor/', 'photo', withUpload)).toBeNull()
  })

  it('accepts a paper that fits', () => {
    const attempt = tryEncodePaperShare('receipt', receipt)
    expect(attempt.ok).toBe(true)
  })
})

describe('decoding a link nobody should trust', () => {
  it('returns null instead of throwing, whatever the garbage', () => {
    for (const bad of ['', 'not-base64!!', 'YWJj', toB64('{"n":'), toB64('null'), toB64('[]')]) {
      expect(() => decodePaperShare(bad)).not.toThrow()
      expect(decodePaperShare(bad)).toBeNull()
    }
  })

  it('rejects a config that does not validate', () => {
    expect(decodePaperShare(toB64(JSON.stringify({ n: 'x', c: { stock: 'unobtainium' } })))).toBeNull()
    expect(decodePaperShare(toB64(JSON.stringify({ n: 'x', c: { sheet: { width: -5 } } })))).toBeNull()
    expect(decodePaperShare(toB64(JSON.stringify({ n: 'x', c: { stock: 'kraft' } })))).not.toBeNull()
  })

  it('rejects a missing or absurd name', () => {
    expect(decodePaperShare(toB64(JSON.stringify({ c: { stock: 'kraft' } })))).toBeNull()
    expect(decodePaperShare(toB64(JSON.stringify({ n: '   ', c: { stock: 'kraft' } })))).toBeNull()
    expect(decodePaperShare(toB64(JSON.stringify({ n: 'x'.repeat(61), c: { stock: 'kraft' } })))).toBeNull()
  })

  it('refuses a link longer than anything that survives a chat app', () => {
    expect(decodePaperShare('a'.repeat(MAX_SHARE_LENGTH + 1))).toBeNull()
  })
})

describe('links', () => {
  it('puts the paper in the query and reads it back', () => {
    const url = paperShareUrl('https://paperlab.dev/editor/', 'my receipt', receipt)!
    expect(new URL(url).searchParams.get(SHARE_PARAM)).toBeTruthy()
    expect(readPaperShare(new URL(url).search)?.name).toBe('my receipt')
  })

  it('keeps whatever was already on the url', () => {
    const url = paperShareUrl('https://paperlab.dev/editor/?utm=x', 'r', receipt)!
    expect(new URL(url).searchParams.get('utm')).toBe('x')
  })

  it('replaces rather than stacks when re-sharing an opened link', () => {
    const first = paperShareUrl('https://paperlab.dev/editor/', 'a', receipt)!
    const second = paperShareUrl(first, 'b', receipt)!
    expect(new URL(second).searchParams.getAll(SHARE_PARAM)).toHaveLength(1)
    expect(readPaperShare(new URL(second).search)?.name).toBe('b')
  })

  it('a url with no paper on it reads as no paper, not as an error', () => {
    expect(readPaperShare('')).toBeNull()
    expect(readPaperShare('?other=1')).toBeNull()
  })
})

function toB64(input: string): string {
  const bytes = new TextEncoder().encode(input)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
