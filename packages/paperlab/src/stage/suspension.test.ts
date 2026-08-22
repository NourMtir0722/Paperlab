import { describe, expect, it } from 'vitest'
import { topOfSheet } from './Suspension'
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
    expect(stageSuspensionSchema.parse({})).toMatchObject({ type: 'thread', clips: true })
  })

  it('every stage preset shows its hardware', () => {
    for (const id of listStagePresets()) {
      expect(stageSchema.parse(getStagePreset(id).stage).suspension.type).toBe('thread')
    }
  })

  it('can be turned off, for a stage where the paper should be impossible', () => {
    expect(stageSchema.parse({ suspension: { type: 'none' } }).suspension.type).toBe('none')
  })
})
