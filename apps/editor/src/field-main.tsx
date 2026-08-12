import { createRoot } from 'react-dom/client'
import { useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { PaperFieldMesh, PaperLighting, getPreset } from 'paperlab'

/**
 * What a field actually costs to draw.
 *
 * Field mode's whole claim is that N papers are one instanced draw call, but
 * the vertex cost is per-sheet and every deformer asks for its own grid
 * density — `crumple` asks for 72 segments where `roll` is happy with far
 * fewer, and it evaluates nine cells per probe with three probes per vertex
 * for the normal. That is a real number nobody had, and "one draw call" is
 * not an answer to it.
 *
 * Its own entry point so it can be driven headless by `pnpm perf:field`,
 * exactly like `stage.html` is by `pnpm perf`.
 */

declare global {
  interface Window {
    __FIELD_PERF__?: {
      frames: number[]
      done: boolean
      triangles?: number
      drawCalls?: number
      renderer?: string
    }
  }
}

window.__FIELD_PERF__ = { frames: [], done: false }

const query = new URLSearchParams(window.location.search)
const presetName = query.get('preset') ?? 'photo-print'
const count = Number(query.get('count')) || 20
const layout = query.get('layout') ?? 'ring'

/** Warm-up frames to discard: shader compiles and atlas uploads land here. */
const WARMUP = 25
/** Frames to time. Enough that one hitch cannot move the median. */
const SAMPLE = 60

function Meter() {
  const gl = useThree((s) => s.gl)
  const started = useRef(false)
  useFrame((_, delta) => {
    const perf = window.__FIELD_PERF__!
    if (perf.done) return

    if (!started.current) {
      started.current = true
      // three resets `info.render` at the START of every render() call, and
      // the contact-shadow pass is the LAST one each frame — so reading these
      // counters normally reports two triangles for a whole field. Taking the
      // reset by hand is the only way to see every pass of a frame.
      gl.info.autoReset = false
    }

    if (gl.info.render.frame < WARMUP) {
      gl.info.reset()
      return
    }

    perf.frames.push(delta * 1000)
    if (perf.frames.length >= SAMPLE) {
      perf.done = true
      Object.assign(perf, {
        triangles: gl.info.render.triangles,
        drawCalls: gl.info.render.calls,
        // What actually drew this — headless Chromium falls back to software
        // unless it is told not to, and a number without this is a fiction.
        renderer: rendererName(gl.getContext()),
      })
    }
    gl.info.reset()
  })
  return null
}

function rendererName(ctx: WebGLRenderingContext | WebGL2RenderingContext): string {
  const ext = ctx.getExtension('WEBGL_debug_renderer_info')
  return ext ? String(ctx.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown'
}

const preset = getPreset(presetName)
const papers = Array.from({ length: count }, () => ({ preset }))

createRoot(document.getElementById('root')!).render(
  <Canvas shadows camera={{ position: [0, 0.9, 6.4], fov: 45 }} dpr={1}>
    <color attach="background" args={['#111014']} />
    <PaperLighting preset={preset.scene.lighting} floor={-2.4} scale={14} />
    <PaperFieldMesh
      papers={papers}
      layout={layout}
      motion={{ driver: 'autoplay', speed: 0.4 }}
      entrance={{ type: 'none' }}
    />
    <Meter />
  </Canvas>,
)
