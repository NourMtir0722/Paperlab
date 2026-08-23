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
 * Why a paper might not fit in a link. An uploaded image becomes a data URL
 * inside the config, and a downscaled JPEG is still ~100 KB — far past what
 * a URL survives. That is worth saying plainly rather than silently
 * producing a link that breaks on paste.
 */
export type ShareRefusal = 'too-long'

export function tryEncodePaperShare(
  name: string,
  config: PaperConfig,
): { ok: true; encoded: string } | { ok: false; reason: ShareRefusal } {
  const encoded = encodePaperShare(name, config)
  if (encoded.length > MAX_SHARE_LENGTH) return { ok: false, reason: 'too-long' }
  return { ok: true, encoded }
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

export function paperShareUrl(base: string, name: string, config: PaperConfig): string | null {
  const attempt = tryEncodePaperShare(name, config)
  if (!attempt.ok) return null
  const url = new URL(base)
  // A shared paper replaces whatever was on the URL before, so re-sharing
  // an opened link does not stack parameters.
  url.searchParams.set(SHARE_PARAM, attempt.encoded)
  return url.toString()
}

export function readPaperShare(search: string): PaperShare | null {
  const encoded = new URLSearchParams(search).get(SHARE_PARAM)
  return encoded ? decodePaperShare(encoded) : null
}
