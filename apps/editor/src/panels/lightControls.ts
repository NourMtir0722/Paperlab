import {
  lightAngles,
  lightSchema,
  lightingNames,
  resolveLighting,
  type LightOverrides,
  type LightingName,
} from 'paperlab'
import { button, color, note, num, numberRange, select, type Control } from '../controls/controlModel'

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
export function lightControls(
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
    color('color', rig.key.color, (v) => set('color', v)),
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
