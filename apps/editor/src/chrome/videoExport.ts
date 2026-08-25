/**
 * Exporting the motion as a clip.
 *
 * `tools/media.mjs` already records the README's assets, and its opening
 * comment is the specification for this: it steps the motion one exact frame
 * at a time rather than screen-recording it, "so the loop is deterministic:
 * no dropped frames, no compositor jitter, identical output on any machine."
 * That is the guarantee worth carrying into the browser, because the thing
 * being sold is motion and a clip with a hitch in it argues against the
 * product.
 *
 * The browser has no ffmpeg, but it has the same trick in a different shape:
 * `canvas.captureStream(0)` produces a stream with no frame rate of its own,
 * and `requestFrame()` pushes exactly one frame into it. So the app decides
 * which frames exist and `MediaRecorder` does the encoding — deterministic
 * stepping with no encoder, muxer or dependency to ship.
 */

export interface ClipFormat {
  mimeType: string
  extension: string
}

/**
 * The best container this browser will actually encode, in preference order.
 *
 * MP4 first because it is the one that plays everywhere a clip gets posted —
 * a WebM dropped into a DM is a file the recipient cannot open on a phone.
 * WebM is the fallback because for years it was the only thing Chrome would
 * record, and a clip in a format someone has to convert still beats no clip.
 */
const CANDIDATES: ClipFormat[] = [
  { mimeType: 'video/mp4;codecs=avc1.42E01E', extension: 'mp4' },
  { mimeType: 'video/mp4', extension: 'mp4' },
  { mimeType: 'video/webm;codecs=vp9', extension: 'webm' },
  { mimeType: 'video/webm;codecs=vp8', extension: 'webm' },
  { mimeType: 'video/webm', extension: 'webm' },
]

export function pickClipFormat(
  isSupported: (mimeType: string) => boolean = (m) =>
    typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m),
): ClipFormat | null {
  return CANDIDATES.find((candidate) => isSupported(candidate.mimeType)) ?? null
}

/**
 * Where the motion sits at each frame of the clip.
 *
 * `pingpong` runs the motion out and back, so the loop closes without a jump
 * cut — a peel that snaps flat every 2.4 seconds reads as a broken GIF, not
 * as a peel. `loop` runs 0→1 for motion that already arrives where it
 * started, or that has somewhere to be: a walk played backwards is a person
 * walking backwards.
 *
 * Neither ends ON 1. The last frame is the one BEFORE the loop point, since
 * a clip that ends where it begins shows that frame twice and stutters once
 * per repeat.
 */
export function frameTimes(count: number, style: 'loop' | 'pingpong'): number[] {
  const frames = Math.max(1, Math.floor(count))
  return Array.from({ length: frames }, (_, i) => {
    const u = i / frames
    if (style === 'loop') return u
    return u < 0.5 ? u * 2 : 2 - u * 2
  })
}

export function clipFilename(name: string, frameId: string, extension: string): string {
  const slug =
    name
      .trim()
      .replace(/[^a-zA-Z0-9-_]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'paper'
  return `${slug}-${frameId}.${extension}`
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  // Revoked on a later turn of the loop: revoking synchronously can beat the
  // browser to the download it was handed.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
