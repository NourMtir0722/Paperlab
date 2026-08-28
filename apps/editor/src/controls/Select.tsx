import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * The app's own select.
 *
 * A native `<select>` cannot be styled below the button: the option list is
 * drawn by the operating system, in the OS's colours, at the OS's size. On a
 * dark canvas tool that one widget is the thing that reads as "internal
 * tool" — every other control here is already the app's own.
 *
 * Two things it must not lose by leaving the native control behind:
 *
 * - **Keyboard.** One rule: a navigation key *names* an option. Closed, that
 *   opens the list on it; open, it moves the highlight to it. Arrows, Home,
 *   End and typeahead all work that way, and nothing changes the value until
 *   Enter, Space or a click says so. Escape and Tab close.
 *
 *   This is the ARIA select-only combobox pattern, which is the contract the
 *   widget opted into the moment it claimed `role="combobox"` over a
 *   `role="listbox"`. It replaced a split where ArrowDown opened but ArrowUp,
 *   Home and End committed on the spot — so Home on a closed picker silently
 *   swapped the sculpt for the first preset and rebuilt the canvas, with no
 *   list ever shown and nothing asked.
 * - **Not being clipped.** Both inspector rails are `overflow-y: auto`, so a
 *   popup positioned inside one is cut off by it. The list is therefore
 *   portaled to `<body>` and positioned `fixed` off the trigger's rect —
 *   which also means it has to close on scroll and resize rather than drift
 *   away from the button it belongs to.
 */

/** Options that don't fit under the trigger flip above it instead. */
const MAX_LIST_HEIGHT = 260
const GAP = 4

export interface SelectProps {
  value: string
  options: readonly string[]
  onChange(value: string): void
  /** Accessible name — every caller has a visible label to pass. */
  label: string
  className?: string
  /** Render an option as something other than its raw value. */
  format?(option: string): string
  title?: string
}

export function Select({ value, options, onChange, label, className, format, title }: SelectProps) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(() => Math.max(0, options.indexOf(value)))
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const listId = useId()
  const show = (option: string) => format?.(option) ?? option

  // Typeahead: consecutive keystrokes build a prefix, a pause starts over.
  const typed = useRef({ prefix: '', at: 0 })

  const openList = (index = Math.max(0, options.indexOf(value))) => {
    setActive(index)
    setOpen(true)
  }

  const commit = (index: number) => {
    const option = options[index]
    setOpen(false)
    triggerRef.current?.focus()
    if (option !== undefined && option !== value) onChange(option)
  }

  // A fixed-position popup is anchored to a rect captured once. Anything that
  // moves the trigger afterwards — scrolling the rail it lives in, resizing
  // the window — would leave the list floating somewhere it no longer
  // belongs, so those close it rather than chasing it.
  //
  // Scrolling *inside* the list is the exact opposite: the trigger has not
  // moved, and the user is reading options that do not fit. This listener is
  // on capture, so it hears that scroll too — and closing on it made every
  // option past the fold unreachable with a mouse, silently, because the
  // list vanished the moment you reached for the ones you could not see.
  useEffect(() => {
    if (!open) return
    const close = (e: Event) => {
      if (e.target instanceof Node && listRef.current?.contains(e.target)) return
      setOpen(false)
    }
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  const onKeyDown = (e: React.KeyboardEvent) => {
    const index = open ? active : Math.max(0, options.indexOf(value))
    // Every key below names an option. Closed, that opens the list on it
    // rather than committing it: choosing a preset rebuilds the canvas, and
    // no keystroke should do that without the list ever being seen.
    const move = (next: number) => {
      e.preventDefault()
      const clamped = Math.min(options.length - 1, Math.max(0, next))
      if (open) setActive(clamped)
      else openList(clamped)
    }
    switch (e.key) {
      case 'ArrowDown':
        return move(index + 1)
      case 'ArrowUp':
        return move(index - 1)
      case 'Home':
        return move(0)
      case 'End':
        return move(options.length - 1)
      case 'Enter':
      case ' ':
        e.preventDefault()
        return open ? commit(active) : openList()
      case 'Escape':
        if (open) {
          e.preventDefault()
          setOpen(false)
        }
        return
      case 'Tab':
        setOpen(false)
        return
      default: {
        if (e.key.length !== 1 || e.metaKey || e.ctrlKey || e.altKey) return
        const now = Date.now()
        const prefix = (now - typed.current.at < 700 ? typed.current.prefix : '') + e.key.toLowerCase()
        typed.current = { prefix, at: now }
        const found = options.findIndex((o) => show(o).toLowerCase().startsWith(prefix))
        if (found >= 0) move(found)
      }
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={label}
        title={title}
        className={`select-trigger${open ? ' open' : ''}${className ? ` ${className}` : ''}`}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
      >
        <span className="select-value">{show(value)}</span>
        <span className="select-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <SelectList
          id={listId}
          label={label}
          anchor={triggerRef.current}
          listRef={listRef}
          options={options}
          value={value}
          active={active}
          show={show}
          onHover={setActive}
          onPick={commit}
          onDismiss={() => {
            setOpen(false)
            triggerRef.current?.focus()
          }}
          onKeyDown={onKeyDown}
        />
      )}
    </>
  )
}

