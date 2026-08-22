/**
 * Who owns a keystroke.
 *
 * The editor binds two window-level shortcuts — Space for the transport and
 * ⌘Z / ⇧⌘Z for undo — and both have to stand down when the key belongs to
 * whatever has focus. Text fields are the obvious case. The app's own
 * `<Select>` is the non-obvious one: it is a `<button>`, not a `<select>`,
 * so a tagName test waves it straight through and Space both opens the
 * option list and plays the paper. That is the cost of replacing a native
 * control, and this is where it gets paid, once, for every shortcut.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el?.tagName) return false
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true
  if (el.isContentEditable) return true
  // The app's own widgets that consume typing keys, by the role they claim.
  return Boolean(el.closest?.('[role="combobox"], [role="listbox"]'))
}
