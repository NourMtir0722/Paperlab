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

/** The refusal of a share that is expected to fail. */
function refusal(name: string, config: Parameters<typeof tryEncodePaperShare>[1]) {
  const attempt = tryEncodePaperShare(name, config)
  if (attempt.ok) throw new Error('expected a refusal, got a link')
  return attempt
}

const upload = (bytes: number) =>
  paperConfigSchema.parse({
    ...receipt,
    content: { type: 'image', src: `data:image/jpeg;base64,${'A'.repeat(bytes)}` },
  })

describe('refusing what cannot travel', () => {
  it('refuses a paper carrying an uploaded image rather than emitting a broken link', () => {
    // An uploaded image lands in the config as a data URL. A downscaled JPEG
    // is still ~100 KB, which no URL survives — say so instead of truncating.
    expect(refusal('photo', upload(120_000)).reason).toBe('uploaded-image')
  })

  it('blames the upload, not the length, so the advice can differ', () => {
    // The two refusals need different answers — an image can only be sent as
    // a file, whereas a long paper can be shortened — so a share that fails
    // because of a picture must not be reported as merely wordy.
    const long = paperConfigSchema.parse({
      ...receipt,
      content: { type: 'text', text: 'a very long letter. '.repeat(1000) },
    })
    expect(refusal('letter', long).reason).toBe('too-long')
    expect(refusal('photo', upload(120_000)).reason).toBe('uploaded-image')
  })

  it('finds an upload printed on the reverse of the sheet', () => {
    // `content.back` is a second content union with its own image variant.
    // Reading `content.src` alone would call this one merely too long and
    // send someone looking for a picture they would not find there.
    const backed = paperConfigSchema.parse({
      ...receipt,
      content: {
        type: 'text',
        text: 'front',
        back: { type: 'image', src: `data:image/jpeg;base64,${'A'.repeat(120_000)}` },
      },
    })
    expect(refusal('backed', backed).reason).toBe('uploaded-image')
  })

  it('reports how long the link would have been, for a message that can say', () => {
    expect(refusal('photo', upload(120_000)).length).toBeGreaterThan(MAX_SHARE_LENGTH)
  })

  it('hands the refusal back through paperShareUrl rather than a bare null', () => {
    const attempt = paperShareUrl('https://paperlab.dev/editor/', 'photo', upload(120_000))
    expect(attempt.ok).toBe(false)
    if (attempt.ok) throw new Error('expected a refusal')
    expect(attempt.reason).toBe('uploaded-image')
  })

  it('accepts a paper that fits', () => {
    const attempt = tryEncodePaperShare('receipt', receipt)
    expect(attempt.ok).toBe(true)
  })

  it('does not mistake an image URL for an upload', () => {
    // A referenced picture is exactly what DOES travel in a link. Only the
    // bytes-in-the-config case is the one that cannot.
    const linked = paperConfigSchema.parse({
      ...receipt,
      content: { type: 'image', src: 'https://example.com/photo.jpg' },
    })
    expect(tryEncodePaperShare('linked', linked).ok).toBe(true)
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

/** The url of a share that is expected to succeed. */
function shareUrl(base: string, name: string, config: Parameters<typeof paperShareUrl>[2]): string {
  const attempt = paperShareUrl(base, name, config)
  if (!attempt.ok) throw new Error(`expected a link, got ${attempt.reason}`)
  return attempt.url
}

describe('links', () => {
  it('puts the paper in the query and reads it back', () => {
    const url = shareUrl('https://paperlab.dev/editor/', 'my receipt', receipt)
    expect(new URL(url).searchParams.get(SHARE_PARAM)).toBeTruthy()
    expect(readPaperShare(new URL(url).search)?.name).toBe('my receipt')
  })

  it('keeps whatever was already on the url', () => {
    const url = shareUrl('https://paperlab.dev/editor/?utm=x', 'r', receipt)
    expect(new URL(url).searchParams.get('utm')).toBe('x')
  })

  it('replaces rather than stacks when re-sharing an opened link', () => {
    const first = shareUrl('https://paperlab.dev/editor/', 'a', receipt)
    const second = shareUrl(first, 'b', receipt)
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
