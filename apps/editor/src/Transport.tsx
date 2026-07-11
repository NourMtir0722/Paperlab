import { useEffect, useRef, useState, type RefObject } from 'react'
import type { PaperHandle } from 'paperlab'
import { useEditor } from './store'

interface TransportProps {
  paperRef: RefObject<PaperHandle | null>
  /** The scrubber input — PaperMesh onProgress writes to it directly (no re-renders). */
  scrubRef: RefObject<HTMLInputElement | null>
  /** Remount signal: preset switches reset the transport to playing. */
  resetKey: string
}

/**
 * The one non-Figma element: time. Play/pause (spacebar) + a scrubber bound
 * to the behavior's progress. No keyframe timeline in v1 — behaviors are
 * parametric loops.
 */
export function Transport({ paperRef, scrubRef, resetKey }: TransportProps) {
  const hasBehavior = useEditor((s) => Boolean(s.config.behavior))
  const isCloth = useEditor((s) => typeof s.config.physics === 'object')
  const patchConfig = useEditor((s) => s.patchConfig)
  const [playing, setPlaying] = useState(true)
  const scrubbingRef = useRef(false)

  useEffect(() => {
    setPlaying(true)
  }, [resetKey])

  const toggle = () => {
    const paper = paperRef.current
    if (!paper || !hasBehavior) return
    if (playing) {
      paper.pause()
      // Persist the paused pose so the inspector shows where time stopped.
      patchConfig({ behavior: { progress: paper.getProgress() } as never }, { external: true })
    } else {
      paper.play()
    }
    setPlaying(!playing)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (e.code !== 'Space' || /INPUT|TEXTAREA|SELECT/.test(target.tagName)) return
      e.preventDefault()
      toggle()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <footer className="transport">
      <button className="play" onClick={toggle} disabled={!hasBehavior} title="Space">
        {playing && hasBehavior ? '❚❚' : '▶'}
      </button>
      <input
        ref={scrubRef}
        className="scrubber"
        type="range"
        min={0}
        max={1}
        step={0.001}
        defaultValue={0}
        disabled={!hasBehavior}
        onPointerDown={() => {
          scrubbingRef.current = true
          paperRef.current?.pause()
          setPlaying(false)
        }}
        onInput={(e) => {
          if (!scrubbingRef.current) return
          paperRef.current?.set('progress', parseFloat((e.target as HTMLInputElement).value))
        }}
        onPointerUp={(e) => {
          scrubbingRef.current = false
          const v = parseFloat((e.target as HTMLInputElement).value)
          patchConfig({ behavior: { progress: v } as never }, { external: true })
        }}
      />
      <span className="transport-hint">
        {isCloth
          ? 'cloth simulation — grab the sheet and pull'
          : hasBehavior
            ? 'space to play/pause · drag the blue handle on the paper'
            : 'no behavior'}
      </span>
    </footer>
  )
}
