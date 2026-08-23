import { useState } from 'react'
import { getLayout, listLayouts, listPresets } from 'paperlab'
import {
  button,
  folder,
  note,
  num,
  schemaControls,
  select,
  text,
  type Control,
} from '../controls/controlModel'
import { Panel } from '../controls/controls'
import { useEditor, type EditorZone } from '../state/store'

/**
 * Field mode inspector: Layout / Motion / Paper / Drop zones. Layout options
 * are generated from each layout's zod schema — community layouts get editor
 * UI for free, same as behaviors.
 */
export function FieldInspector() {
  const field = useEditor((s) => s.field)
  const patchField = useEditor((s) => s.patchField)
  const setAllSlots = useEditor((s) => s.setAllSlots)
  const addZone = useEditor((s) => s.addZone)
  const patchZone = useEditor((s) => s.patchZone)
  const removeZone = useEditor((s) => s.removeZone)
  // The "replace all" select only stages a target; the button applies it. This
  // keeps a blast-radius action (overwrites every per-slot preset choice) off a
  // stray drag of the dropdown — it's a deliberate click, not an on-change.
  const [replaceTarget, setReplaceTarget] = useState(field.slots[0] ?? 'photo-print')

  const layout = getLayout(field.layout)
  const layoutValues = { ...layout.defaults, ...field.layoutOptions } as Record<string, unknown>
  // A stamp sheet owns its own population (rows × columns) and is static +
  // interactive by design — so the free-count slider and the whole Motion
  // folder don't apply. Omit them rather than show levers the mode ignores.
  const isSheet = field.layout === 'sheet'

  const controls: Control[] = [
    folder('Layout', [
      select('type', field.layout, listLayouts(), (v) => patchField({ layout: v, layoutOptions: {} })),
      ...schemaControls(layout.optionsSchema, layoutValues, (key, value) =>
        patchField({ layoutOptions: { ...field.layoutOptions, [key]: value } }),
      ),
      isSheet
        ? // The count is derived (rows × columns) and motion is disabled, so
          // both levers are gone — leave one line explaining why.
          note('sheetNote', 'static sheet — rows × columns set the count; interaction states drive motion')
        : num('papers', field.count, { min: 2, max: 80, step: 1 }, (v) => patchField({ count: v })),
    ]),
    ...(isSheet
      ? []
      : [
          folder(
            'Motion',
            [
              select('driver', field.driver, ['autoplay', 'drag', 'none'], (v) =>
                patchField({ driver: v as 'autoplay' | 'drag' | 'none' }),
              ),
              num('speed', field.speed, { min: 0, max: 2, step: 0.01 }, (v) => patchField({ speed: v })),
              select('entrance', field.entrance, ['rise', 'scatter', 'none'], (v) =>
                patchField({ entrance: v as 'rise' | 'scatter' | 'none' }),
              ),
            ],
            { collapsed: true },
          ),
        ]),
    folder(
      'Paper',
      [
        select('replaceWith', replaceTarget, listPresets(), setReplaceTarget, 'replace all with'),
        button('Replace all →', () => setAllSlots(replaceTarget)),
      ],
      { collapsed: true },
    ),
    folder(
      'Drop zones',
      [
        // This folder used to open onto a button reading "addZone" and, if
        // you pressed it, seven bare rows with no edge between one zone and
        // the next. Every line here is now something a stranger can read:
        // what a drop zone is for, which zone they are editing, and what the
        // remove button removes.
        note(
          'zonesNote',
          field.zones.length === 0
            ? 'A target a paper can be dropped onto — give it a rectangle, and say which presets it accepts.'
            : 'Each zone is a rectangle in the scene. `accept` filters which papers it will take.',
        ),
        button('Add a drop zone', () => addZone(), 'addZone'),
        ...field.zones.map((zone, i) =>
          folder(zone.id || `zone ${i + 1}`, zoneControls(zone, i, patchZone, removeZone), {
            key: `zone${i}`,
          }),
        ),
      ],
      { collapsed: true },
    ),
  ]

  return <Panel controls={controls} />
}

/** One zone's controls (id, accept globs, rect, highlight, remove). */
function zoneControls(
  zone: EditorZone,
  i: number,
  patchZone: (index: number, patch: Partial<EditorZone>) => void,
  removeZone: (index: number) => void,
): Control[] {
  const key = (name: string) => `zone${i}_${name}`
  return [
    text(key('id'), zone.id, (v) => patchZone(i, { id: v }), { label: 'id' }),
    text(key('accept'), zone.accept, (v) => patchZone(i, { accept: v }), {
      label: 'accept',
      hint: 'comma-separated preset globs; empty = all',
    }),
    num(key('x'), zone.position[0], { min: -8, max: 8, step: 0.05, label: 'x' }, (v) =>
      patchZone(i, { position: [v, zone.position[1], zone.position[2]] }),
    ),
    num(key('y'), zone.position[1], { min: -6, max: 6, step: 0.05, label: 'y' }, (v) =>
      patchZone(i, { position: [zone.position[0], v, zone.position[2]] }),
    ),
    num(key('w'), zone.size[0], { min: 0.2, max: 8, step: 0.05, label: 'width' }, (v) =>
      patchZone(i, { size: [v, zone.size[1]] }),
    ),
    num(key('h'), zone.size[1], { min: 0.2, max: 6, step: 0.05, label: 'height' }, (v) =>
      patchZone(i, { size: [zone.size[0], v] }),
    ),
    select(
      key('highlight'),
      zone.highlight,
      ['glow', 'outline', 'none'],
      (v) => patchZone(i, { highlight: v as EditorZone['highlight'] }),
      'highlight',
    ),
    button(`Remove ${zone.id || `zone ${i + 1}`}`, () => removeZone(i), key('remove')),
  ]
}
