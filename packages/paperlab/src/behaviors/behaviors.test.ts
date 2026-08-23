import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { peel } from './peel'
import { unroll } from './unroll'
import { flip } from './flip'
import { carry } from './carry'
import { flight } from './flight'
import { getBehavior, listBehaviors } from './registry'
import { behaviorConfigSchema, paperConfigSchema } from '../config/schema'
import { settle } from './settle'
import { ribbon, ribbonOptionsSchema } from './ribbon'
import { getDeformer } from '../deformers/registry'

const sheet = { width: 1, height: 2.6 }

describe('behavior registry', () => {
  it('has the built-in behaviors', () => {
    expect(listBehaviors()).toEqual([
      'peel',
      'unroll',
      'flip',
      'letter-fold',
      'hang',
      'fly',
      'fall',
      'carry',
      'flight',
      'crumple',
      'settle',
      'ribbon',
    ])
  })

  it('throws helpfully on unknown behaviors', () => {
    expect(() => getBehavior('teleport')).toThrow(/Unknown behavior/)
  })
})

describe('peel', () => {
  it('expands human params to a curl instance', () => {
    const stack = peel.stack({ progress: 0.4, corner: 'top-left', radius: 0.2 }, { width: 1, height: 1 })
    expect(stack).toEqual([
      // radius grows with progress: 0.2 + 0.4·0.3
      { type: 'curl', options: { corner: 'top-left', amount: 0.4, radius: 0.32, skew: 0 } },
    ])
  })

  it('handle drag maps pull-distance to progress, clamped to [0, 1]', () => {
    const o = peel.defaults
    const handle = peel.handles![0]!
    // Corner of a 1×1 sheet is (0.5, -0.5); dragging to the center is
    // half-diagonal travel → progress ≈ 1... scaled by diag·0.5.
    const atCorner = handle.drag({ x: 0.5, y: -0.5 }, o, { width: 1, height: 1 })
    expect(atCorner.progress).toBeCloseTo(0, 5)
    const wayPast = handle.drag({ x: -5, y: 5 }, o, { width: 1, height: 1 })
    expect(wayPast.progress).toBe(1)
  })
})

describe('unroll', () => {
  it('progress 0 rolls everything, progress 1 is flat', () => {
    const rolled = unroll.stack({ progress: 0, tightness: 0.5, sway: 0 }, sheet)
    expect(rolled[0]!.options).toMatchObject({ angle: 270, boundary: -1.3 })
    const flat = unroll.stack({ progress: 1, tightness: 0.5, sway: 0 }, sheet)
    // Boundary swept past the bottom edge (+ slack): nothing left to roll.
    expect((flat[0]!.options as { boundary: number }).boundary).toBeGreaterThan(sheet.height / 2)
  })

  it('tightness shrinks the roll radius', () => {
    const loose = unroll.stack({ progress: 0.5, tightness: 0, sway: 0 }, sheet)
    const tight = unroll.stack({ progress: 0.5, tightness: 1, sway: 0 }, sheet)
    const rLoose = (loose[0]!.options as { radius: number }).radius
    const rTight = (tight[0]!.options as { radius: number }).radius
    expect(rLoose).toBeGreaterThan(rTight)
    expect(rTight).toBeGreaterThan(0)
  })

  it('sway loop is transient and bounded', () => {
    const o = { progress: 0.5, tightness: 0.5, sway: 1 }
    for (const t of [0, 0.7, 1.9, 3.2]) {
      const p = unroll.loop!(o, t).progress!
      expect(Math.abs(p - o.progress)).toBeLessThanOrEqual(0.01)
    }
    expect(unroll.loop!({ ...o, sway: 0 }, 1)).toEqual({})
  })
})

describe('flip', () => {
  it('sweeps the roll boundary from the free edge to the spine', () => {
    const s = { width: 1, height: 1.4 }
    const flat = flip.stack({ progress: 0, spine: 'left', radius: 0.3 }, s)
    expect((flat[0]!.options as { boundary: number }).boundary).toBeCloseTo(0.5)
    const turned = flip.stack({ progress: 1, spine: 'left', radius: 0.3 }, s)
    expect((turned[0]!.options as { boundary: number }).boundary).toBeCloseTo(-0.5)
  })
})

