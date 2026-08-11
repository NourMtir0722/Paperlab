import { createRoot } from 'react-dom/client'
import { useFrame, useThree } from '@react-three/fiber'
import { PaperStage, getStagePreset, type ShotName } from 'paperlab'

/**
 * One frame of stage mode through the public component and the real stage
 * presets, on its own entry point so it can be booted headless and
 * screenshotted (`pnpm shot --preset=archive`). Going through the shipped
 * presets is the point: a preset nobody has looked at is not a preset.
 */

declare global {
  interface Window {
    __STAGE__?: { ready: boolean; errors: string[] }
  }
}

window.__STAGE__ = { ready: false, errors: [] }

const query = new URLSearchParams(window.location.search)
const has = (key: string) => query.has(key)
const num = (key: string, fallback: number) => {
  const value = Number(query.get(key))
  return Number.isFinite(value) && has(key) ? value : fallback
}

function Ready() {
  const gl = useThree((s) => s.gl)
  useFrame(() => {
    // Two frames in, anything that was going to fail to compile has.
    if (!window.__STAGE__!.ready && gl.info.render.frame > 2) window.__STAGE__!.ready = true
  })
  return null
}

const preset = getStagePreset(query.get('preset') ?? 'nave')

window.addEventListener('error', (e) => window.__STAGE__!.errors.push(String(e.message)))

createRoot(document.getElementById('root')!).render(
  <PaperStage
    text={query.get('text') ?? preset.text}
    count={num('banners', preset.count)}
    preset={preset.paper}
    layout={preset.layout}
    layoutOptions={preset.layoutOptions}
    progress={num('progress', 0.42)}
    reducedMotion={false}
    stage={{
      ...preset.stage,
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
