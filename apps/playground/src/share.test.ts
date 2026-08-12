import { describe, expect, it } from 'vitest'
import {
  MAX_SHARE_LENGTH,
  SHARE_PARAM,
  decodeStageShare,
  encodeStageShare,
  readStageShare,
  stageShareUrl,
  type StageShare,
} from './share'
import { walks } from 'paperlab'

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
    expect(decodeStageShare(toB64(JSON.stringify({ t: 'x'.repeat(4001) })))).toBeNull()
  })
})

describe('links', () => {
  it('puts the scene in the query and reads it back', () => {
    const share: StageShare = { preset: 'cloister', text: 'around and around' }
    const url = stageShareUrl('https://paperlab.dev/', share)
    expect(new URL(url).searchParams.get(SHARE_PARAM)).toBeTruthy()
    expect(readStageShare(new URL(url).search)).toEqual(share)
  })

  it('keeps whatever was already on the url', () => {
    const url = stageShareUrl('https://paperlab.dev/?utm=x', { preset: 'nave' })
    expect(new URL(url).searchParams.get('utm')).toBe('x')
  })

  it('a url with no stage on it reads as no stage, not as an error', () => {
    expect(readStageShare('')).toBeNull()
    expect(readStageShare('?other=1')).toBeNull()
  })
})

function toB64(input: string): string {
  const bytes = new TextEncoder().encode(input)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
