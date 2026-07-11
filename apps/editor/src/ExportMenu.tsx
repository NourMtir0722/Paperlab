import { useEffect, useRef, useState } from 'react'
import {
  buildAgentPayload,
  buildFieldAgentPayload,
  buildFieldComponentSource,
  buildJsxSnippet,
  diffConfig,
  diffFieldProps,
  type FieldExportInput,
  type PaperConfig,
  type PaperHandle,
} from 'paperlab'

/**
 * The tool's job ends in someone's codebase. Export serializes the ACTIVE
 * editor mode: a <Paper> in Paper mode, a <PaperField> (with every
 * referenced preset inlined) in Field mode.
 */
export function ExportMenu({
  mode,
  config,
  paperRef,
  fieldInput,
}: {
  mode: 'paper' | 'field'
  config: PaperConfig
  paperRef: React.RefObject<PaperHandle | null>
  fieldInput: () => FieldExportInput
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

  const currentPaper = (): PaperConfig => paperRef.current?.snapshot() ?? config

  const copy = (label: string, text: string) => {
    navigator.clipboard.writeText(text)
    setCopied(label)
    setTimeout(() => {
      setCopied(null)
      setOpen(false)
    }, 900)
  }

  const fieldJson = () => {
    const input = fieldInput()
    return JSON.stringify(
      {
        ...diffFieldProps(input),
        papers: input.papers.map((p) => ({
          preset: diffConfig(p.preset),
          ...(p.content ? { content: p.content } : {}),
        })),
      },
      null,
      2,
    )
  }

  return (
    <div className="export-menu" ref={rootRef}>
      <button className="export" onClick={() => setOpen((v) => !v)}>
        {copied ? `${copied} copied ✓` : 'Export code'}
      </button>
      {open && !copied && (
        <div className="export-dropdown">
          {mode === 'paper' ? (
            <>
              <button onClick={() => copy('AI brief', buildAgentPayload(currentPaper()))}>
                <strong>Copy for AI</strong>
                <span>paste into Claude Code &amp; say where it goes</span>
              </button>
              <button onClick={() => copy('JSX', buildJsxSnippet(currentPaper()))}>
                <strong>Copy JSX</strong>
                <span>&lt;Paper /&gt; with non-default props</span>
              </button>
              <button
                onClick={() => copy('.paper JSON', JSON.stringify(diffConfig(currentPaper()), null, 2))}
              >
                <strong>Copy .paper JSON</strong>
                <span>the diffed preset file</span>
              </button>
            </>
          ) : (
            <>
              <button onClick={() => copy('AI brief', buildFieldAgentPayload(fieldInput()))}>
                <strong>Copy for AI</strong>
                <span>gallery brief — all presets inlined</span>
              </button>
              <button onClick={() => copy('JSX', buildFieldComponentSource(fieldInput()))}>
                <strong>Copy component</strong>
                <span>&lt;PaperField /&gt; with inlined preset consts</span>
              </button>
              <button onClick={() => copy('.field JSON', fieldJson())}>
                <strong>Copy .field JSON</strong>
                <span>layout + motion + diffed papers</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
