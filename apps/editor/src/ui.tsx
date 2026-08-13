import { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'

/**
 * In-app dialogs and toasts — the replacement for the browser's native
 * prompt / alert / confirm, which block the thread and break the dark-canvas
 * chrome. Imperative helpers (promptDialog / confirmDialog / toast) resolve a
 * promise so callers read the same as the natives they replace:
 *
 *   const name = await promptDialog({ title: 'Save preset as' })
 *   if (!name) return
 *
 * Mount <UIHost/> once, near the app root.
 */

interface PromptSpec {
  kind: 'prompt'
  title: string
  message?: string
  defaultValue?: string
  placeholder?: string
  confirmLabel?: string
  /** Inline validation: return an error string to block submit, or null. */
  validate?: (value: string) => string | null
  resolve: (value: string | null) => void
}

interface ConfirmSpec {
  kind: 'confirm'
  title: string
  message?: string
  confirmLabel?: string
  danger?: boolean
  resolve: (ok: boolean) => void
}

type DialogSpec = PromptSpec | ConfirmSpec

export type ToastTone = 'info' | 'error' | 'success'
interface Toast {
  id: number
  message: string
  tone: ToastTone
}

interface UIStore {
  dialog: DialogSpec | null
  toasts: Toast[]
  open(spec: DialogSpec): void
  close(): void
  push(message: string, tone: ToastTone): void
  dismiss(id: number): void
}

const useUI = create<UIStore>((set) => ({
  dialog: null,
  toasts: [],
  open: (dialog) => set({ dialog }),
  close: () => set({ dialog: null }),
  push: (message, tone) =>
    set((s) => ({ toasts: [...s.toasts, { id: Date.now() + Math.random(), message, tone }] })),
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

/** Ask for a string. Resolves to the trimmed value, or null if cancelled. */
export function promptDialog(opts: Omit<PromptSpec, 'kind' | 'resolve'>): Promise<string | null> {
  return new Promise((resolve) => useUI.getState().open({ kind: 'prompt', ...opts, resolve }))
}

/** Ask yes/no. Resolves true on confirm, false on cancel. */
export function confirmDialog(opts: Omit<ConfirmSpec, 'kind' | 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => useUI.getState().open({ kind: 'confirm', ...opts, resolve }))
}

/** Fire a transient toast. Errors persist a beat longer than the rest. */
export function toast(message: string, tone: ToastTone = 'info'): void {
  useUI.getState().push(message, tone)
}

export function UIHost() {
  const dialog = useUI((s) => s.dialog)
  const toasts = useUI((s) => s.toasts)
  const dismiss = useUI((s) => s.dismiss)
  return (
    <>
      {dialog && <DialogView spec={dialog} />}
      <div className="toaster" role="status" aria-live="polite">
        {toasts.map((t) => (
          <ToastView key={t.id} toast={t} onDone={() => dismiss(t.id)} />
        ))}
      </div>
    </>
  )
}

function DialogView({ spec }: { spec: DialogSpec }) {
  const close = useUI((s) => s.close)
  const inputRef = useRef<HTMLInputElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const [value, setValue] = useState(spec.kind === 'prompt' ? (spec.defaultValue ?? '') : '')
  const [error, setError] = useState<string | null>(null)

  // Autofocus the field (prompt) or the confirm button, and pre-select text so
  // the common "rename over the old name" gesture is one keystroke.
  useEffect(() => {
    if (spec.kind === 'prompt') inputRef.current?.select()
    else confirmRef.current?.focus()
  }, [spec])

  const cancel = () => {
    close()
    if (spec.kind === 'prompt') spec.resolve(null)
    else spec.resolve(false)
  }

  const submit = () => {
    if (spec.kind === 'prompt') {
      const trimmed = value.trim()
      const err = spec.validate?.(trimmed) ?? null
      if (err) {
        setError(err)
        return
      }
      close()
      spec.resolve(trimmed || null)
    } else {
      close()
      spec.resolve(true)
    }
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: click-outside is a pointer affordance; Escape and Cancel are the keyboard paths, and the effect above puts focus inside the dialog so both are reachable.
    <div className="dialog-backdrop" onMouseDown={cancel}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={spec.title}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') cancel()
          if (e.key === 'Enter' && spec.kind !== 'prompt') submit()
        }}
      >
        <h3 className="dialog-title">{spec.title}</h3>
        {spec.message && <p className="dialog-message">{spec.message}</p>}
        {spec.kind === 'prompt' && (
          <>
            <input
              ref={inputRef}
              className={error ? 'dialog-input invalid' : 'dialog-input'}
              value={value}
              placeholder={spec.placeholder}
              onChange={(e) => {
                setValue(e.target.value)
                if (error) setError(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit()
              }}
            />
            {error && <p className="dialog-error">{error}</p>}
          </>
        )}
        <div className="dialog-actions">
          <button type="button" className="dialog-btn" onClick={cancel}>
            Cancel
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={`dialog-btn primary${spec.kind === 'confirm' && spec.danger ? ' danger' : ''}`}
            onClick={submit}
          >
            {spec.confirmLabel ?? (spec.kind === 'confirm' ? 'OK' : 'Save')}
          </button>
        </div>
      </div>
    </div>
  )
}

function ToastView({ toast, onDone }: { toast: Toast; onDone: () => void }) {
  useEffect(() => {
    const ttl = toast.tone === 'error' ? 5000 : 2800
    const timer = setTimeout(onDone, ttl)
    return () => clearTimeout(timer)
  }, [toast, onDone])
  return (
    <button type="button" className={`toast ${toast.tone}`} onClick={onDone}>
      {toast.message}
    </button>
  )
}
