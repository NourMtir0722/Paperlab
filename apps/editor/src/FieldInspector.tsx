import { LevaPanel, button, folder, useControls, useCreateStore } from 'leva'
import { getLayout, listLayouts, listPresets } from 'paperlab'
import { schemaControls } from './zodLeva'
import { useEditor, type EditorZone } from './store'

type LevaSchema = Parameters<typeof folder>[0]

/**
 * Field mode inspector: Layout / Motion / Scene. Layout options are
 * generated from each layout's zod schema — community layouts get editor UI
 * for free, same as behaviors.
 */
export function FieldInspector() {
  const field = useEditor((s) => s.field)
  const patchField = useEditor((s) => s.patchField)
  const setAllSlots = useEditor((s) => s.setAllSlots)
  const addZone = useEditor((s) => s.addZone)
  const patchZone = useEditor((s) => s.patchZone)
  const removeZone = useEditor((s) => s.removeZone)
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
        setAll: {
          label: 'set all to',
          value: field.slots[0] ?? 'photo-print',
          options: listPresets(),
          onChange: (v: string, _, ctx) => ctx.initial || setAllSlots(v),
        },
      }),
      'Drop zones': folder({
        addZone: button(() => addZone()),
        ...field.zones.reduce<LevaSchema>(
          (acc, zone, i) => Object.assign(acc, zoneControls(zone, i, patchZone, removeZone)),
          {},
        ),
      }),
    },
    { store },
  )

  return <LevaPanel store={store} fill flat titleBar={false} />
}

/** One zone's controls (id, accept globs, rect, highlight, remove). */
function zoneControls(
  zone: EditorZone,
  i: number,
  patchZone: (index: number, patch: Partial<EditorZone>) => void,
  removeZone: (index: number) => void,
): LevaSchema {
  const changed =
    (fn: (v: never) => void) => (v: unknown, _: unknown, ctx: { initial: boolean }) =>
      ctx.initial || fn(v as never)
  const key = (name: string) => `zone${i}_${name}`
  return {
    [key('id')]: {
      label: `#${i + 1} id`,
      value: zone.id,
      onChange: changed((v: string) => patchZone(i, { id: v })),
    },
    [key('accept')]: {
      label: 'accept',
      value: zone.accept,
      hint: 'comma-separated preset globs; empty = all',
      onChange: changed((v: string) => patchZone(i, { accept: v })),
    },
    [key('x')]: {
      label: 'x',
      value: zone.position[0],
      min: -8,
      max: 8,
      step: 0.05,
      onChange: changed((v: number) =>
        patchZone(i, { position: [v, zone.position[1], zone.position[2]] }),
      ),
    },
    [key('y')]: {
      label: 'y',
      value: zone.position[1],
      min: -6,
      max: 6,
      step: 0.05,
      onChange: changed((v: number) =>
        patchZone(i, { position: [zone.position[0], v, zone.position[2]] }),
      ),
    },
    [key('w')]: {
      label: 'width',
      value: zone.size[0],
      min: 0.2,
      max: 8,
      step: 0.05,
      onChange: changed((v: number) => patchZone(i, { size: [v, zone.size[1]] })),
    },
    [key('h')]: {
      label: 'height',
      value: zone.size[1],
      min: 0.2,
      max: 6,
      step: 0.05,
      onChange: changed((v: number) => patchZone(i, { size: [zone.size[0], v] })),
    },
    [key('highlight')]: {
      label: 'highlight',
      value: zone.highlight,
      options: ['glow', 'outline', 'none'],
      onChange: changed((v: EditorZone['highlight']) => patchZone(i, { highlight: v })),
    },
    [key('remove')]: button(() => removeZone(i)),
  }
}
