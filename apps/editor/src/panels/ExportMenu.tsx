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
import {
  buildStageAgentPayload,
  buildStageComponentSource,
  diffStage,
  type StageExportInput,
} from 'paperlab/stage'
import type { CaptureHandle } from '../chrome/CaptureRig'
import { EXPORT_FRAMES, downloadImage, imageFilename } from '../chrome/imageExport'
import { toast } from '../controls/ui'
/**
 * Two ways out of the editor, and they are for different people.
 *
 * The tool's job ends in someone's codebase, so the code half serializes the
 * ACTIVE editor mode: a <Paper> in Paper mode, a <PaperField> (with every
 * referenced preset inlined) in Field mode, a <PaperStage> in Stage mode —
 * where the primary offer is the SCROLL-bound hero, because binding the walk
 * to the page is the thing people want and the fiddly thing to write.
 *
 * The picture half is what gets the codebase half looked at. A sheet that
 * peels or unrolls is the most persuasive argument this library has, and the
 * only way to get one out of the editor used to be a screenshot of the whole
 * application. It sits first because it is the one you reach for on the way
 * to showing someone, and the code is what you reach for once they ask.
 */
export function ExportMenu({
  mode,
  config,
  paperRef,
  captureRef,
  fieldInput,
  stageInput,
}: {
  mode: 'paper' | 'field' | 'stage'
  config: PaperConfig
  paperRef: React.RefObject<PaperHandle | null>
  captureRef: React.RefObject<CaptureHandle | null>
  fieldInput: () => FieldExportInput
  stageInput: () => StageExportInput
}) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [rendering, setRendering] = useState<string | null>(null)
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
    // Confirm in place — the menu stays open and the copied row flips to a
    // "Copied ✓" badge, rather than the whole menu collapsing out from under
    // the pointer.
    setCopied(label)
    setTimeout(() => setCopied((c) => (c === label ? null : c)), 1600)
  }

  const badge = (label: string) => (copied === label ? <span className="copied-badge">Copied ✓</span> : null)

  const saveImage = async (frame: (typeof EXPORT_FRAMES)[number]) => {
    const capture = captureRef.current
    if (!capture) return
    setRendering(frame.id)
    try {
      const dataUrl = await capture.capture(frame.width, frame.height)
      // Named for what is IN the picture. Field and Stage are compositions of
      // their own, and both were coming out named after whichever paper the
      // Paper tab happened to be holding.
      downloadImage(dataUrl, imageFilename(mode === 'paper' ? config.meta.name : mode, frame.id))
      // The menu stays open — picking a second frame is the common next move,
      // and the download itself is the confirmation.
    } catch (error) {
      // A frame past the GPU's texture limit, or a canvas the browser
      // refuses to read back. Better named than silently doing nothing.
      toast(
        `Could not render that frame: ${error instanceof Error ? error.message.slice(0, 120) : error}`,
        'error',
      )
    } finally {
      setRendering(null)
    }
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
      <button type="button" className="export" onClick={() => setOpen((v) => !v)}>
        Export
      </button>
      {open && (
        <div className="export-dropdown">
          <p className="export-group">Picture</p>
          <div className="export-frames">
            {EXPORT_FRAMES.map((frame) => (
              <button
                key={frame.id}
                type="button"
                disabled={rendering !== null}
                onClick={() => void saveImage(frame)}
              >
                <strong>{frame.label}</strong>
                <span>{rendering === frame.id ? 'rendering…' : frame.hint}</span>
              </button>
            ))}
          </div>
          <p className="export-group">Code</p>
          {mode === 'stage' ? (
            <>
              <button
                type="button"
                className="export-primary"
                onClick={() => copy('AI brief', buildStageAgentPayload({ ...stageInput(), scroll: true }))}
              >
                <strong>Copy for AI</strong>
                <span>scroll-driven stage — the page scroll walks the figure</span>
                {badge('AI brief')}
              </button>
              <div className="export-secondary">
                <button
                  type="button"
                  onClick={() =>
                    copy('scroll component', buildStageComponentSource({ ...stageInput(), scroll: true }))
                  }
                >
                  <strong>Copy scroll component</strong>
                  <span>pinned section, walk bound to scroll</span>
                  {badge('scroll component')}
                </button>
                <button
                  type="button"
                  onClick={() => copy('component', buildStageComponentSource(stageInput()))}
                >
                  <strong>Copy component</strong>
                  <span>&lt;PaperStage /&gt;, walking on its own clock</span>
                  {badge('component')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const input = stageInput()
                    copy(
                      '.stage JSON',
                      JSON.stringify(
                        {
                          ...diffStage(input.stage),
                          layout: input.layout,
                          ...(input.text ? { text: input.text } : {}),
                          ...(input.count !== undefined ? { count: input.count } : {}),
                        },
                        null,
                        2,
                      ),
                    )
                  }}
                >
                  <strong>Copy .stage JSON</strong>
                  <span>the diffed stage config</span>
                  {badge('.stage JSON')}
                </button>
              </div>
            </>
          ) : mode === 'paper' ? (
            <>
              <button
                type="button"
                className="export-primary"
                onClick={() => copy('AI brief', buildAgentPayload(currentPaper()))}
              >
                <strong>Copy for AI</strong>
                <span>paste into Claude Code &amp; say where it goes</span>
                {badge('AI brief')}
              </button>
              <div className="export-secondary">
                <button type="button" onClick={() => copy('JSX', buildJsxSnippet(currentPaper()))}>
                  <strong>Copy JSX</strong>
                  <span>&lt;Paper /&gt; with non-default props</span>
                  {badge('JSX')}
                </button>
                <button
                  type="button"
                  onClick={() => copy('.paper JSON', JSON.stringify(diffConfig(currentPaper()), null, 2))}
                >
                  <strong>Copy .paper JSON</strong>
                  <span>the diffed preset file</span>
                  {badge('.paper JSON')}
                </button>
              </div>
            </>
          ) : (
            <>
              <button
                type="button"
                className="export-primary"
                onClick={() => copy('AI brief', buildFieldAgentPayload(fieldInput()))}
              >
                <strong>Copy for AI</strong>
                <span>gallery brief — all presets inlined</span>
                {badge('AI brief')}
              </button>
              <div className="export-secondary">
                <button type="button" onClick={() => copy('JSX', buildFieldComponentSource(fieldInput()))}>
                  <strong>Copy component</strong>
                  <span>&lt;PaperField /&gt; with inlined preset consts</span>
                  {badge('JSX')}
                </button>
                <button type="button" onClick={() => copy('.field JSON', fieldJson())}>
                  <strong>Copy .field JSON</strong>
                  <span>layout + motion + diffed papers</span>
                  {badge('.field JSON')}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
