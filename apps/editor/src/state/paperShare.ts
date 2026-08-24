import { diffConfig, paperConfigSchema, type PaperConfig, type PaperConfigInput } from 'paperlab'

/**
 * A paper in a URL.
 *
 * The `.paper` file already travels — you can download one and drop it back
 * in. But a file has to be saved, attached, and opened, and that is enough
 * friction to stop a thing from spreading. A link is what actually gets
 * pasted into a thread, and someone who opens one lands in the editor with
 * your paper loaded and editable, which is the whole loop: make, send,
 * remix, export.
 *
 * Two rules, same as any link nobody should trust. It has to stay SHORT, so
 * only the diff from the schema defaults travels. And what comes back is
 * hostile until the schema says otherwise — decoding returns null rather
 * than throwing, so a mangled link opens the default paper instead of a
 * blank screen.
 *
 * This lives in the editor, not in `paperlab`: the payload is this app's
 * shape, and the library's contribution is `paperConfigSchema`, which is
 * what the untrusted half gets validated against.
 */

/** Beyond this, browsers and chat apps start truncating. */
export const MAX_SHARE_LENGTH = 8000

/** The query key a shared paper travels under. */
export const SHARE_PARAM = 'p'

export interface PaperShare {
  name: string
  config: PaperConfigInput
}

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

export function encodePaperShare(name: string, config: PaperConfig): string {
  // The diff, not the whole config: defaults are what the reader's copy of
  // the schema already knows.
  return toBase64Url(JSON.stringify({ n: name, c: diffConfig(config) }))
}

/**
 * Does this config carry an uploaded FILE rather than a reference to one?
 *
 * Walked generically rather than by reading `content.src`, because `src` is
 * not the only place a data URL can reach: `content.back` is a second whole
 * content union with its own image variant, and any field that later learns
 * to hold a bitmap should not quietly start producing links that break on
 * paste. A false negative here is a wrong explanation shown to someone whose
 * share just failed, which is worse than no explanation.
 */
function carriesUpload(value: unknown): boolean {
  if (typeof value === 'string') return value.startsWith('data:')
  if (Array.isArray(value)) return value.some(carriesUpload)
  if (value && typeof value === 'object') return Object.values(value).some(carriesUpload)
  return false
}

/**
 * Why a paper might not fit in a link.
 *
 * Two reasons, and they need different advice, which is the whole point of
 * telling them apart. An uploaded image becomes a data URL inside the config
 * and a downscaled JPEG is still ~100KB — no amount of editing will get that
 * under the cap, so the answer is to send the file. A paper that is merely
 * long can be shortened, and saying "this carries an uploaded image" to
 * someone who never uploaded one sends them looking for a picture that is
 * not there.
 */
export type ShareRefusal = 'uploaded-image' | 'too-long'

export function tryEncodePaperShare(
  name: string,
  config: PaperConfig,
): { ok: true; encoded: string } | { ok: false; reason: ShareRefusal; length: number } {
  const encoded = encodePaperShare(name, config)
  if (encoded.length <= MAX_SHARE_LENGTH) return { ok: true, encoded }
  return {
    ok: false,
    reason: carriesUpload(diffConfig(config)) ? 'uploaded-image' : 'too-long',
    length: encoded.length,
  }
}

/**
 * Decode a link. Returns null for anything this build cannot render — bad
 * base64, bad JSON, a config that does not validate. Never throws.
 */
export function decodePaperShare(encoded: string): PaperShare | null {
  if (!encoded || encoded.length > MAX_SHARE_LENGTH) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(fromBase64Url(encoded))
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const { n, c } = parsed as { n?: unknown; c?: unknown }
  if (typeof n !== 'string' || !n.trim() || n.length > 60) return null
  if (!c || typeof c !== 'object') return null

  // The config is the free-form half; make it prove itself against the same
  // schema the library uses.
  const result = paperConfigSchema.safeParse(c)
  if (!result.success) return null
  return { name: n.trim(), config: c as PaperConfigInput }
}

/**
 * The link, or why there isn't one. The refusal travels with the URL rather
 * than collapsing to null, because the caller has to say something specific
 * to whoever just pressed Share — and a null cannot tell it what.
 */
export function paperShareUrl(
  base: string,
  name: string,
  config: PaperConfig,
): { ok: true; url: string } | { ok: false; reason: ShareRefusal; length: number } {
  const attempt = tryEncodePaperShare(name, config)
  if (!attempt.ok) return attempt
  const url = new URL(base)
  // A shared paper replaces whatever was on the URL before, so re-sharing
  // an opened link does not stack parameters.
  url.searchParams.set(SHARE_PARAM, attempt.encoded)
  return { ok: true, url: url.toString() }
}

export function readPaperShare(search: string): PaperShare | null {
  const encoded = new URLSearchParams(search).get(SHARE_PARAM)
  return encoded ? decodePaperShare(encoded) : null
}
