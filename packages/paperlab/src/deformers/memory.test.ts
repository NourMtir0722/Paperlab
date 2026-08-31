import { describe, expect, it } from 'vitest'
import {
  applyMemory,
  CreaseTracker,
  CREASE_MIN_GROWTH,
  CREASE_RADIUS,
  MAX_CREASES,
  MAX_SET,
  sameLine,
} from './memory'
import { letterFold } from '../behaviors/letter-fold'
import { unroll } from '../behaviors/unroll'
import type { CreaseConfig } from '../config/schema'
import type { DeformerInstance, SheetDims } from './types'
import { getStock } from '../core/stock'
import { paperConfigSchema } from '../config/schema'
import { resolveCreases } from '../surface/creases'
import { diffConfig } from '../config/diff'
import { getPreset } from '../config/presets'
import { resolveConfig } from '../PaperMesh'

const sheet: SheetDims = { width: 1, height: 1.4 }

const fold = (angle: number, offset: number, foldAngle: number, radius = 0.04): DeformerInstance => ({
  type: 'fold',
  options: { angle, offset, foldAngle, radius },
})

const crease = (angle: number, offset: number, depth: number): CreaseConfig => ({ angle, offset, depth })

/** Drive a behavior's progress through a sweep, one frame per step. */
function play(
  tracker: CreaseTracker,
  behavior: { stack(o: never, sheet: SheetDims): DeformerInstance[] },
  options: Record<string, unknown>,
  from: number,
  to: number,
  set: number,
  steps = 20,
): void {
  for (let i = 0; i <= steps; i++) {
    const progress = from + ((to - from) * i) / steps
    tracker.observe(behavior.stack({ ...options, progress } as never, sheet), set)
  }
}

describe('crease lines', () => {
  it('reads a fold and its mirror as the same line', () => {
    // Same line, opposite travel: the flap changes sides, the crease does not.
    expect(sameLine({ angle: 90, offset: 0.2 }, { angle: 270, offset: -0.2 })).toBe(true)
  })

  it('keeps letter-fold’s two creases apart', () => {
    // Both at +h/6, travelling opposite ways — two lines a third of the sheet
    // apart, and the whole tri-fold is wrong if they collapse into one.
    const [bottom, top] = letterFold.stack({ progress: 1, crease: 0.3 }, sheet)
    expect(sameLine(bottom!.options as never, top!.options as never)).toBe(false)
  })

  it('does not confuse lines that merely share an offset', () => {
    expect(sameLine({ angle: 0, offset: 0.3 }, { angle: 90, offset: 0.3 })).toBe(false)
  })
})

describe('applyMemory', () => {
  it('is a floor on a live fold, never an addition', () => {
    const stack = [fold(90, 0.2, 120)]
    const out = applyMemory(stack, [crease(90, 0.2, 15)])
    // The behavior is folding this line far past its crease — the crease is
    // invisible, and must not add fifteen degrees to a hundred and twenty.
    expect((out[0]!.options as { foldAngle: number }).foldAngle).toBe(120)
    expect(out).toHaveLength(1)
  })

  it('holds a released fold open at the crease', () => {
    const out = applyMemory([fold(90, 0.2, 3)], [crease(90, 0.2, 15)])
    expect((out[0]!.options as { foldAngle: number }).foldAngle).toBe(15)
    expect(out).toHaveLength(1)
  })

  it('never leaves the caller’s stack modified', () => {
    const stack = [fold(90, 0.2, 3)]
    applyMemory(stack, [crease(90, 0.2, 15)])
    expect((stack[0]!.options as { foldAngle: number }).foldAngle).toBe(3)
  })

  it('prepends a crease that has no live fold, at the crease radius', () => {
    const out = applyMemory([{ type: 'curl', options: {} }], [crease(90, 0.2, 15)])
    expect(out).toHaveLength(2)
    expect(out[0]!.type).toBe('fold')
    expect(out[0]!.options).toMatchObject({ angle: 90, offset: 0.2, foldAngle: 15, radius: CREASE_RADIUS })
    // Before the behavior: the sheet is already creased when it picks it up.
    expect(out[1]!.type).toBe('curl')
  })

  it('folds a crease onto a sheet with no stack at all', () => {
    const out = applyMemory([], [crease(90, 0.2, 15)])
    expect(out).toHaveLength(1)
  })

  it('keeps the fold direction the paper was folded in', () => {
    const out = applyMemory([fold(90, 0, 0)], [crease(90, 0, -15)])
    expect((out[0]!.options as { foldAngle: number }).foldAngle).toBe(-15)
  })

  it('ignores a crease too shallow to see', () => {
    const out = applyMemory([fold(90, 0, 0)], [crease(90, 0, 0.4)])
    expect((out[0]!.options as { foldAngle: number }).foldAngle).toBe(0)
    expect(out).toHaveLength(1)
  })

  it('leaves a stack with no creases exactly as it found it', () => {
    const stack = [fold(90, 0.2, 30)]
    expect(applyMemory(stack, [])).toBe(stack)
  })
})

