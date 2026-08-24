import { describe, expect, it } from 'vitest'
import { paintWash } from './wash'
import { washSchema } from '../config/schema'

/**
 * A context that records what was asked of it.
 *
 * The real one needs a DOM, and what is under test here is not how the
 * pixels look — that is judged by eye against a contact sheet — but the
 * things a painter can get WRONG without anyone noticing: whether a seed
 * repeats, whether switching an effect off actually stops the work, and
 * whether a colour nobody can parse takes the render down.
 */
function recordingCtx() {
  const calls: string[] = []
  const stops: string[] = []
  const gradient = {
    addColorStop: (offset: number, color: string) => stops.push(`${offset.toFixed(2)}:${color}`),
  }
  const ctx = {
    calls,
    stops,
    filter: 'none',
    fillStyle: '' as unknown,
    strokeStyle: '' as unknown,
    lineWidth: 0,
    globalCompositeOperation: '',
    save: () => calls.push('save'),
    restore: () => calls.push('restore'),
    beginPath: () => calls.push('beginPath'),
    closePath: () => calls.push('closePath'),
    moveTo: (x: number, y: number) => calls.push(`moveTo(${x.toFixed(1)},${y.toFixed(1)})`),
    lineTo: (x: number, y: number) => calls.push(`lineTo(${x.toFixed(1)},${y.toFixed(1)})`),
    fill: () => calls.push('fill'),
    stroke: () => calls.push('stroke'),
    clip: () => calls.push('clip'),
    fillRect: (x: number, y: number) => calls.push(`fillRect(${x.toFixed(1)},${y.toFixed(1)})`),
    createRadialGradient: () => {
      calls.push('gradient')
      return gradient
    },
  }
  return ctx as unknown as CanvasRenderingContext2D & { calls: string[]; stops: string[] }
}

const wash = (o: Partial<ReturnType<typeof washSchema.parse>> = {}) => washSchema.parse(o)

function paint(o: Parameters<typeof wash>[0] = {}) {
  const ctx = recordingCtx()
  paintWash(ctx, 400, 560, wash(o))
  return ctx
}

describe('paintWash', () => {
  it('paints one pool per bloom', () => {
    expect(paint({ blooms: 1 }).calls.filter((c) => c === 'fill')).toHaveLength(1)
    expect(paint({ blooms: 6 }).calls.filter((c) => c === 'fill')).toHaveLength(6)
  })

  it('repeats exactly for a seed', () => {
    // A preset that repainted itself differently on every mount would be a
    // different artwork each remount, and no screenshot, share link or export
    // would agree with any other.
    expect(paint({ seed: 7 }).calls).toEqual(paint({ seed: 7 }).calls)
  })

  it('paints something else for a different seed', () => {
    expect(paint({ seed: 7 }).calls).not.toEqual(paint({ seed: 8 }).calls)
  })

  it('glazes rather than covers', () => {
    // Transparent pigment over transparent pigment is what makes two pools
    // crossing a third hue instead of whichever was painted last.
    const ctx = recordingCtx()
    paintWash(ctx, 400, 560, wash())
    expect(ctx.globalCompositeOperation).toBe('multiply')
  })

  it('does no stroking at all when the dried edge is off', () => {
    expect(paint({ edge: 0 }).calls).not.toContain('stroke')
    expect(paint({ edge: 0.6 }).calls).toContain('stroke')
  })

  it('does no speckling at all when granulation is off', () => {
    expect(paint({ granulation: 0 }).calls.some((c) => c.startsWith('fillRect'))).toBe(false)
    expect(paint({ granulation: 0.5 }).calls.some((c) => c.startsWith('fillRect'))).toBe(true)
  })

  it('keeps granulation inside the pool it settled out of', () => {
    // Speckling the whole sheet is a dirty scan, not a granulating wash.
    const calls = paint({ blooms: 1, granulation: 0.5 }).calls
    expect(calls.indexOf('clip')).toBeLessThan(calls.findIndex((c) => c.startsWith('fillRect')))
  })

  it('alternates the two pigments', () => {
    const stops = paint({ blooms: 2, color: '#112233', secondary: '#445566' }).stops.join(' ')
    expect(stops).toContain('17, 34, 51')
    expect(stops).toContain('68, 85, 102')
  })

  it('paints a colour it cannot parse as grey rather than throwing', () => {
    // A colour arrives from a text field and from other people's presets.
    // A sheet that refuses to render is worse than one painted the wrong hue.
    const ctx = recordingCtx()
    expect(() => paintWash(ctx, 400, 560, wash({ color: 'rebeccapurple' }))).not.toThrow()
    expect(ctx.stops.join(' ')).toContain('128, 128, 128')
  })

  it('still paints where the canvas cannot blur', () => {
    // Headless canvases and older engines have no `ctx.filter`; the wet edge
    // is the casualty, and a hard-edged wash beats a thrown render.
    const ctx = recordingCtx()
    Reflect.deleteProperty(ctx, 'filter')
    expect(() => paintWash(ctx, 400, 560, wash())).not.toThrow()
    expect(ctx.calls).toContain('fill')
  })

  it('leaves the context balanced, so the content painted on top is unaffected', () => {
    // The wash runs BEFORE the text and the card. A save it never restored
    // would leak multiply onto the type.
    const calls = paint({ blooms: 3 }).calls
    expect(calls.filter((c) => c === 'save')).toHaveLength(calls.filter((c) => c === 'restore').length)
  })
})