interface SelectListProps {
  id: string
  label: string
  anchor: HTMLElement | null
  listRef: React.RefObject<HTMLDivElement | null>
  options: readonly string[]
  value: string
  active: number
  show(option: string): string
  onHover(index: number): void
  onPick(index: number): void
  onDismiss(): void
  onKeyDown(e: React.KeyboardEvent): void
}

function SelectList({
  id,
  label,
  anchor,
  listRef: ref,
  options,
  value,
  active,
  show,
  onHover,
  onPick,
  onDismiss,
  onKeyDown,
}: SelectListProps) {
  const [box, setBox] = useState<{ top: number; left: number; width: number; max: number } | null>(null)

  // Measure before paint: a list that renders at 0,0 and then jumps is worse
  // than the native popup it replaced.
  useLayoutEffect(() => {
    if (!anchor) return
    const rect = anchor.getBoundingClientRect()
    const below = window.innerHeight - rect.bottom - GAP * 2
    const above = rect.top - GAP * 2
    const flip = below < Math.min(MAX_LIST_HEIGHT, above)
    const max = Math.min(MAX_LIST_HEIGHT, flip ? above : below)
    setBox({
      top: flip ? rect.top - GAP - max : rect.bottom + GAP,
      left: rect.left,
      width: rect.width,
      max,
    })
  }, [anchor])

  // Focus moves into the list so the arrows keep working after the mouse
  // opened it; dismissing puts focus back on the trigger.
  //
  // It has to wait for the measurement. Until `box` lands the list is still
  // `visibility: hidden`, and a hidden element cannot take focus — so the
  // version of this that ran on mount called `focus()` into the void and left
  // the listbox unreachable to anything that follows focus.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the measurement is the trigger — the list is reached through the DOM rather than by closing over it, and `box` lands once per open.
  useEffect(() => {
    if (box) ref.current?.focus()
  }, [box])

  // Keep the active option in view for arrow-key and typeahead travel.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `active` is the whole trigger — the effect re-runs to scroll the newly-active option into view, and reads it through the DOM rather than by closing over it.
  useEffect(() => {
    ref.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  return createPortal(
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: click-outside is a pointer affordance; Escape and Tab are the keyboard paths, and focus is inside the list, so both are reachable. */}
      <div className="select-backdrop" onMouseDown={onDismiss} />
      <div
        ref={ref}
        id={id}
        role="listbox"
        aria-label={label}
        tabIndex={-1}
        className="select-list"
        style={
          box
            ? { top: box.top, left: box.left, minWidth: box.width, maxHeight: box.max }
            : { visibility: 'hidden' }
        }
        onKeyDown={onKeyDown}
      >
        {/* `mousemove`, not `mouseenter`: the list opens under wherever the
            cursor already was, and `mouseenter` fires on an option that
            appears beneath a stationary pointer. That let the mouse overrule
            the key that opened the list — press End, and the highlight landed
            on whatever happened to be under your hand instead of on the last
            option. Hover should follow the hand, and only when it moves. */}
        {options.map((option, i) => (
          <button
            key={option}
            type="button"
            role="option"
            aria-selected={option === value}
            data-active={i === active}
            className={`select-option${option === value ? ' selected' : ''}${i === active ? ' active' : ''}`}
            onMouseMove={() => onHover(i)}
            onClick={() => onPick(i)}
          >
            {show(option)}
          </button>
        ))}
      </div>
    </>,
    document.body,
  )
}