describe('CreaseTracker', () => {
  it('records the two creases a letter fold makes', () => {
    const tracker = new CreaseTracker()
    play(tracker, letterFold, { crease: 0.3 }, 0, 1, 1)

    const creases = tracker.creases
    expect(creases).toHaveLength(2)
    // Both lines sit a sixth of the sheet either side of centre.
    const offsets = creases.map((c) => c.offset).sort((a, b) => a - b)
    expect(offsets).toEqual([sheet.height / 6, sheet.height / 6])
    expect(creases.map((c) => c.angle).sort((a, b) => a - b)).toEqual([90, 270])
  })

  it('scales the crease by how much the paper keeps', () => {
    const kraft = new CreaseTracker()
    const vellum = new CreaseTracker()
    play(kraft, letterFold, { crease: 0.3 }, 0, 1, getStock('kraft').takesSet)
    play(vellum, letterFold, { crease: 0.3 }, 0, 1, getStock('vellum').takesSet)

    const deepest = (t: CreaseTracker) => Math.max(...t.creases.map((c) => Math.abs(c.depth)))
    expect(deepest(kraft)).toBeGreaterThan(deepest(vellum) * 3)
    // The bottom flap closes to 165°; kraft keeps 0.85 × MAX_SET of it.
    expect(deepest(kraft)).toBeCloseTo(165 * getStock('kraft').takesSet * MAX_SET, 5)
  })

  it('leaves perfectly elastic paper uncreased', () => {
    const tracker = new CreaseTracker()
    play(tracker, letterFold, { crease: 0.3 }, 0, 1, 0)
    expect(tracker.creases).toEqual([])
  })

  it('does not crease a fold that never closes far enough', () => {
    const tracker = new CreaseTracker()
    // A third of the way in, the bottom flap is only at ~69° — a bend.
    play(tracker, letterFold, { crease: 0.3 }, 0, 0.33, 1)
    const deepest = tracker.creases.map((c) => Math.abs(c.depth))
    expect(deepest.every((d) => d > 0)).toBe(true)
    // ...but stop below the growth threshold and there is nothing at all.
    const shy = new CreaseTracker()
    play(shy, letterFold, { crease: 0.3 }, 0, 0.2, 1)
    expect(shy.creases).toEqual([])
  })

  it('does not crease a hinge that travels', () => {
    // `unroll`'s landing fold sits at exactly 90° forever while its line walks
    // down the sheet. Paper coming off a roll is bent at the floor, not
    // creased, and a trail of creases behind it would be the obvious bug.
    const tracker = new CreaseTracker()
    for (let i = 0; i <= 40; i++) {
      tracker.observe(unroll.stack({ ...unroll.defaults, progress: i / 40 } as never, sheet), 1)
    }
    expect(tracker.creases).toEqual([])
  })

  it('does not crease a sheet that was authored folded and merely opened', () => {
    // No growth: the fold was already closed when we first saw it. Whoever
    // folded this letter should have shipped the crease in the preset.
    const tracker = new CreaseTracker()
    play(tracker, letterFold, { crease: 0.3 }, 1, 0, 1)
    expect(tracker.creases).toEqual([])
  })

  it('creases on the second pass, having watched the first', () => {
    const tracker = new CreaseTracker()
    play(tracker, letterFold, { crease: 0.3 }, 1, 0, 1)
    play(tracker, letterFold, { crease: 0.3 }, 0, 1, 1)
    expect(tracker.creases).toHaveLength(2)
  })

  it('reports a change once, not every frame', () => {
    const tracker = new CreaseTracker()
    const stack = (p: number) => letterFold.stack({ progress: p, crease: 0.3 } as never, sheet)
    let changes = 0
    for (let i = 0; i <= 60; i++) if (tracker.observe(stack(i / 60), 1)) changes++
    const settled = tracker.observe(stack(1), 1)
    // It deepens as the fold closes, so it does report more than once — but
    // once the fold stops moving it goes quiet, which is the property that
    // keeps this off the React path.
    expect(changes).toBeGreaterThan(0)
    expect(settled).toBe(false)
  })

  it('keeps its creases when the stack is replaced', () => {
    const tracker = new CreaseTracker()
    play(tracker, letterFold, { crease: 0.3 }, 0, 1, 1)
    const before = tracker.creases
    tracker.reset()
    expect(tracker.creases).toEqual(before)
  })

  it('does not stall mid-fold when the host writes a crease back', () => {
    const tracker = new CreaseTracker()
    const stack = (p: number) => letterFold.stack({ progress: p, crease: 0.3 } as never, sheet)
    for (let i = 0; i <= 10; i++) {
      if (tracker.observe(stack(i / 20), 1)) tracker.adopt(tracker.creases)
    }
    const halfway = Math.max(...tracker.creases.map((c) => Math.abs(c.depth)))
    for (let i = 11; i <= 20; i++) {
      if (tracker.observe(stack(i / 20), 1)) tracker.adopt(tracker.creases)
    }
    // The echo of our own recording must not reset the peak the fold is still
    // climbing — the crease has to go on deepening to the end of the fold.
    expect(Math.max(...tracker.creases.map((c) => Math.abs(c.depth)))).toBeGreaterThan(halfway)
  })

  it('goes quiet once the fold stops, even under a deeper authored crease', () => {
    // Reading the merged view used to hand back the tracker's OWN recorded
    // objects, and the deeper-wins step wrote through them — so reading the
    // creases rewrote the depth that had just been recorded. The next frame
    // then saw a change that was nothing but its own echo, and reported one
    // every frame forever: in the editor, a config write per frame for as
    // long as the paper was on screen.
    const authored = crease(270, sheet.height / 6, 40)
    const tracker = new CreaseTracker([authored])
    const stack = (p: number) => letterFold.stack({ progress: p, crease: 0.3 } as never, sheet)
    // `set` low enough that folding records something SHALLOWER than the
    // authored crease, which is the only way the deeper-wins step fires.
    for (let i = 0; i <= 20; i++) if (tracker.observe(stack(i / 20), 0.2)) void tracker.creases

    expect(tracker.observe(stack(1), 0.2)).toBe(false)
    void tracker.creases
    expect(tracker.observe(stack(1), 0.2)).toBe(false)
  })

  it('hands out creases nobody can reach back through', () => {
    const tracker = new CreaseTracker()
    play(tracker, letterFold, { crease: 0.3 }, 0, 1, 1)
    const taken = tracker.creases
    taken[0]!.depth = 999
    expect(tracker.creases[0]!.depth).not.toBe(999)
  })

  it('never records more creases than the shader can draw', () => {
    const tracker = new CreaseTracker()
    // Six accordion creases across one sheet, all folded together.
    const stack = (p: number) => Array.from({ length: 6 }, (_, i) => fold(90, -0.6 + i * 0.24, p * 160))
    for (let i = 0; i <= 20; i++) tracker.observe(stack(i / 20), 1)
    expect(tracker.creases).toHaveLength(MAX_CREASES)
  })

  it('takes the deeper of an authored crease and a recorded one on the same line', () => {
    const deep = crease(90, sheet.height / 6, 40)
    const tracker = new CreaseTracker([deep])
    play(tracker, letterFold, { crease: 0.3 }, 0, 1, 0.2)
    const onLine = tracker.creases.find((c) => sameLine(c, deep))!
    // Folding a creased sheet along its own crease re-makes it; it does not
    // add a second one, and it does not shallow the one that is there.
    expect(Math.abs(onLine.depth)).toBe(40)
  })

  it('exposes a growth threshold the built-in fold actually clears', () => {
    // A guard on the constant itself: letter-fold's leading flap closes to
    // 165°, so any threshold above that silently turns the feature off.
    expect(CREASE_MIN_GROWTH).toBeLessThan(165)
  })
})

