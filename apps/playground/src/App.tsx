import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PaperStage, buildStageAgentPayload, getStagePreset, listStagePresets } from 'paperlab'
import { readStageShare, stageShareUrl, type StageShare } from './share'

/**
 * The playground: one screen, one input, one scene.
 *
 * Not the editor. The editor is a tool for someone who already wants to
 * build a stage; this is for someone who has never heard of one, and it has
 * about five seconds to show them why they should care. So there are no
 * panels, no sliders, and nothing to configure before something happens —
 * you type, and the room is made out of what you typed.
 *
 * There is no backend. A scene IS its link, so sharing is copying a string
 * and loading is reading the query.
 */

const DEFAULT_PRESET = 'nave'
/** How long the figure takes to walk the whole stage, seconds. */
const WALK_SECONDS = 42

function shareFrom(preset: string, text: string): StageShare {
  const base = getStagePreset(preset)
  const share: StageShare = { preset }
  if (text !== base.text) share.text = text
  return share
}

/**
 * The walking figure's model, served from this app's own `public/`.
 *
 * Built off BASE_URL rather than hardcoded, because the editor deploys under
 * `/editor/` and the docs under `/docs/` — an absolute `/figure/...` would
 * resolve to the site root and 404 for two apps out of three.
 *
 * It lives here rather than in a stage preset because the library ships no
 * assets: a preset naming a URL would be a promise the npm package cannot
 * keep. The app hosts the file, the app points at it.
 */
const FIGURE_MODEL = `${import.meta.env.BASE_URL}figure/walking-figure.glb`

export function App() {
  const initial = useMemo(() => readStageShare(window.location.search), [])
  const [preset, setPreset] = useState(initial?.preset ?? DEFAULT_PRESET)
  const [text, setText] = useState(
    initial?.text ?? getStagePreset(initial?.preset ?? DEFAULT_PRESET).text ?? '',
  )
  const [progress, setProgress] = useState(0)
  const [walking, setWalking] = useState(true)
  const [copied, setCopied] = useState<string | null>(null)

  const stage = getStagePreset(preset)

  // The walk runs on a clock the page owns rather than the scene's, so the
  // scrubber stays live and the loop can restart at the far end — an open
  // walk otherwise arrives and stands there.
  const frame = useRef(0)
  useEffect(() => {
    if (!walking) return
    let last = performance.now()
    const tick = (now: number) => {
      const delta = (now - last) / 1000
      last = now
      setProgress((p) => (p + delta / WALK_SECONDS) % 1)
      frame.current = requestAnimationFrame(tick)
    }
    frame.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame.current)
  }, [walking])

  // The address bar is the save file. Replace rather than push, so the back
  // button still leaves the page instead of walking edit history.
  useEffect(() => {
    const url = stageShareUrl(window.location.href, shareFrom(preset, text))
    window.history.replaceState(null, '', url)
  }, [preset, text])

  const flash = useCallback((label: string, value: string) => {
    void navigator.clipboard.writeText(value)
    setCopied(label)
    setTimeout(() => setCopied((c) => (c === label ? null : c)), 1800)
  }, [])

  const choose = (id: string) => {
    const next = getStagePreset(id)
    setPreset(id)
    // Words the visitor wrote are theirs; only replace the preset's own copy.
    setText((current) => (current === stage.text || !current.trim() ? (next.text ?? '') : current))
    setProgress(0)
  }

  return (
    <div className="app">
      <div className="stage">
        <PaperStage
          key={preset}
          stage={{ ...stage.stage, figure: { ...stage.stage.figure, model: FIGURE_MODEL } }}
          layout={stage.layout}
          layoutOptions={stage.layoutOptions}
          preset={stage.paper}
          text={text.trim() ? text : undefined}
          count={stage.count}
          progress={progress}
        />
      </div>

      <header className="chrome top">
        <div className="wordmark">Paperlab</div>
        <div className="actions">
          <button
            type="button"
            onClick={() => flash('link', stageShareUrl(window.location.href, shareFrom(preset, text)))}
          >
            {copied === 'link' ? 'Link copied' : 'Copy link'}
          </button>
          <button
            type="button"
            className="primary"
            onClick={() =>
              flash(
                'code',
                buildStageAgentPayload({
                  stage: stage.stage,
                  layout: stage.layout,
                  layoutOptions: stage.layoutOptions,
                  paper: stage.paper,
                  text: text.trim() ? text : undefined,
                  count: stage.count,
                  scroll: true,
                }),
              )
            }
          >
            {copied === 'code' ? 'Copied — paste into Claude Code' : 'Get the code'}
          </button>
        </div>
      </header>

      <footer className="chrome bottom">
        <label className="write">
          <span>Write the room</span>
          <textarea
            value={text}
            rows={2}
            spellCheck={false}
            placeholder="type anything — it becomes the architecture"
            onChange={(e) => setText(e.target.value)}
          />
        </label>

        <div className="rail">
          <div className="presets">
            {listStagePresets().map((id) => (
              <button
                key={id}
                type="button"
                className={id === preset ? 'chip on' : 'chip'}
                onClick={() => choose(id)}
              >
                {getStagePreset(id).label}
              </button>
            ))}
          </div>
          <div className="transport">
            <button type="button" className="chip" onClick={() => setWalking((w) => !w)}>
              {walking ? 'Pause' : 'Walk'}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.001}
              value={progress}
              onChange={(e) => {
                setWalking(false)
                setProgress(Number(e.target.value))
              }}
              aria-label="Distance along the walk"
            />
          </div>
        </div>
      </footer>
    </div>
  )
}
