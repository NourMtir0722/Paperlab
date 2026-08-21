/**
 * Line breaking, shared by every content type that sets prose.
 *
 * It lives on its own because `paintText` and `paintCard` were about to
 * carry two copies of it, and two copies of a line-breaker is two answers to
 * "where does this wrap" — which on a sheet that CURLS is not a cosmetic
 * disagreement: the reader sees the break land on a fold.
 */

/**
 * Wrap a paragraph to a measure, breaking a word that cannot fit on its own.
 *
 * The last clause is the part the old loop got wrong. It appended a word
 * whenever the line was empty, on the reasonable theory that one word always
 * fits — but a long URL or a compound on a narrow banner does not, and it
 * ran off the edge of the sheet with nothing to stop it. A sheet is a
 * physical object: type that leaves it has left it.
 */
export function wrapLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  font: string,
): string[] {
  const previous = ctx.font
  ctx.font = font
  const out: string[] = []

  for (const paragraph of text.split('\n')) {
    if (paragraph.trim() === '') {
      // An empty line is a paragraph break, and it should survive as one.
      out.push('')
      continue
    }
    let line = ''
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const attempt = line ? `${line} ${word}` : word
      if (line && ctx.measureText(attempt).width > maxWidth) {
        out.push(line)
        line = word
      } else {
        line = attempt
      }
      // The word itself is wider than the measure: break it rather than
      // let it hang off the sheet.
      while (ctx.measureText(line).width > maxWidth && line.length > 1) {
        let cut = line.length - 1
        while (cut > 1 && ctx.measureText(line.slice(0, cut)).width > maxWidth) cut--
        out.push(line.slice(0, cut))
        line = line.slice(cut)
      }
    }
    if (line) out.push(line)
  }

  ctx.font = previous
  return out
}

/**
 * Ask the browser to actually load the face before painting with it.
 *
 * `document.fonts.ready` — which this library already awaited — resolves
 * when the fonts the DOCUMENT has requested have settled. A face named only
 * inside a canvas `ctx.font` string was never requested by anything, so on a
 * page where no DOM element uses it `ready` resolves immediately and the
 * canvas paints in the fallback. The sheet then renders in Times while the
 * preset says Playfair, silently and only sometimes, which is the worst
 * shape a bug can have.
 *
 * `fonts.load()` is the request. Failures are swallowed on purpose: a font
 * that will not load is a fallback, not an exception, and a sheet that
 * refuses to render is worse than one set in the wrong face.
 */
export async function ensureFont(font: string, size: number): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return
  try {
    await document.fonts.load(`${size}px ${font}`)
  } catch {
    // Unparseable family list, or a face the browser will not fetch.
  }
  try {
    await document.fonts.ready
  } catch {
    // Ignored for the same reason.
  }
}
