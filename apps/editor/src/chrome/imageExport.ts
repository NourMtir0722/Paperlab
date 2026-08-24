/**
 * Exporting the frame as a picture.
 *
 * The library's answer to "how do I use this" ends in someone's codebase,
 * and `ExportMenu` is built around that. This is the other half: the thing
 * you post. A sheet that peels or unrolls is the most persuasive argument
 * Paperlab has, and until now the only way to get one out of the editor was
 * a screenshot of the whole application, chrome and all.
 *
 * The sizes are the ones the places people post to actually want, named for
 * what they are rather than for their arithmetic.
 */
export interface ExportFrame {
  id: string
  label: string
  hint: string
  width: number
  height: number
}

export const EXPORT_FRAMES: readonly ExportFrame[] = [
  { id: 'square', label: 'Square', hint: '1:1 — a post', width: 1600, height: 1600 },
  { id: 'portrait', label: 'Portrait', hint: '4:5 — the tallest a feed allows', width: 1600, height: 2000 },
  { id: 'story', label: 'Story', hint: '9:16 — full screen on a phone', width: 1080, height: 1920 },
  { id: 'wide', label: 'Wide', hint: '16:9 — a slide, a README, a site hero', width: 1920, height: 1080 },
]

/**
 * The vertical field of view that keeps everything the viewport was showing.
 *
 * Aspect ratio is not a crop of the frame, it is a different frame, and a
 * perspective camera holds its VERTICAL field fixed as the aspect changes —
 * so exporting a wide viewport to 9:16 narrows the horizontal extent and
 * quietly cuts the sides off the sheet you just composed. You would find out
 * from the downloaded file.
 *
 * So a narrower target opens the field until the horizontal extent is the
 * one that was on screen: the export reveals more above and below, and never
 * less to the left and right. A wider or equal target is left alone, because
 * it already shows everything the viewport did.
 */
export function fitFov(fov: number, fromAspect: number, toAspect: number): number {
  if (!(fov > 0) || !(fromAspect > 0) || !(toAspect > 0)) return fov
  if (toAspect >= fromAspect) return fov
  const halfRadians = (fov * Math.PI) / 360
  return (2 * Math.atan(Math.tan(halfRadians) * (fromAspect / toAspect)) * 180) / Math.PI
}

/**
 * A filename someone can find again. Matches `downloadPreset`'s slug rules,
 * so a paper's picture and its `.paper` file sit next to each other in a
 * downloads folder rather than under two different spellings of one name.
 */
export function imageFilename(name: string, frameId: string): string {
  const slug =
    name
      .trim()
      .replace(/[^a-zA-Z0-9-_]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'paper'
  return `${slug}-${frameId}.png`
}

export function downloadImage(dataUrl: string, filename: string): void {
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = filename
  a.click()
}
