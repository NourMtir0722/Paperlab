import { describe, expect, it } from 'vitest'
import { GradePass } from './GradeLazy'
import { stageSchema } from './schema'

/**
 * A grade that draws nothing must not import the module that draws it.
 *
 * The missing-peer warning tells a consumer to zero the grade to silence it,
 * and that advice was false: `GradePass` mounted the lazy import whenever the
 * quality tier allowed a grade, so a zeroed grade still imported, still failed
 * without the peers, and still warned. It decides before the import now.
 */
describe('GradePass', () => {
  const grade = stageSchema.parse({}).grade

  it('renders nothing, and so imports nothing, for an all-zero grade', () => {
    const off = { bloom: 0, depth: 0, vignette: 0, grain: 0, threshold: grade.threshold }
    expect(GradePass({ grade: { ...grade, ...off }, film: 'agx' })).toBeNull()
  })

  it('mounts the pass when any part of the grade is on', () => {
    for (const key of ['bloom', 'depth', 'vignette', 'grain'] as const) {
      const off = { ...grade, bloom: 0, depth: 0, vignette: 0, grain: 0, [key]: 0.3 }
      expect(GradePass({ grade: off, film: 'agx' })).not.toBeNull()
    }
  })
})
