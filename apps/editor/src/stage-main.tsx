import { createRoot } from 'react-dom/client'
import { useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { PaperStage, getStagePreset, type ShotName } from 'paperlab/stage'
/**
 * One frame of stage mode through the public component and the real stage
 * presets, on its own entry point so it can be booted headless and
 * screenshotted (`pnpm shot --preset=archive`). Going through the shipped
 * presets is the point: a preset nobody has looked at is not a preset.
 */

declare global {
  interface Window {
    __STAGE__?: { ready: boolean; errors: string[]; walk?: number; visited?: number }
    __PERF__?: { frames: number[]; done: boolean; tier?: string; renderer?: string }
  }
}

window.__STAGE__ = { ready: false, errors: [] }

const query = new URLSearchParams(window.location.search)
const has = (key: string) => query.has(key)
const num = (key: string, fallback: number) => {
  const value = Number(query.get(key))
  return Number.isFinite(value) && has(key) ? value : fallback
}

window.__PERF__ = { frames: [], done: false }

/** Warm-up frames to discard: shader compiles and texture uploads land here. */
const WARMUP = 25
/** Frames to time. Enough that one hitch cannot move the median. */
const SAMPLE = 90

function Ready() {
  const gl = useThree((s) => s.gl)
  const peakTris = useRef(0)
  useFrame((_, delta) => {
    const perf = window.__PERF__!
    if (!window.__STAGE__!.ready && gl.info.render.frame > 2) window.__STAGE__!.ready = true
    if (perf.done) return
    if (gl.info.render.frame < WARMUP) return
    // info.render resets every frame and the shadow pass files its own, so
    // take the peak across the sample rather than one arbitrary reading.
    peakTris.current = Math.max(peakTris.current, gl.info.render.triangles)
    perf.frames.push(delta * 1000)
    if (perf.frames.length >= SAMPLE) {
      perf.done = true
      // Report what the scene cost to build, not just what it costs to draw.
      Object.assign(perf, {
        triangles: peakTris.current,
        drawCalls: gl.info.render.calls,
        programs: gl.info.programs?.length ?? 0,
        textures: gl.info.memory.textures,
        geometries: gl.info.memory.geometries,
        // What ACTUALLY drew it, not what was asked for. Headless Chromium
        // hands out a software rasterizer far more often than the launch
        // flags suggest, and a number read as a GPU number when SwiftShader
        // produced it is worse than no number.
        renderer: rendererName(gl.getContext()),
      })
    }
  })
  return null
}

function rendererName(ctx: WebGLRenderingContext | WebGL2RenderingContext): string {
  const ext = ctx.getExtension('WEBGL_debug_renderer_info')
  return ext ? String(ctx.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown'
}

const preset = getStagePreset(query.get('preset') ?? 'nave')

window.addEventListener('error', (e) => window.__STAGE__!.errors.push(String(e.message)))

const paper = preset.paper as { sheet?: Record<string, unknown> } | undefined
const tuned =
  has('segments') && paper?.sheet
    ? { ...paper, sheet: { ...paper.sheet, segments: num('segments', 0) } }
    : preset.paper

createRoot(document.getElementById('root')!).render(
  <PaperStage
    quality={(query.get('quality') as never) ?? 'high'}
    onQualityChange={(tier) => {
      window.__PERF__!.tier = tier
    }}
    text={query.get('text') ?? preset.text}
    count={num('banners', preset.count)}
    preset={tuned}
    layout={preset.layout}
    layoutOptions={preset.layoutOptions}
    // Pinned by default so a shot is the same frame on any machine. `?drive=1`
    // lets go of it, which is the only way anything can exercise the viewer
    // driving the walk — a controlled stage never listens.
    progress={has('drive') ? undefined : num('progress', 0.42)}
    onProgress={(walk) => {
      window.__STAGE__!.walk = walk
    }}
    onVisit={(paper) => {
      window.__STAGE__!.visited = paper
    }}
    // Forced off so a shot is deterministic wherever it runs — and forceable
    // ON, because the reduced-motion scene is a thing we ship and nothing
    // could look at it: `?reduced=1` freezes the walk and stands the figure.
    reducedMotion={has('reduced')}
    stage={{
      ...preset.stage,
      // ?model=<url> swaps the capsule silhouette for a rigged glTF and
      // ?gait= forces walk or run — the only way to exercise either path
      // without shipping an asset. Built as ONE figure object: two spreads
      // each rebuilding `figure` would mean passing both silently dropped
      // whichever came first.
      ...(has('model') || has('gait') || has('finish')
        ? {
            showFigure: true,
            figure: {
              ...preset.stage.figure,
              ...(has('model') ? { model: query.get('model')! } : {}),
              ...(has('gait') ? { gait: query.get('gait') as never } : {}),
              ...(has('finish') ? { finish: query.get('finish') as never } : {}),
            },
          }
        : {}),
      // The light, one query param per slider, so a look can be swept from
      // the shell before it is written into a preset.
      light: {
        ...preset.stage.light,
        ...(has('exposure') ? { exposure: num('exposure', 1) } : {}),
        // `?film=filmic` prints the same frame on the old ACES curve, which
        // is the only way to compare the two without editing a preset.
        ...(has('film') ? { film: query.get('film') as never } : {}),
        ...(has('key') ? { key: num('key', 3.4) } : {}),
        ...(has('direction') ? { direction: num('direction', 180) } : {}),
        ...(has('height') ? { height: num('height', 24) } : {}),
        ...(has('ambient') ? { ambient: num('ambient', 0.03) } : {}),
        ...(has('studio') ? { studio: num('studio', 0.55) } : {}),
        ...(has('haze') ? { haze: num('haze', 1) } : {}),
      },
      // The print, one query param per knob — same reason as the light:
      // a grade has to be swept before it is written into a default.
      grade: {
        ...preset.stage.grade,
        ...(has('bloom') ? { bloom: num('bloom', 0.45) } : {}),
        ...(has('threshold') ? { threshold: num('threshold', 0.96) } : {}),
        ...(has('vignette') ? { vignette: num('vignette', 0.34) } : {}),
        ...(has('grain') ? { grain: num('grain', 0.022) } : {}),
        ...(has('depth') ? { depth: num('depth', 0) } : {}),
      },
      // The architecture, sweepable like the light and the print.
      ...(has('ceiling') || query.get('room') === '0'
        ? {
            room: {
              ...preset.stage.room,
              ...(has('ceiling') ? { height: num('ceiling', 1.35) } : {}),
              ...(query.get('room') === '0' ? { enabled: false } : {}),
            },
          }
        : {}),
      ...(has('slab') || has('floor')
        ? {
            ground: {
              ...preset.stage.ground,
              ...(has('slab') ? { slab: num('slab', 2.4) } : {}),
              ...(has('floor') ? { color: `#${query.get('floor')}` } : {}),
            },
          }
        : {}),
      ...(has('spread') || query.get('surround') === '0'
        ? {
            source: {
              ...preset.stage.source,
              ...(has('spread') ? { spread: num('spread', 2) } : {}),
              ...(query.get('surround') === '0' ? { surround: false } : {}),
            },
          }
        : {}),
      shot: {
        ...preset.stage.shot,
        ...(has('shot') ? { shot: query.get('shot') as ShotName } : {}),
        ...(has('distance') ? { distance: num('distance', 5) } : {}),
        ...(has('offset') ? { offset: num('offset', 1.5) } : {}),
        ...(has('lookAhead') ? { lookAhead: num('lookAhead', 12) } : {}),
      },
    }}
  >
    <Ready />
  </PaperStage>,
)
