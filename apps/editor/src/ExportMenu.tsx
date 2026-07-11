import { useEffect, useRef, useState } from 'react'
import {
  buildAgentPayload,
  buildJsxSnippet,
  diffConfig,
  type PaperConfig,
  type PaperHandle,
} from 'paperlab'

/**
 * The tool's job ends in someone's codebase. "Copy for AI" is the flagship:
 * a self-contained brief the user pastes into their coding agent.
 */
export function ExportMenu({
  config,
  paperRef,
}: {
  config: PaperConfig
  paperRef: React.RefObject<PaperHandle | null>
}) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])

  const current = (): PaperConfig => paperRef.current?.snapshot() ?? config

  const copy = (label: string, text: string) => {
    navigator.clipboard.writeText(text)
    setCopied(label)
    setTimeout(() => {
      setCopied(null)
      setOpen(false)
    }, 900)
  }

  return (
    <div className="export-menu" ref={rootRef}>
      <button className="export" onClick={() => setOpen((v) => !v)}>
        {copied ? `${copied} copied ✓` : 'Export code'}
      </button>
      {open && !copied && (
        <div className="export-dropdown">
          <button onClick={() => copy('AI brief', buildAgentPayload(current()))}>
            <strong>Copy for AI</strong>
            <span>paste into Claude Code &amp; say where it goes</span>
          </button>
          <button onClick={() => copy('JSX', buildJsxSnippet(current()))}>
            <strong>Copy JSX</strong>
            <span>&lt;Paper /&gt; with non-default props</span>
          </button>
          <button
            onClick={() => copy('.paper JSON', JSON.stringify(diffConfig(current()), null, 2))}
          >
            <strong>Copy .paper JSON</strong>
            <span>the diffed preset file</span>
          </button>
        </div>
      )}
    </div>
  )
}
