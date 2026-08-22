/**
 * Colour strings that came from a person, made safe to hand to a canvas.
 *
 * Every colour in a stage — zenith, horizon, ground, the source, the room —
 * is an editable text field, and a text field emits on every keystroke. So
 * the library is handed `#f`, and `#ff`, and `not-a-colour`, in the normal
 * course of somebody typing `#ffaa22`. That is expected input, not a bug in
 * the caller.
 *
 * It matters because `addColorStop` is one of the few canvas calls that
 * **throws** rather than ignoring what it cannot parse:
 *
 * ```
 * Failed to execute 'addColorStop' on 'CanvasGradient':
 * The value provided ('not-a-colour') could not be parsed as a color.
 * ```
 *
 * and the sky is built during render, so that throw reached React as an
 * uncaught error and took the whole editor down. Three.js is the forgiving
 * one here — `new THREE.Color('nonsense')` warns and carries on — which is
 * why only the gradient path ever broke.
 *
 * Validation is the canvas's own opinion rather than a regex, because the
 * set of things CSS calls a colour is large (`rebeccapurple`, `hsl(...)`,
 * `color-mix(...)`, whatever ships next) and a regex would reject valid
 * input the gradient would have accepted.
 */

/** A 1×1 scratch context, made once, used only to ask "is this a colour?". */
let probe: CanvasRenderingContext2D | null | undefined

function probeContext(): CanvasRenderingContext2D | null {
  if (probe !== undefined) return probe
  probe = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d')
  return probe
}

/**
 * `value` if a canvas can parse it as a colour, else `fallback`.
 *
 * The test is two assignments from two different starting colours. An
 * invalid value leaves `fillStyle` untouched, so it still reads back as
 * whichever prior it started from and the two readings disagree; a valid one
 * normalizes to the same string both times. One assignment would not do —
 * the answer would depend on what the context happened to hold.
 */
export function cssColorOr(value: string, fallback: string): string {
  const ctx = probeContext()
  // No DOM (SSR, tests): pass the value through rather than invent a colour.
  // Nothing is being painted, so nothing can throw.
  if (!ctx) return value
  const previous = ctx.fillStyle
  ctx.fillStyle = '#000000'
  ctx.fillStyle = value
  const fromBlack = ctx.fillStyle
  ctx.fillStyle = '#ffffff'
  ctx.fillStyle = value
  const fromWhite = ctx.fillStyle
  ctx.fillStyle = previous
  return fromBlack === fromWhite ? value : fallback
}
