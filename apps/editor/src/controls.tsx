import { useCallback, useEffect, useRef, useState } from 'react'
import type { Control } from './controlModel'

/**
 * The native control set. Renders the neutral `Control` tree from
 * `controlModel.ts` in the app's own chrome — no control library, no second
 * store, no theme to fight.
 *
 * Everything here is controlled: a control draws the value it is handed and
 * calls back only on real user input. That is what retires leva's
 * `ctx.initial` guard — there is no initial-mount callback to suppress,
 * because rendering never fires a change.
 */
export function Panel({ controls }: { controls: Control[] }) {
  return (
    <div className="panel">
      {controls.map((control) => (
        <ControlRow key={control.key} control={control} />
      ))}
    </div>
  )
}

function ControlRow({ control }: { control: Control }) {
  switch (control.kind) {
    case 'folder':
      return <Folder control={control} />
    case 'number':
      return <NumberControl control={control} />
    case 'select':
      return <SelectControl control={control} />
    case 'toggle':
      return <ToggleControl control={control} />
    case 'text':
      return <TextControl control={control} />
    case 'note':
      return (
        <p className="control-note">
          <span aria-hidden="true">ⓘ</span> {control.value}
        </p>
      )
    case 'button':
      return (
        <div className="control-row control-row-button">
          <button type="button" className="control-button" onClick={control.onClick}>
            {control.label}
          </button>
        </div>
      )
  }
}

type Of<K extends Control['kind']> = Extract<Control, { kind: K }>

function Folder({ control }: { control: Of<'folder'> }) {
  const [open, setOpen] = useState(!control.collapsed)
  return (
    <section className={`control-folder${open ? ' open' : ''}`}>
      <button
        type="button"
        className="control-folder-head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="control-folder-caret" aria-hidden="true">
          ▸
        </span>
        {control.label}
      </button>
      {open && (
        <div className="control-folder-body">
          {control.children.map((child) => (
            <ControlRow key={child.key} control={child} />
          ))}
        </div>
      )}
    </section>
  )
}

/** Decimals to show — a 0..1 range needs more than a 0..80 one. */
function precisionFor(step: number): number {
  if (step >= 1) return 0
  if (step >= 0.1) return 1
  if (step >= 0.01) return 2
  return 3
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))
const snap = (v: number, step: number) => Math.round(v / step) * step

/**
 * Label-drag to scrub, slider to sweep, click the readout to type an exact
 * value. The drag is the one leva interaction worth reproducing faithfully:
 * it's how you nudge a value while watching the canvas, without the pointer
 * ever leaving the row.
 */
function NumberControl({ control }: { control: Of<'number'> }) {
  const { value, min, max, step, disabled, onChange } = control
  const precision = precisionFor(step)
  const [editing, setEditing] = useState<string | null>(null)
  const drag = useRef<{ x: number; from: number } | null>(null)
  // The handler runs on window during a drag; keep it reading fresh props.
  const latest = useRef(control)
  latest.current = control

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (latest.current.disabled) return
    e.preventDefault()
    drag.current = { x: e.clientX, from: latest.current.value }
  }, [])

  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (!drag.current) return
      const c = latest.current
      // Full sweep across ~300px, finer with shift held.
      const span = (c.max - c.min) / (e.shiftKey ? 1200 : 300)
      const next = clamp(snap(drag.current.from + (e.clientX - drag.current.x) * span, c.step), c.min, c.max)
      if (next !== c.value) c.onChange(next)
    }
    const up = () => {
      drag.current = null
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [])

  const commit = (raw: string) => {
    const parsed = Number.parseFloat(raw)
    if (Number.isFinite(parsed)) onChange(clamp(parsed, min, max))
    setEditing(null)
  }

  return (
    <div className={`control-row${disabled ? ' disabled' : ''}`}>
      {/* The slider below is the accessible control; this label is a pointer-only affordance. */}
      <span className="control-label scrub" onPointerDown={onPointerDown}>
        {control.label}
      </span>
      <input
        type="range"
        className="control-slider"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-label={control.label}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {editing === null ? (
        <button
          type="button"
          className="control-value"
          disabled={disabled}
          onClick={() => setEditing(value.toFixed(precision))}
          title="Click to type a value"
        >
          {value.toFixed(precision)}
        </button>
      ) : (
        <input
          type="text"
          className="control-value editing"
          value={editing}
          // Focus on open — the row was just clicked to type into.
          ref={(el) => el?.focus()}
          aria-label={`${control.label} value`}
          onChange={(e) => setEditing(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit((e.target as HTMLInputElement).value)
            if (e.key === 'Escape') setEditing(null)
          }}
        />
      )}
    </div>
  )
}

function SelectControl({ control }: { control: Of<'select'> }) {
  return (
    <div className="control-row">
      <span className="control-label">{control.label}</span>
      <select
        className="control-select"
        value={control.value}
        aria-label={control.label}
        onChange={(e) => control.onChange(e.target.value)}
      >
        {control.options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  )
}

function ToggleControl({ control }: { control: Of<'toggle'> }) {
  return (
    <div className="control-row">
      <span className="control-label">{control.label}</span>
      <label className="control-toggle">
        <input
          type="checkbox"
          checked={control.value}
          aria-label={control.label}
          onChange={(e) => control.onChange(e.target.checked)}
        />
        <span className="control-toggle-track" aria-hidden="true" />
      </label>
    </div>
  )
}

/**
 * Text commits on blur / Enter rather than per keystroke: the canvas rebuilds
 * its content texture on every change, and doing that per character while
 * someone types a paragraph into a banner is what makes the app feel slow.
 */
function TextControl({ control }: { control: Of<'text'> }) {
  const [draft, setDraft] = useState(control.value)
  const committed = useRef(control.value)
  // Adopt external edits (preset switch, handle drag) without clobbering typing.
  if (committed.current !== control.value) {
    committed.current = control.value
    if (draft !== control.value) setDraft(control.value)
  }

  const commit = () => {
    if (draft !== control.value) {
      committed.current = draft
      control.onChange(draft)
    }
  }

  return (
    <div className={`control-row${control.rows && control.rows > 1 ? ' stacked' : ''}`}>
      <span className="control-label">{control.label}</span>
      {control.rows && control.rows > 1 ? (
        <textarea
          className="control-text"
          rows={control.rows}
          value={draft}
          aria-label={control.label}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
        />
      ) : (
        <input
          type="text"
          className="control-text"
          value={draft}
          title={control.hint}
          aria-label={control.label}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
        />
      )}
    </div>
  )
}
