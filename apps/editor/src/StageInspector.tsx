import { getLayout, listLayouts, qualityNames, stageSchema, walkNames } from 'paperlab'
import { folder, note, num, schemaControls, select, text, type Control } from './controlModel'
import { Panel } from './controls'
import { useEditor } from './store'

/**
 * Stage mode inspector: Words / Walk / Arrangement / Stage / Performance.
 *
 * Everything under Stage is generated straight from `stageSchema`, nested
 * folders and all — same contract as behaviors and layouts. The two things
 * it does by hand are the two the schema cannot express well: the walk is
 * offered as named shapes rather than as a points array, and the text is a
 * paragraph rather than a slider.
 */
export function StageInspector() {
  const stage = useEditor((s) => s.stage)
  const patchStage = useEditor((s) => s.patchStage)
  const patchStageConfig = useEditor((s) => s.patchStageConfig)

  const layout = getLayout(stage.layout)
  const layoutValues = { ...layout.defaults, ...stage.layoutOptions } as Record<string, unknown>
  const stageValues = stageSchema.parse(stage.config) as unknown as Record<string, unknown>

  const controls: Control[] = [
    folder('Words', [
      text('text', stage.text, (v) => patchStage({ text: v }), { rows: 4 }),
      num('banners', stage.count, { min: 2, max: 60, step: 1 }, (v) => patchStage({ count: Math.round(v) })),
    ]),
    folder('Walk', [
      select('shape', stage.walk, [...walkNames], (v) => patchStage({ walk: v as never })),
      num(
        'progress',
        stage.progress,
        // Playing hands the walk to the clock; the scrubber only drives it
        // while paused, so a live slider would fight the animation.
        { min: 0, max: 1, step: 0.001, disabled: stage.playing },
        (v) => patchStage({ progress: v }),
      ),
    ]),
    folder('Arrangement', [
      select('layout', stage.layout, listLayouts(), (v) => patchStage({ layout: v, layoutOptions: {} })),
      // `path` is skipped: the Walk folder owns it, and the stage always
      // wins over whatever the layout carries so the two cannot disagree.
      ...schemaControls(
        layout.optionsSchema,
        layoutValues,
        (key, value) => patchStage({ layoutOptions: { ...stage.layoutOptions, [key]: value } }),
        ['path'],
      ),
    ]),
    folder(
      'Stage',
      schemaControls(stageSchema, stageValues, (key, value) => patchStageConfig({ [key]: value }), ['path']),
    ),
    folder('Performance', [
      select('quality', stage.quality, [...qualityNames], (v) =>
        patchStage({ quality: v as never, settled: null }),
      ),
      // Quality describes the DEVICE, not the artwork — it is deliberately
      // not in the stage schema, so it never travels in a preset or a link.
      note(
        'qualityNote',
        stage.quality === 'auto'
          ? `adapting — now at ${stage.settled ?? 'medium'}`
          : 'fixed: this is what that tier looks like everywhere',
      ),
    ]),
  ]

  return <Panel controls={controls} />
}
