import { describe, expect, it } from 'vitest'
import {
  MAX_SHARE_LENGTH,
  MAX_TEXT_LENGTH,
  SHARE_PARAM,
  decodeStageShare,
  encodeStageShare,
  readStageShare,
  stageShareUrl,
  type StageShare,
} from './share'
import { walks } from 'paperlab/stage'
const round = (share: StageShare) => decodeStageShare(encodeStageShare(share))

describe('encoding a stage into a link', () => {
  it('round-trips everything a scene is made of', () => {
    const share: StageShare = {
      preset: 'archive',
      text: 'catalogued indexed cross referenced',
      count: 30,
      layout: 'colonnade',
      layoutOptions: { aisle: 1.9, twist: 40 },
      stage: { shot: { shot: 'low' }, path: walks.ess },
    }
    expect(round(share)).toEqual(share)
  })

  it('writes down only what is set, so a plain scene has a short link', () => {
    expect(round({ preset: 'nave' })).toEqual({ preset: 'nave' })
    expect(encodeStageShare({ preset: 'nave' }).length).toBeLessThan(40)
  })

  it('is url-safe — a link with + or / in it breaks on paste', () => {
    // Text engineered to produce those characters in plain base64.
    const encoded = encodeStageShare({ preset: 'nave', text: 'ÿÿÿ>>>???~~~ØØØ' })
    expect(encoded).not.toMatch(/[+/=]/)
    expect(decodeStageShare(encoded)?.text).toBe('ÿÿÿ>>>???~~~ØØØ')
  })

  it('survives the alphabets people will actually paste', () => {
    for (const text of ['日本語のテキスト', 'العربية', 'emoji 🕯️📜', 'åäö ñ é']) {
      expect(round({ text })?.text).toBe(text)
    }
  })
})

describe('decoding a link nobody should trust', () => {
  it('returns null instead of throwing, whatever the garbage', () => {
    for (const bad of ['', 'not-base64!!', 'YWJj', toB64('{"p":'), toB64('null'), toB64('[]')]) {
      expect(() => decodeStageShare(bad)).not.toThrow()
      expect(decodeStageShare(bad)).toBeNull()
    }
  })

  it('rejects a preset this build does not have', () => {
    expect(decodeStageShare(encodeStageShare({ preset: 'cathedral' }))).toBeNull()
    expect(decodeStageShare(encodeStageShare({ preset: 'nave' }))).not.toBeNull()
  })

  it('rejects stage overrides that do not validate', () => {
    expect(decodeStageShare(toB64(JSON.stringify({ s: { shot: { shot: 'helicopter' } } })))).toBeNull()
    expect(decodeStageShare(toB64(JSON.stringify({ s: { figure: { height: 9999 } } })))).toBeNull()
    expect(decodeStageShare(toB64(JSON.stringify({ s: { shot: { shot: 'low' } } })))).not.toBeNull()
  })

  it('refuses a link longer than anything that survives a chat app', () => {
    const huge = encodeStageShare({ text: 'x'.repeat(3999) })
    expect(huge.length).toBeLessThan(MAX_SHARE_LENGTH)
    expect(decodeStageShare(huge)).not.toBeNull()
    expect(decodeStageShare('a'.repeat(MAX_SHARE_LENGTH + 1))).toBeNull()
  })

  it('caps the text a link can carry', () => {
    expect(decodeStageShare(toB64(JSON.stringify({ t: 'x'.repeat(MAX_TEXT_LENGTH) })))).not.toBeNull()
    expect(decodeStageShare(toB64(JSON.stringify({ t: 'x'.repeat(MAX_TEXT_LENGTH + 1) })))).toBeNull()
  })
})

describe('links', () => {
  it('puts the scene in the query and reads it back', () => {
    const share: StageShare = { preset: 'cloister', text: 'around and around' }
    const url = stageShareUrl('https://paperlab.dev/', share)
    expect(url).not.toBeNull()
    expect(new URL(url!).searchParams.get(SHARE_PARAM)).toBeTruthy()
    expect(readStageShare(new URL(url!).search)).toEqual(share)
  })

  it('keeps whatever was already on the url', () => {
    const url = stageShareUrl('https://paperlab.dev/?utm=x', { preset: 'nave' })
    expect(new URL(url!).searchParams.get('utm')).toBe('x')
  })

  it('a url with no stage on it reads as no stage, not as an error', () => {
    expect(readStageShare('')).toBeNull()
    expect(readStageShare('?other=1')).toBeNull()
  })

  /**
   * The writer and the reader have to agree. This app rewrites the address
   * bar on every keystroke, so a writer that produced a link past the ceiling
   * would hand the visitor a URL that reloads as an empty room — their scene
   * gone, and nothing said about it.
   */
  it('refuses to write a link it could not read back', () => {
    const overflowing = { preset: 'nave', text: 'x'.repeat(MAX_SHARE_LENGTH) }
    expect(encodeStageShare(overflowing).length).toBeGreaterThan(MAX_SHARE_LENGTH)
    expect(decodeStageShare(encodeStageShare(overflowing))).toBeNull()
    expect(stageShareUrl('https://paperlab.dev/', overflowing)).toBeNull()
  })

  it('writes anything up to the text cap, so the cap is the only limit that bites', () => {
    const atCap = { preset: 'nave', text: 'x'.repeat(MAX_TEXT_LENGTH) }
    const url = stageShareUrl('https://paperlab.dev/', atCap)
    expect(url).not.toBeNull()
    expect(readStageShare(new URL(url!).search)).toEqual(atCap)
  })
})

function toB64(input: string): string {
  const bytes = new TextEncoder().encode(input)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