describe('crease shading', () => {
  it('turns a fold’s travel angle into the line it leaves', () => {
    // fold travels +y, so the crease runs horizontally.
    const [shaded] = resolveCreases({}, [crease(90, 0, 15)], sheet)
    expect(shaded!.angle).toBe(0)
  })

  it('places the line where the fold put it', () => {
    const [centre] = resolveCreases({}, [crease(90, 0, 15)], sheet)
    expect(centre!.position).toBeCloseTo(0.5, 6)
    // A third of the way up a 1.4-tall sheet.
    const [third] = resolveCreases({}, [crease(90, sheet.height / 6, 15)], sheet)
    expect(third!.position).toBeCloseTo(0.5 + 1 / 6, 6)
  })

  it('saturates rather than growing without bound', () => {
    const [hard] = resolveCreases({}, [crease(90, 0, 120)], sheet)
    expect(hard!.strength).toBe(1)
  })

  it('draws authored crease lines and remembered ones together', () => {
    const shaded = resolveCreases(
      { creaseLines: { angle: 0, positions: [0.25], strength: 0.5 } },
      [crease(90, 0, 15)],
      sheet,
    )
    expect(shaded).toHaveLength(2)
    // Authored first: at the cap it is the recorded one that gets dropped,
    // never the one someone placed by hand.
    expect(shaded[0]!.position).toBe(0.25)
  })

  it('never hands the shader more lines than it has uniforms for', () => {
    const shaded = resolveCreases(
      { creaseLines: { angle: 0, positions: [0.1, 0.2, 0.3], strength: 0.5 } },
      [crease(90, 0, 15), crease(0, 0.2, 15)],
      sheet,
    )
    expect(shaded).toHaveLength(4)
  })
})

