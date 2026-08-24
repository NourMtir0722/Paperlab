import { useCallback, useEffect, useRef, useState } from 'react'
import type { Control } from './controlModel'
import { Select } from './Select'

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
    case 'color':
      return <ColorControl control={control} />
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

/** A behavior's nominated params get the loud row; everything else the quiet one. */
const emphasisClass = (emphasis?: 'signature') => (emphasis ? ` ${emphasis}` : '')

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

  // The track is filled up to the value with a hard-stop gradient, because
  // `accent-color` paints a browser's slider, not this one's — and a bar that
  // reads as full-to-here is most of what makes a slider legible at a glance.
  const fill = max > min ? ((value - min) / (max - min)) * 100 : 0

  return (
    <div className={`control-row${disabled ? ' disabled' : ''}${emphasisClass(control.emphasis)}`}>
      {/* The slider below is the accessible control; this label is a pointer-only affordance. */}
      <span className="control-label scrub" onPointerDown={onPointerDown}>
        {control.label}
      </span>
      <input
        type="range"
        className="control-slider"
        style={{ '--fill': `${fill}%` } as React.CSSProperties}
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
    <div className={`control-row${emphasisClass(control.emphasis)}`}>
      <span className="control-label">{control.label}</span>
      <Select
        className="control-select"
        label={control.label}
        value={control.value}
        options={control.options}
        onChange={control.onChange}
      />
    </div>
  )
}

function ToggleControl({ control }: { control: Of<'toggle'> }) {
  return (
    <div className={`control-row${emphasisClass(control.emphasis)}`}>
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

/** `#rgb` and `#rrggbb`, the two a swatch can show. */
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i

/** What the swatch shows for a value it cannot parse. */
const expand = (value: string): string => {
  const v = value.trim()
  if (!HEX.test(v)) return '#000000'
  return v.length === 4 ? `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}` : v
}

/**
 * A real colour picker, and the hex beside it.
 *
 * Both, rather than either. The swatch is how you find a colour you have not
 * decided on yet; the field is how you paste the one from your brand
 * palette, and how you read back what the swatch gave you.
 *
 * **The swatch is throttled.** A native picker fires while you drag it, and
 * on a content colour every one of those events repaints the sheet's texture
 * — the same cost that made text commit on blur rather than per keystroke.
 * Dropping the events would make the picker feel dead, so they are spent at
 * a rate a canvas can keep up with, and the value you release on is always
 * committed whether or not it lands on a tick.
 */
function ColorControl({ control }: { control: Of<'color'> }) {
  const { value, onChange } = control
  const [draft, setDraft] = useState(value)
  const committed = useRef(value)
  const throttle = useRef<{ at: number; pending: string | null; timer: number | null }>({
    at: 0,
    pending: null,
    timer: null,
  })

  if (committed.current !== value) {
    committed.current = value
    if (draft !== value) setDraft(value)
  }

  // Cleared on unmount so a trailing commit cannot fire into a dead control.
  useEffect(() => {
    const state = throttle.current
    return () => {
      if (state.timer !== null) window.clearTimeout(state.timer)
    }
  }, [])

  const RATE = 120

  const live = (next: string) => {
    setDraft(next)
    const state = throttle.current
    const now = performance.now()
    if (now - state.at >= RATE) {
      state.at = now
      committed.current = next
      onChange(next)
      return
    }
    // Not this tick — but never dropped: the last value seen wins at the end.
    state.pending = next
    if (state.timer === null) {
      state.timer = window.setTimeout(
        () => {
          state.timer = null
          state.at = performance.now()
          if (state.pending !== null) {
            committed.current = state.pending
            onChange(state.pending)
            state.pending = null
          }
        },
        RATE - (now - state.at),
      )
    }
  }

  const commitText = () => {
    if (draft !== value) {
      committed.current = draft
      onChange(draft)
    }
  }

  return (
    <div className="control-row">
      <span className="control-label">{control.label}</span>
      <div className="control-color">
        <input
          type="color"
          value={expand(draft)}
          aria-label={`${control.label} swatch`}
          onChange={(e) => live(e.target.value)}
        />
        <input
          type="text"
          className="control-text"
          value={draft}
          aria-label={control.label}
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitText}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            if (e.key === 'Escape') setDraft(value)
          }}
        />
      </div>
    </div>
  )
}

/**
 * Text commits on blur / Enter rather than per keystroke: the canvas rebuilds
 * its content texture on every change, and doing that per character while
 * someone types a paragraph into a banner is what makes the app feel slow.
 *
 * That model is right and stays. What was missing was any way to SEE it, and
 * on the textarea any way to trigger it — Enter is a newline there, so the
 * only commit was clicking somewhere else in the panel and hoping. Content
 * text is a textarea (`rows: 4`), which made the app's most-used field the
 * one with no commit at all.
 *
 * So an uncommitted draft now says so twice: the label brightens a step, and
 * the textarea grows an Apply button. Both appear only while dirty — a
 * button that is always there, and does nothing most of the time, teaches
 * nobody when it matters. The one-line input keeps Enter and takes only the
 * brightened label: the row is `label | input | 44px` with nowhere to put a
 * button, and Enter is already the answer there.
 */
function TextControl({ control }: { control: Of<'text'> }) {
  const [draft, setDraft] = useState(control.value)
  const committed = useRef(control.value)
  // Adopt external edits (preset switch, handle drag) without clobbering typing.
  if (committed.current !== control.value) {
    committed.current = control.value
    if (draft !== control.value) setDraft(control.value)
  }

  const dirty = draft !== control.value

  const commit = () => {
    if (draft !== control.value) {
      committed.current = draft
      control.onChange(draft)
    }
  }

  const multiline = Boolean(control.rows && control.rows > 1)

  return (
    <div className={`control-row${multiline ? ' stacked' : ''}${dirty ? ' dirty' : ''}`}>
      <span className="control-label">{control.label}</span>
      {multiline ? (
        <>
          <textarea
            className="control-text"
            rows={control.rows}
            value={draft}
            title={control.hint}
            aria-label={control.label}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              // Enter is a newline in a textarea, so the commit key is the
              // one every other multi-line editor uses for "send".
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                commit()
              }
              // Abandon the draft and go back to what is on the sheet.
              if (e.key === 'Escape') setDraft(control.value)
            }}
          />
          {dirty && (
            <button
              type="button"
              className="control-apply"
              // On mousedown, not click: clicking blurs the textarea first,
              // which commits, which un-dirties, which unmounts this button
              // before its own click ever lands. preventDefault keeps the
              // caret where it was — applying is not leaving.
              onMouseDown={(e) => {
                e.preventDefault()
                commit()
              }}
              onClick={commit}
            >
              Apply <kbd>⌘↵</kbd>
            </button>
          )}
        </>
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
            if (e.key === 'Escape') setDraft(control.value)
          }}
        />
      )}
    </div>
  )
}
