import {
  getLayout,
  lightAngles,
  lightSchema,
  lightingNames,
  listLayouts,
  resolveLighting,
  type LightOverrides,
  type LightingName,
} from 'paperlab'
import { qualityNames, stageSchema, walkNames } from 'paperlab/stage'
import {
  button,
  folder,
  note,
  num,
  numberRange,
  schemaControls,
  select,
  text,
  type Control,
} from './controlModel'
import { Panel } from './controls'
import { useEditor } from './store'

/**
 * Stage mode inspector: Words / Walk / Arrangement / Light / Stage /
 * Performance.
 *
 * Everything under Stage is generated straight from `stageSchema`, nested
 * folders and all — same contract as behaviors and layouts. Three things it
 * does by hand are the three the schema cannot express well: the walk is
 * offered as named shapes rather than as a points array, the text is a
 * paragraph rather than a slider, and the light is a set of OVERRIDES, whose
 * unset fields have no value for a generated slider to show.
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
    folder('Light', lightControls(stageValues, patchStageConfig)),
    folder(
      'Stage',
      // `lighting` and `light` are the Light folder's; `path` is the Walk's.
      schemaControls(stageSchema, stageValues, (key, value) => patchStageConfig({ [key]: value }), [
        'path',
        'lighting',
        'light',
      ]),
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

/**
 * The light panel, built by hand for one reason: every field is an OVERRIDE.
 *
 * A generated slider reads its value out of the config, and an unset
 * override has none — the whole point is that it means "whatever the preset
 * says". So the sliders show the RESOLVED rig, which is the number the
 * scene is actually using, and touching one writes that field and only that
 * field. Reset drops the overrides and hands the look back to the preset.
 *
 * Direction and height are the same two angles Blender's light panel asks
 * for rather than a position vector, because "where is the light" is a
 * question about the room and not about the coordinate system.
 */
function lightControls(
  values: Record<string, unknown>,
  patch: (patch: Record<string, unknown>) => void,
): Control[] {
  const preset = values.lighting as LightingName
  const light = (values.light ?? {}) as LightOverrides
  const rig = resolveLighting(preset, light)
  const angles = lightAngles(rig.key.position)
  const set = (key: keyof LightOverrides, value: unknown) => patch({ light: { ...light, [key]: value } })
  const range = (key: keyof LightOverrides) => numberRange(lightSchema, key)
  const touched = Object.values(light).some((v) => v !== undefined)

  return [
    select('preset', preset, [...lightingNames], (v) => patch({ lighting: v })),
    num('exposure', rig.exposure, range('exposure'), (v) => set('exposure', v)),
    num('key', rig.key.intensity, range('key'), (v) => set('key', v)),
    text('color', rig.key.color, (v) => set('color', v)),
    num('direction', angles.azimuth, { ...range('direction'), step: 1 }, (v) => set('direction', v)),
    num('height', angles.elevation, { ...range('height'), step: 1 }, (v) => set('height', v)),
    num('ambient', rig.ambient, range('ambient'), (v) => set('ambient', v)),
    num('studio', rig.studio, range('studio'), (v) => set('studio', v)),
    num('haze', light.haze ?? 1, range('haze'), (v) => set('haze', v)),
    touched
      ? button('reset to preset', () => patch({ light: {} }), 'lightReset')
      : note('lightNote', `these are ${preset}'s own numbers — move one and it becomes yours`),
  ]
}