describe('carry', () => {
  it('droops from the grab corner; stiffness fights the droop', () => {
    const soft = carry.stack({ grab: 'top-left', stiffness: 0.2, flutter: 0.5, lag: 0.3, drive: 0 }, sheet)
    const stiff = carry.stack({ grab: 'top-left', stiffness: 0.9, flutter: 0.5, lag: 0.3, drive: 0 }, sheet)
    const curvature = (s: typeof soft) => Math.abs((s[0]!.options as { curvature: number }).curvature)
    expect(curvature(soft)).toBeGreaterThan(curvature(stiff))
  })

  it('drag velocity becomes flutter: drive scales the wave amplitude', () => {
    const still = carry.stack(
      { grab: 'bottom-right', stiffness: 0.7, flutter: 0.5, lag: 0.3, drive: 0 },
      sheet,
    )
    const moving = carry.stack(
      { grab: 'bottom-right', stiffness: 0.7, flutter: 0.5, lag: 0.3, drive: 1 },
      sheet,
    )
    const amp = (s: typeof still) => (s[1]!.options as { amplitude: number }).amplitude
    expect(amp(moving)).toBeGreaterThan(amp(still))
    // The grabbed edge doesn't flutter — it's pinched.
    expect((still[1]!.options as { pinnedEdge: string }).pinnedEdge).toBe('bottom')
  })
})

describe('flight', () => {
  it('ships a whole-sheet transform (travel) plus a flutter stack', () => {
    expect(flight.transform).toBeTypeOf('function')
    const stack = flight.stack(flight.defaults, sheet)
    expect(stack.map((i) => i.type)).toEqual(['bend', 'wave'])
  })

  it('is in the registry and the schema union', () => {
    expect(listBehaviors()).toContain('flight')
    expect(behaviorConfigSchema.parse({ type: 'flight' })).toMatchObject({
      wind: [0.6, 0.08, 0],
      gustiness: 0.4,
      tumble: 0.6,
      path: 'drift',
      respawn: true,
    })
  })
})

describe('behavior config schema', () => {
  it('parses and defaults each behavior type', () => {
    expect(behaviorConfigSchema.parse({ type: 'peel' })).toMatchObject({
      progress: 0.35,
      corner: 'bottom-right',
    })
    expect(behaviorConfigSchema.parse({ type: 'unroll' })).toMatchObject({ tightness: 0.5 })
  })

  it('round-trips a paper config with a behavior', () => {
    const config = paperConfigSchema.parse({
      behavior: { type: 'unroll', progress: 0.7 },
    })
    expect(paperConfigSchema.parse(JSON.parse(JSON.stringify(config)))).toEqual(config)
  })

  it('rejects unknown behavior types', () => {
    expect(() => paperConfigSchema.parse({ behavior: { type: 'teleport' } })).toThrow()
  })
})

const SHEET = { width: 1.2, height: 0.9 }

describe('settle — the pose after the fall', () => {
  it('is STATIC, which is the whole behavior', () => {
    // `fall` flutters: its wave carries speed 1.3, because it is a sheet
    // still arguing with the air. This one is over. A settled sheet that
    // ripples is a settled sheet nobody believes — and it also costs a
    // per-frame re-deform forever, for motion that should not be there.
    const wave = settle.stack(settle.defaults, SHEET).find((d) => d.type === 'wave')
    expect(wave).toBeDefined()
    expect((wave!.options as { speed: number }).speed).toBe(0)
  })

  it('relaxing flattens it, and stiffness is the floor under that', () => {
    const held = (o: Partial<typeof settle.defaults>) => {
      const stack = settle.stack({ ...settle.defaults, ...o }, SHEET)
      return (stack.find((d) => d.type === 'curl')!.options as { amount: number }).amount
    }
    // Longer settled, flatter.
    expect(held({ relax: 1 })).toBeLessThan(held({ relax: 0 }))
    // Stiffer stock keeps more of its shape, however long it lies there.
    expect(held({ relax: 1, lift: 1 })).toBeGreaterThan(held({ relax: 1, lift: 0.2 }))
    // Tissue surrenders completely.
    expect(held({ lift: 0 })).toBe(0)
  })

  it('lifts a corner harder than `fall` does, and that is deliberate', () => {
    // The corner a settled sheet holds up is the one thing gravity could not
    // take from it. An earlier pass scaled this BELOW fall's and rendered a
    // flat rectangle — the one outcome this behavior exists to avoid.
    const settled = (
      settle.stack(settle.defaults, SHEET).find((d) => d.type === 'curl')!.options as {
        amount: number
      }
    ).amount
    expect(settled).toBeGreaterThan(0.1)
  })

  it('never animates, at any setting', () => {
    for (const relax of [0, 0.5, 1]) {
      for (const slack of [0, 1]) {
        const stack = settle.stack({ ...settle.defaults, relax, slack }, SHEET)
        for (const d of stack) {
          expect((d.options as { speed?: number }).speed ?? 0).toBe(0)
        }
      }
    }
  })
})

