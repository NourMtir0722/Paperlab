import { describe, expect, it } from 'vitest'
import { getStagePreset, listStagePresets, stagePresets } from './presets'
import { stageSchema } from './schema'
import { createWalkPath } from './path'
import { getLayout } from '../field/layouts'
import { paperConfigSchema } from '../config/schema'
import { resolveDeformerStack } from '../deformers/registry'
import { stageCamera, shotSchema } from './camera'

const presets = () => Object.values(stagePresets)

describe('stage presets', () => {
  it('every preset validates against the stage schema', () => {
    for (const preset of presets()) {
      expect(() => stageSchema.parse(preset.stage)).not.toThrow()
    }
  })

  it('every preset names a real layout, and its options survive that layout', () => {
    for (const preset of presets()) {
      const layout = getLayout(preset.layout)
      expect(() => layout.optionsSchema.parse({ ...layout.defaults, ...preset.layoutOptions })).not.toThrow()
    }
  })

  it('every preset paper validates, and its deformers really exist', () => {
    for (const preset of presets()) {
      const config = paperConfigSchema.parse(preset.paper ?? {})
      // The strict raw-stack parse: a typo'd deformer option throws here.
      expect(() => resolveDeformerStack(config.deformers ?? [])).not.toThrow()
      expect(config.sheet.height).toBeGreaterThan(config.sheet.width)
    }
  })

  it('every preset builds paper at architectural scale — that is the whole mode', () => {
    for (const preset of presets()) {
      const stage = stageSchema.parse(preset.stage)
      const paper = paperConfigSchema.parse(preset.paper ?? {})
      // Banners are meaningfully taller than the person walking past them.
      expect(paper.sheet.height).toBeGreaterThan(stage.figure.height * 3)
    }
  })

  it('every preset frames its paper — the shot aims above the figure head', () => {
    for (const preset of presets()) {
      const stage = stageSchema.parse(preset.stage)
      const paper = paperConfigSchema.parse(preset.paper ?? {})
      const path = createWalkPath(stage.path)
      const shot = stageCamera(
        path,
        path.length * 0.4,
        { figure: stage.figure.height, paper: paper.sheet.height },
        shotSchema.parse(stage.shot),
      )
      // The bug this guards: a camera that only knew the figure's height
      // aimed at chest level and cropped the banners to their bottom third.
      expect(shot.target[1]).toBeGreaterThan(stage.figure.height)
    }
  })

  it('cloister is the endless one, and it is the only closed walk', () => {
    for (const preset of presets()) {
      const closed = stageSchema.parse(preset.stage).path.closed
      expect(closed).toBe(preset.id === 'cloister')
    }
  })

  it('carries a label, a one-line description and words to build the space from', () => {
    for (const preset of presets()) {
      expect(preset.label.length).toBeGreaterThan(0)
      expect(preset.description.length).toBeGreaterThan(10)
      expect(preset.text?.trim().length).toBeGreaterThan(0)
      expect(preset.count).toBeGreaterThan(1)
    }
  })

  it('lists and looks up by id, and says so when the id is wrong', () => {
    expect(listStagePresets()).toContain('nave')
    expect(getStagePreset('nave').id).toBe('nave')
    expect(() => getStagePreset('cathedral')).toThrow(/Unknown stage preset/)
  })
})
