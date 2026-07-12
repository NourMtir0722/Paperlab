import { z } from 'zod'
import {
  coreStateNames,
  getBehavior,
  getPreset,
  resolveStateConfig,
  type PaperConfig,
  type StateDef,
} from 'paperlab'
import { useEditor } from './store'

/**
 * The states chip bar (Figma interactive-components model): Rest · Hover ·
 * Pressed · Picked · Placed. Chips with recorded overrides get a dot; an
 * active chip enters state-editing mode (inspector edits record as that
 * state's diff); the play toggle makes the canvas live so triggers fire.
 */

const EASES = ['power1.out', 'power2.out', 'power3.out', 'power2.inOut', 'back.out(1.4)', 'none']

const label = (name: string) =>
  name.startsWith('custom:') ? name.slice(7) : name.charAt(0).toUpperCase() + name.slice(1)

/** Leaf paths of a recorded override object — 'behavior.progress', … */
function overridePaths(value: unknown, prefix = '', out: string[] = []): string[] {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0 && prefix) out.push(prefix)
    for (const [key, v] of entries) overridePaths(v, prefix ? `${prefix}.${key}` : key, out)
    return out
  }
  if (prefix) out.push(prefix)
  return out
}

export function StatesBar() {
  const mode = useEditor((s) => s.mode)
  return mode === 'paper' ? <PaperStatesBar /> : <FieldStatesBar />
}