describe('ribbon — the strip that reaches the floor and keeps going', () => {
  const fold = (o: Partial<typeof ribbon.defaults>, sheet = { width: 0.9, height: 8 }) =>
    ribbon.stack({ ...ribbon.defaults, ...o }, sheet).find((d) => d.type === 'fold')!.options as {
      offset: number
      foldAngle: number
      radius: number
      angle: number
    }

  /**
   * The crease sits a hinge-radius ABOVE the floor line, on purpose.
   *
   * These two used to assert the crease landed exactly on it, which is the
   * arithmetic that put the pool underneath the ground — the hinge wraps a
   * cylinder of `radius / φ` and the flap leaves it that much lower. What
   * has to land on the line is the pool; where the crease goes follows from
   * that. See "lands the pool ON the floor" below, which measures the thing
   * itself rather than the intermediate.
   */
  const hingeDrop = (o: Partial<typeof ribbon.defaults>, sheet = { width: 0.9, height: 8 }) =>
    fold(o, sheet).radius / (Math.PI / 2)

  it('creases a hinge above the floor line, which it can only know from the sheet', () => {
    // Almost every behavior takes only its options. This one cannot: "a
    // pool-length above the bottom edge" is meaningless without a height.
    const sheet = { width: 0.9, height: 8 }
    // pool 0.25 of an 8-high sheet -> the floor line is 2 above the bottom
    // edge, i.e. at y = -4 + 2 = -2, measured downward as +2 — and the
    // crease goes one hinge higher so the flap comes to rest on it.
    expect(fold({ pool: 0.25 }, sheet).offset).toBeCloseTo(2 - hingeDrop({ pool: 0.25 }, sheet), 6)
  })

  it('a ribbon with no pool creases at its own bottom edge — nothing lies down', () => {
    expect(fold({ pool: 0 }).offset).toBeCloseTo(4 - hingeDrop({ pool: 0 }), 6)
  })

  it('the crease travels DOWN the drop, not up it', () => {
    // Pointed the other way the fold turns the whole drop from the ceiling.
    expect(fold({}).angle).toBe(-90)
  })

  it('a longer sheet gets a softer hinge, because paper does not scale', () => {
    const short = fold({}, { width: 0.9, height: 3 }).radius
    const long = fold({}, { width: 0.9, height: 12 }).radius
    expect(long).toBeGreaterThan(short)
  })

  /**
   * The one that matters, and the one a bounds check on 0..180 was standing
   * in for while being satisfied by a broken value.
   *
   * A hinge turns through one angle and the pooled length holds that heading
   * from the crease onward, so only a right angle is the floor. Under it the
   * pool keeps descending and goes through the ground; over it the pool
   * tilts back up and floats above it. The range shipped as `62 + curl * 46`
   * — 62°..108° — so it was wrong in one direction below curl 0.61 and wrong
   * in the other above, and right only at a single setting nothing used.
   */
  it('creases to a right angle at every setting — that is the only angle the floor is', () => {
    for (const curl of [0, 0.25, 0.45, 0.5, 0.75, 1]) {
      expect(fold({ curl }).foldAngle, `curl ${curl} does not lay the pool on the floor`).toBe(90)
    }
  })

  /**
   * The whole stage, in one number.
   *
   * `colonnade` hangs a ribbon so that the crease sits on the floor —
   * `hover: -pool` — and the behavior has to make the POOL land there, which
   * is not the same thing. The hinge wraps a cylinder of `radius / φ` and
   * the flap leaves it that much lower than the crease line, so placing the
   * crease at the floor put the pooled length about 9cm UNDER it. On the
   * ribbon stage that meant the paper on the ground, the entire subject, was
   * inside the ground.
   *
   * This walks the strip the way the renderer does and asks where the pooled
   * end actually is, in the world, with the layout's own hover applied.
   */
  it('lands the pool ON the floor, not under it', () => {
    const sheet = { width: 1.05, height: 9 }
    for (const curl of [0, 0.34, 0.7, 1]) {
      const o = ribbonOptionsSchema.parse({ pool: 0.22, curl, drape: 0.6 })
      const stack = ribbon.stack(o, sheet).map((d) => ({
        type: d.type,
        options: getDeformer(d.type).optionsSchema.parse(d.options),
      }))
      // Where colonnade puts the sheet's centre for `hover: -pool`.
      const centreY = sheet.height / 2 + sheet.height * -0.22
      const out = new THREE.Vector3(0, -sheet.height / 2, 0)
      const uv = new THREE.Vector2(0.5, 0)
      for (const d of stack) getDeformer(d.type).displace(out, uv, d.options as never, { t: 0, sheet })
      const worldY = centreY + out.y
      expect(worldY, `curl ${curl}: the pooled end is ${worldY} — under the floor`).toBeGreaterThanOrEqual(0)
      // …and resting on it, not hovering somewhere above it.
      expect(worldY, `curl ${curl}: the pooled end floats at ${worldY}`).toBeLessThan(0.35)
      // It has to actually run OUT along the ground to be a pool at all.
      expect(out.z, `curl ${curl}: nothing lies down`).toBeGreaterThan(sheet.height * o.pool * 0.7)
    }
  })

  it('curl tightens the crease instead, which is what it always said it did', () => {
    expect(fold({ curl: 1 }).radius).toBeLessThan(fold({ curl: 0 }).radius)
    for (const curl of [0, 0.5, 1]) {
      expect(fold({ curl }).radius).toBeGreaterThan(0)
      expect(fold({ curl }).radius).toBeLessThanOrEqual(0.5)
    }
  })

  it('folds by the length that is meant to be lying down, not by the whole drop', () => {
    // The crease sits `pool` of the height above the bottom edge, so raising
    // pool has to move the hinge UP the sheet, never past its middle.
    const sheet = { width: 0.9, height: 8 }
    expect(fold({ pool: 0.5 }, sheet).offset).toBeLessThanOrEqual(0)
    expect(fold({ pool: 0.1 }, sheet).offset).toBeGreaterThan(fold({ pool: 0.4 }, sheet).offset)
  })

  it('gathers its folds toward the floor, not evenly down the drop', () => {
    // `wave` ran at one amplitude end to end; a hung strip is flat where it
    // is held. That difference is the reason this uses `drape`.
    const drape = ribbon.stack(ribbon.defaults, { width: 0.9, height: 8 }).find((d) => d.type === 'drape')
    expect(drape, 'ribbon no longer drapes').toBeDefined()
    expect((drape!.options as { falloff: number }).falloff).toBeGreaterThan(1)
    expect((drape!.options as { pinnedEdge: string }).pinnedEdge).toBe('top')
  })

  it('hangs still — a ribbon is not a flag', () => {
    for (const d of ribbon.stack(ribbon.defaults, { width: 0.9, height: 8 })) {
      expect((d.options as { speed?: number }).speed ?? 0).toBe(0)
    }
  })
})

