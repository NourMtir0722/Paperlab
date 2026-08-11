import { z } from 'zod'
import { stageSchema, type StageConfigInput } from './schema'
import { listStagePresets } from './presets'

/**
 * A stage in a URL.
 *
 * The playground has no accounts and no database: a scene IS its link, and
 * sharing one is sharing a string. That puts two constraints on this file.
 * It has to stay SHORT — hence single-letter keys and storing a preset id
 * plus what changed rather than the whole config — and it has to treat what
 * comes back as hostile, because anyone can hand you a link. Decoding runs
 * the payload through the same zod schemas the rest of the library uses and
 * returns null rather than throwing, so a mangled link opens the default
 * stage instead of a blank page.
 */

/** Beyond this, browsers and chat apps start truncating. */
export const MAX_SHARE_LENGTH = 8000

const shareSchema = z.object({
  /** Stage preset id this scene started from. */
  p: z.string().optional(),
  /** The words the space is built from. */
  t: z.string().max(4000).optional(),
  n: z.number().int().min(1).max(80).optional(),
  l: z.string().optional(),
  lo: z.record(z.unknown()).optional(),
  /** Stage overrides — validated against the real schema on the way out. */
  s: z.record(z.unknown()).optional(),
})

export interface StageShare {
  preset?: string
  text?: string
  count?: number
  layout?: string
  layoutOptions?: Record<string, unknown>
  stage?: StageConfigInput
}

/** base64url — the plain alphabet needs escaping in a query string. */
function toBase64Url(input: string): string {
  const bytes = new TextEncoder().encode(input)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(input: string): string {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

export function encodeStageShare(share: StageShare): string {
  const payload: Record<string, unknown> = {}
  if (share.preset) payload.p = share.preset
  if (share.text) payload.t = share.text
  if (share.count !== undefined) payload.n = share.count
  if (share.layout) payload.l = share.layout
  if (share.layoutOptions && Object.keys(share.layoutOptions).length > 0) {
    payload.lo = share.layoutOptions
  }
  if (share.stage && Object.keys(share.stage).length > 0) payload.s = share.stage
  return toBase64Url(JSON.stringify(payload))
}

/**
 * Decode a link. Returns null for anything that isn't a stage this build can
 * render — bad base64, bad JSON, an unknown preset id, a stage that doesn't
 * validate. Never throws: a broken link is a UI state, not a crash.
 */
export function decodeStageShare(encoded: string): StageShare | null {
  if (!encoded || encoded.length > MAX_SHARE_LENGTH) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(fromBase64Url(encoded))
  } catch {
    return null
  }
  const result = shareSchema.safeParse(parsed)
  if (!result.success) return null
  const { p, t, n, l, lo, s } = result.data

  // An id from a link may name a preset this build does not have.
  if (p !== undefined && !listStagePresets().includes(p)) return null
  // Stage overrides are the one free-form field; make them prove themselves.
  if (s !== undefined && !stageSchema.safeParse(s).success) return null

  const share: StageShare = {}
  if (p !== undefined) share.preset = p
  if (t !== undefined) share.text = t
  if (n !== undefined) share.count = n
  if (l !== undefined) share.layout = l
  if (lo !== undefined) share.layoutOptions = lo
  if (s !== undefined) share.stage = s as StageConfigInput
  return share
}

/** The query key a shared stage travels under. */
export const SHARE_PARAM = 's'

export function stageShareUrl(base: string, share: StageShare): string {
  const url = new URL(base)
  url.searchParams.set(SHARE_PARAM, encodeStageShare(share))
  return url.toString()
}

export function readStageShare(search: string): StageShare | null {
  const encoded = new URLSearchParams(search).get(SHARE_PARAM)
  return encoded ? decodeStageShare(encoded) : null
}