function PaperStatesBar() {
  const config = useEditor((s) => s.config)
  const editingState = useEditor((s) => s.editingState)
  const statePreview = useEditor((s) => s.statePreview)
  const setEditingState = useEditor((s) => s.setEditingState)
  const setStatePreview = useEditor((s) => s.setStatePreview)
  const setStateTransition = useEditor((s) => s.setStateTransition)
  const clearStateOverride = useEditor((s) => s.clearStateOverride)
  const resetStateOverrides = useEditor((s) => s.resetStateOverrides)

  const states = config.states?.states ?? {}
  const names = [
    ...coreStateNames,
    ...Object.keys(states).filter((n) => n.startsWith('custom:')),
  ]
  const active = editingState
  const activeDef: StateDef | undefined = active ? states[active] : undefined
  const paths = activeDef ? overridePaths(activeDef.overrides) : []

  return (
    <div className="states-bar">
      <div className="states-chips">
        {names.map((name) => {
          const recorded = overridePaths(states[name]?.overrides ?? {}).length > 0
          const isActive = name === 'rest' ? active === null && !statePreview : active === name
          return (
            <button
              key={name}
              className={`state-chip${isActive ? ' active' : ''}`}
              onClick={() => setEditingState(name === 'rest' ? null : name)}
              title={
                name === 'rest'
                  ? 'The base — every other state is a diff on it'
                  : `Edit the ${label(name)} state (edits record as overrides)`
              }
            >
              {label(name)}
              {recorded && <span className="state-dot" />}
            </button>
          )
        })}
        <button
          className={`state-preview${statePreview ? ' active' : ''}`}
          onClick={() => setStatePreview(!statePreview)}
          title="Preview: hover/press the paper to feel the choreography"
        >
          {statePreview ? '■' : '▶'}
        </button>
      </div>
      {active && (
        <div className="state-detail">
          <span className="state-detail-label">into {label(active)}:</span>
          <input
            type="number"
            min={0}
            max={5}
            step={0.05}
            value={activeDef?.transition.duration ?? 0.35}
            onChange={(e) => setStateTransition(active, { duration: Number(e.target.value) })}
          />
          s
          <select
            value={activeDef?.transition.ease ?? 'power2.out'}
            onChange={(e) => setStateTransition(active, { ease: e.target.value })}
          >
            {EASES.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
          {paths.length > 0 && (
            <span className="state-overrides">
              {paths.map((p) => (
                <button
                  key={p}
                  className="state-override"
                  title={`Reset ${p} to base`}
                  onClick={() => clearStateOverride(active, p)}
                >
                  {p} ✕
                </button>
              ))}
              <button
                className="state-reset"
                onClick={() => resetStateOverrides(active)}
                title="Reset this state to base"
              >
                reset all
              </button>
            </span>
          )}
          {paths.length === 0 && <span className="state-hint">edits record as overrides…</span>}
        </div>
      )}
    </div>
  )
}

/**
 * Field mode: the chip bar appears when a slot is selected. Edits write to
 * the SLOT's override layer by default (component/instance model); "edit on
 * preset instead" jumps into the preset with the same chip active.
 */
function FieldStatesBar() {
  const field = useEditor((s) => s.field)
  const selectedSlot = useEditor((s) => s.selectedSlot)
  const editingState = useEditor((s) => s.editingState)
  const setEditingState = useEditor((s) => s.setEditingState)
  const patchSlotState = useEditor((s) => s.patchSlotState)
  const clearSlotState = useEditor((s) => s.clearSlotState)
  const editFieldPaper = useEditor((s) => s.editFieldPaper)
  const presetName = useEditor((s) => s.presetName)
  const config = useEditor((s) => s.config)

  if (selectedSlot === null) return null
  const slotPresetName = field.slots[selectedSlot]
  if (!slotPresetName) return null
  // The field renders the LIVE edit of the open preset (components).
  const preset: PaperConfig =
    slotPresetName === presetName ? config : getPreset(slotPresetName)
  const slotStates = field.slotStates[selectedSlot]
  const active = editingState

  const presetStates = preset.states?.states ?? {}
  const names = [...coreStateNames]

  return (
    <div className="states-bar">
      <div className="states-chips">
        <span className="states-slot-label">slot {selectedSlot + 1}</span>
        {names.map((name) => {
          const slotRecorded = overridePaths(slotStates?.states?.[name]?.overrides ?? {}).length > 0
          const presetRecorded = overridePaths(presetStates[name]?.overrides ?? {}).length > 0
          return (
            <button
              key={name}
              className={`state-chip${active === name ? ' active' : ''}`}
              onClick={() => setEditingState(active === name ? null : name)}
            >
              {label(name)}
              {(slotRecorded || presetRecorded) && (
                <span className={`state-dot${slotRecorded ? ' slot' : ''}`} />
              )}
            </button>
          )
        })}
      </div>
      {active && (
        <div className="state-detail">
          <SlotStateControls
            key={`${selectedSlot}:${active}`}
            slot={selectedSlot}
            state={active}
            preset={preset}
            onPatch={(overrides) => patchSlotState(selectedSlot, active, overrides)}
          />
          <button className="state-reset" onClick={() => clearSlotState(selectedSlot, active)}>
            reset slot
          </button>
          <button
            className="state-reset"
            title="Edits will apply to every slot using this preset"
            onClick={() => {
              editFieldPaper(slotPresetName)
              setEditingState(active)
            }}
          >
            edit on preset instead →
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * Slot-layer override sliders, generated from the preset behavior's zod
 * schema (numeric params only — the human-named 3–5). Values show the
 * effective view: slot override → preset state override → base.
 */
function SlotStateControls({
  slot,
  state,
  preset,
  onPatch,
}: {
  slot: number
  state: string
  preset: PaperConfig
  onPatch: (overrides: Record<string, unknown>) => void
}) {
  const field = useEditor((s) => s.field)
  if (!preset.behavior) return <span className="state-hint">no behavior on this preset</span>
  const behavior = getBehavior(preset.behavior.type)
  const schema = behavior.optionsSchema
  if (!(schema instanceof z.ZodObject)) return null

  const stateView = resolveStateConfig(preset, state)
  const slotOverrides =
    (field.slotStates[slot]?.states?.[state]?.overrides as { behavior?: Record<string, unknown> })
      ?.behavior ?? {}

  const controls: React.ReactNode[] = []
  for (const [key, fieldSchema] of Object.entries(
    schema.shape as Record<string, z.ZodTypeAny>,
  )) {
    let inner = fieldSchema
    while (inner instanceof z.ZodDefault || inner instanceof z.ZodOptional) {
      inner = inner instanceof z.ZodDefault ? inner._def.innerType : inner.unwrap()
    }
    if (!(inner instanceof z.ZodNumber)) continue
    const min = inner._def.checks.find((c) => c.kind === 'min')
    const max = inner._def.checks.find((c) => c.kind === 'max')
    const lo = min && 'value' in min ? min.value : 0
    const hi = max && 'value' in max ? max.value : 1
    const value =
      (slotOverrides[key] as number | undefined) ??
      ((stateView.behavior as Record<string, unknown>)[key] as number)
    controls.push(
      <label key={key} className="slot-state-control">
        {key}
        <input
          type="range"
          min={lo}
          max={hi}
          step={(hi - lo) / 200}
          defaultValue={value}
          onChange={(e) => onPatch({ behavior: { [key]: Number(e.target.value) } })}
        />
      </label>,
    )
  }
  return <>{controls}</>
}