/**
 * `signature` is what the editor gives the big controls to, and everything
 * unnamed folds away behind "More". Two things can go wrong and both are
 * silent: naming an option that does not exist (the control simply never
 * appears, and the param you meant to promote stays buried), and nominating
 * so many that nothing is actually triaged. A built-in that ships either way
 * teaches the wrong shape to every community behavior copying it.
 */
describe('signature params', () => {
  it('every built-in nominates its two or three', () => {
    for (const id of listBehaviors()) {
      const behavior = getBehavior(id)
      expect(behavior.signature, `${id} nominates no signature params`).toBeDefined()
      expect(behavior.signature!.length, `${id} nominates ${behavior.signature!.length}`).toBeGreaterThan(1)
      expect(behavior.signature!.length, `${id} nominates ${behavior.signature!.length}`).toBeLessThan(4)
    }
  })

  it('nominates only options the schema actually has', () => {
    for (const id of listBehaviors()) {
      const behavior = getBehavior(id)
      const schema = behavior.optionsSchema as unknown as { shape?: Record<string, unknown> }
      const keys = Object.keys(schema.shape ?? {})
      for (const name of behavior.signature ?? []) {
        expect(keys, `${id}.signature names "${name}", which is not in its schema`).toContain(name)
      }
    }
  })

  it('names each option once', () => {
    for (const id of listBehaviors()) {
      const signature = getBehavior(id).signature ?? []
      expect(new Set(signature).size, `${id} repeats a signature param`).toBe(signature.length)
    }
  })
})
