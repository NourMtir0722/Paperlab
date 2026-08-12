import { LevaPanel, folder, useControls, useCreateStore } from 'leva'
import { getLayout, listLayouts, qualityNames, stageSchema, walkNames } from 'paperlab'
import { schemaControls } from './zodLeva'
import { useEditor } from './store'

/**
 * Stage mode inspector: Words / Walk / Shot / Scene.
 *
 * Everything below Words is generated straight from `stageSchema`, nested
 * folders and all — same contract as behaviors and layouts. The two things
 * it does by hand are the two the schema cannot express well: the walk is
 * offered as named shapes rather than as a points array, and the text is a
 * paragraph rather than a slider.
 */
export function StageInspector() {
  const stage = useEditor((s) => s.stage)
  const patchStage = useEditor((s) => s.patchStage)
  const patchStageConfig = useEditor((s) => s.patchStageConfig)
  const store = useCreateStore()

  const layout = getLayout(stage.layout)
  const layoutValues = { ...layout.defaults, ...stage.layoutOptions } as Record<string, unknown>
  const stageValues = stageSchema.parse(stage.config) as unknown as Record<string, unknown>

  useControls(
    {
      Words: folder({
        text: {
          value: stage.text,
          rows: 4,
          onChange: (v: string, _, ctx) => {
            if (!ctx.initial) patchStage({ text: v })
          },
        },
        banners: {
          value: stage.count,
          min: 2,
          max: 60,
          step: 1,
          onChange: (v: number, _, ctx) => {
            if (!ctx.initial) patchStage({ count: Math.round(v) })
          },
        },
      }),
      Walk: folder({
        shape: {
          value: stage.walk,
          options: [...walkNames],
          onChange: (v: string, _, ctx) => {
            if (!ctx.initial) patchStage({ walk: v as never })
          },
        },
        progress: {
          value: stage.progress,
          min: 0,
          max: 1,
          step: 0.001,
          // Playing hands the walk to the clock; the scrubber only drives it
          // while paused, so a live slider would fight the animation.
          disabled: stage.playing,
          onChange: (v: number, _, ctx) => {
            if (!ctx.initial) patchStage({ progress: v })
          },
        },
      }),
      Arrangement: folder({
        layout: {
          value: stage.layout,
          options: listLayouts(),
          onChange: (v: string, _, ctx) => {
            if (!ctx.initial) patchStage({ layout: v, layoutOptions: {} })
          },
        },
        // `path` is skipped: the Walk folder owns it, and the stage always
        // wins over whatever the layout carries so the two cannot disagree.
        ...schemaControls(
          layout.optionsSchema,
          layoutValues,
          (key, value) => patchStage({ layoutOptions: { ...stage.layoutOptions, [key]: value } }),
          ['path'],
        ),
      }),
      Stage: folder(schemaControls(stageSchema, stageValues, patchStageConfigKey, ['path'])),
      Performance: folder({
        quality: {
          value: stage.quality,
          options: [...qualityNames],
          onChange: (v: string, _, ctx) => {
            if (!ctx.initial) patchStage({ quality: v as never, settled: null })
          },
        },
        // Quality describes the DEVICE, not the artwork — it is deliberately
        // not in the stage schema, so it never travels in a preset or a link.
        note: {
          value:
            stage.quality === 'auto'
              ? `adapting — now at ${stage.settled ?? 'medium'}`
              : 'fixed: this is what that tier looks like everywhere',
          editable: false,
          label: 'ⓘ',
        },
      }),
    },
    { store },
    [stage],
  )

  function patchStageConfigKey(key: string, value: unknown) {
    patchStageConfig({ [key]: value })
  }

  return <LevaPanel store={store} fill flat titleBar={false} />
}
