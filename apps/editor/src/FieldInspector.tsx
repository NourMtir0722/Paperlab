import { LevaPanel, folder, useControls, useCreateStore } from 'leva'
import { getLayout, listLayouts, listPresets } from 'paperlab'
import { schemaControls } from './zodLeva'
import { useEditor } from './store'

/**
 * Field mode inspector: Layout / Motion / Scene. Layout options are
 * generated from each layout's zod schema — community layouts get editor UI
 * for free, same as behaviors.
 */
export function FieldInspector() {
  const field = useEditor((s) => s.field)
  const patchField = useEditor((s) => s.patchField)
  const store = useCreateStore()

  const layout = getLayout(field.layout)
  const layoutValues = { ...layout.defaults, ...field.layoutOptions } as Record<string, unknown>

  useControls(
    {
      Layout: folder({
        type: {
          value: field.layout,
          options: listLayouts(),
          onChange: (v: string, _, ctx) => {
            if (!ctx.initial) patchField({ layout: v, layoutOptions: {} })
          },
        },
        ...schemaControls(layout.optionsSchema, layoutValues, (key, value) =>
          patchField({ layoutOptions: { ...field.layoutOptions, [key]: value } }),
        ),
        papers: {
          value: field.count,
          min: 2,
          max: 80,
          step: 1,
          onChange: (v: number, _, ctx) => ctx.initial || patchField({ count: v }),
        },
      }),
      Motion: folder({
        driver: {
          value: field.driver,
          options: ['autoplay', 'drag', 'none'],
          onChange: (v: 'autoplay' | 'drag' | 'none', _, ctx) =>
            ctx.initial || patchField({ driver: v }),
        },
        speed: {
          value: field.speed,
          min: 0,
          max: 2,
          step: 0.01,
          onChange: (v: number, _, ctx) => ctx.initial || patchField({ speed: v }),
        },
        entrance: {
          value: field.entrance,
          options: ['rise', 'scatter', 'none'],
          onChange: (v: 'rise' | 'scatter' | 'none', _, ctx) =>
            ctx.initial || patchField({ entrance: v }),
        },
      }),
      Paper: folder({
        preset: {
          value: field.presetName,
          options: listPresets(),
          onChange: (v: string, _, ctx) => ctx.initial || patchField({ presetName: v }),
        },
      }),
    },
    { store },
  )

  return <LevaPanel store={store} fill flat titleBar={false} />
}
