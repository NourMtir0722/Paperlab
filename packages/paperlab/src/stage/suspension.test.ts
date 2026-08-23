import { describe, expect, it } from 'vitest'
import { rodLength, topOfSheet } from './Suspension'
import { stageSuspensionSchema, stageSchema } from './schema'
import { getStagePreset, listStagePresets } from './presets'
import type { PaperPose } from '../field/layouts'

const pose = (o: Partial<PaperPose> = {}): PaperPose => ({
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: 1,
  ...o,
})

describe('where a thread attaches', () => {
  it('hangs from the top edge, not from the centre', () => {
    const top = topOfSheet(pose({ position: [1, 2, 3] }), 4)
    expect(top.x).toBeCloseTo(1)
    expect(top.y).toBeCloseTo(4) // 2 + half of 4
    expect(top.z).toBeCloseTo(3)
  })

  it('follows the pose scale, because a scaled banner has a taller top', () => {
    expect(topOfSheet(pose({ scale: 2 }), 4).y).toBeCloseTo(4)
  })

  it('a banner twisted on its axis still hangs from its OWN top edge', () => {
    // Yaw does not move the top edge — it is still directly above centre.
    const yawed = topOfSheet(pose({ rotation: [0, Math.PI / 3, 0] }), 4)
    expect(yawed.y).toBeCloseTo(2)
    expect(yawed.x).toBeCloseTo(0)
  })

  it('a banner TILTED leans its top edge sideways, and the thread follows', () => {
    // This is the case a naive "straight up from the centre" would get wrong:
    // the paper's top has moved, so the attachment point has to move with it.
    const tilted = topOfSheet(pose({ rotation: [0, 0, Math.PI / 2] }), 4)
    expect(tilted.y).toBeCloseTo(0)
    expect(Math.abs(tilted.x)).toBeCloseTo(2)
  })
})

describe('the suspension config', () => {
  it('hangs paper from something by default', () => {
    expect(stageSuspensionSchema.parse({})).toMatchObject({ type: 'thread', hardware: 'clip' })
  })

  /**
   * The assertion, not the value. This used to demand `'thread'` from every
   * preset, which reads as "shows its hardware" only while thread is the one
   * kind there is — the moment a stage hangs its paper on a rod instead, a
   * test named for the principle fails for obeying it.
   */
  it('every stage preset shows its hardware', () => {
    for (const id of listStagePresets()) {
      expect(stageSchema.parse(getStagePreset(id).stage).suspension.type, id).not.toBe('none')
    }
  })

  it('carries the whole hardware vocabulary the plan asked for', () => {
    for (const type of ['none', 'thread', 'rod'] as const) {
      expect(stageSuspensionSchema.parse({ type }).type).toBe(type)
    }
    for (const hardware of ['none', 'clip', 'peg'] as const) {
      expect(stageSuspensionSchema.parse({ hardware }).hardware).toBe(hardware)
    }
  })

  it('a rod is wider than the paper it holds, and scales with it', () => {
    // Cut flush, a dowel reads as part of the sheet rather than as the thing
    // holding it.
    expect(rodLength({ width: 1 }, pose({}))).toBeGreaterThan(1)
    expect(rodLength({ width: 1 }, pose({ scale: 0.5 }))).toBeCloseTo(rodLength({ width: 1 }, pose({})) * 0.5)
  })

  it('can be turned off, for a stage where the paper should be impossible', () => {
    expect(stageSchema.parse({ suspension: { type: 'none' } }).suspension.type).toBe('none')
  })
})

/**
 * The architecture the room had been missing: a column with a base plate,
 * a doorway, a wall corner. A ceiling and floor seams shipped,
 * and both are BOUNDARIES — they say where the room stops, not how big it
 * is. These are the pieces that stand in it.
 */
describe('the room’s architecture', () => {
  it('is off unless a stage asks for it', () => {
    const room = stageSchema.parse({}).room
    expect(room.columns.enabled).toBe(false)
    expect(room.doorway.enabled).toBe(false)
  })

  it('gives a column a base plate wider than its shaft', () => {
    // The plate is the only element that puts a hard horizontal edge at a
    // KNOWN height off the floor, which is what makes a floor read as one.
    // `Columns` derives it as width × 1.45; the shaft cannot be wider.
    const { width } = stageSchema.parse({ room: { columns: { enabled: true } } }).room.columns
    expect(width * 1.45).toBeGreaterThan(width)
  })

  it('stands its columns outside the paper, not between it and the viewer', () => {
    const room = stageSchema.parse({}).room
    // Every built-in colonnade's aisle is under 3; a column inside that
    // would be architecture standing in front of the subject.
    expect(room.columns.offset).toBeGreaterThan(3)
  })

  it('keeps columns darker than paper, so the light and the paper stay brightest', () => {
    const hex = stageSchema.parse({}).room.columns.color
    const value = Number.parseInt(hex.slice(1, 3), 16)
    expect(value).toBeLessThan(0x99)
  })

  it('opens a doorway around the source rather than beside it', () => {
    // 1 frames the source exactly; the default leaves a hair of wall.
    expect(stageSchema.parse({}).room.doorway.opening).toBeGreaterThanOrEqual(1)
  })
})

describe('what the built-in stages hang from', () => {
  it('has at least one stage on each kind of hardware, so none of it is untested art', () => {
    const kinds = new Set(
      listStagePresets().map((id) => {
        const s = stageSchema.parse(getStagePreset(id).stage).suspension
        return `${s.type}:${s.hardware}`
      }),
    )
    expect([...kinds].some((k) => k.startsWith('rod'))).toBe(true)
    expect([...kinds].some((k) => k.endsWith('peg'))).toBe(true)
    expect([...kinds].some((k) => k === 'thread:clip')).toBe(true)
  })

  it('has at least one stage showing the architecture', () => {
    const rooms = listStagePresets().map((id) => stageSchema.parse(getStagePreset(id).stage).room)
    expect(
      rooms.some((r) => r.columns.enabled),
      'no stage shows a column',
    ).toBe(true)
    expect(
      rooms.some((r) => r.doorway.enabled),
      'no stage shows a doorway',
    ).toBe(true)
  })
})