describe('memory config', () => {
  it('is on by default, at the stock’s own setting', () => {
    const config = paperConfigSchema.parse({})
    expect(config.memory.creases).toEqual([])
    // Unset means "whatever this paper is made of" — the stock decides.
    expect(config.memory.set).toBeUndefined()
    expect(getStock(config.stock).takesSet).toBeGreaterThan(0)
  })

  it('serializes a creased sheet into a preset and back', () => {
    const creases = [crease(90, 0.23, 18)]
    const config = paperConfigSchema.parse({ memory: { set: 0.4, creases } })
    const round = paperConfigSchema.parse(JSON.parse(JSON.stringify(config)))
    expect(round.memory).toEqual({ set: 0.4, creases })
  })

  it('refuses more creases than the renderer can carry', () => {
    const many = Array.from({ length: 5 }, (_, i) => crease(90, i * 0.1, 12))
    expect(paperConfigSchema.safeParse({ memory: { creases: many } }).success).toBe(false)
  })

  it('lets a paper opt out of remembering entirely', () => {
    expect(paperConfigSchema.parse({ memory: { set: 0 } }).memory.set).toBe(0)
  })
})

describe('a creased sheet with a simulation on it', () => {
  it('is legal, and the sim still owns the vertices', () => {
    // `memory` and a sim are not exclusive the way behavior and a sim are —
    // a creased sheet can be dropped into cloth. What must not happen is the
    // crease handing that sheet a deformer stack, because the sim writes
    // every vertex itself and the two would fight over the same buffer.
    const config = paperConfigSchema.parse({
      physics: { type: 'cloth' },
      memory: { creases: [crease(90, 0.2, 15)] },
    })
    expect(config.memory.creases).toHaveLength(1)
    expect(resolveConfig({ preset: config as never }).physics).toMatchObject({ type: 'cloth' })
  })
})

describe('a crease that leaves the editor', () => {
  it('survives the export diff', () => {
    // The export emits only what differs from the defaults, and a field it
    // does not know about is a field that silently does not travel — which
    // for creases means the editor shows them and the share link does not.
    const config = paperConfigSchema.parse({
      memory: { set: 0.4, creases: [crease(90, 0.23, 18)] },
    })
    const diffed = diffConfig(config) as { memory?: unknown }
    expect(diffed.memory).toEqual({ set: 0.4, creases: [crease(90, 0.23, 18)] })
    expect(paperConfigSchema.parse(diffed).memory).toEqual(config.memory)
  })

  it('stays out of the export when the paper is flat', () => {
    expect((diffConfig(paperConfigSchema.parse({})) as { memory?: unknown }).memory).toBeUndefined()
  })

  it('ships in the letter-fold preset as geometry, not as paint', () => {
    // It was `surface.creaseLines` — two marks in the shader that a letter
    // could unfold straight back out of. The preset is the argument for the
    // feature, so it has to be the thing itself.
    const letter = getPreset('letter-fold')
    expect(letter.surface.creaseLines).toBeUndefined()
    expect(letter.memory.creases).toHaveLength(2)
    // And they have to be on the lines the tri-fold actually bends, or
    // folding the letter draws a second pair beside the first.
    const folds = letterFold.stack({ progress: 1, crease: 0.3 }, letter.sheet)
    for (const fold of folds) {
      expect(letter.memory.creases.some((c) => sameLine(c, fold.options as never))).toBe(true)
    }
  })
})

describe('every stock', () => {
  it('says how hard it holds a crease', () => {
    for (const name of [
      'printer',
      'thermal',
      'kraft',
      'newsprint',
      'vellum',
      'photo-gloss',
      'sticker',
    ] as const) {
      const { takesSet } = getStock(name)
      expect(takesSet).toBeGreaterThan(0)
      expect(takesSet).toBeLessThanOrEqual(1)
    }
    // The material claim the feature rests on: fibrous stock remembers, coated
    // and translucent stock springs back.
    expect(getStock('kraft').takesSet).toBeGreaterThan(getStock('vellum').takesSet)
    expect(getStock('newsprint').takesSet).toBeGreaterThan(getStock('photo-gloss').takesSet)
  })
})
