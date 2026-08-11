import { createRoot } from 'react-dom/client'
import { useThree, useFrame } from '@react-three/fiber'
import { PaperStage, type ShotName } from 'paperlab'

/**
 * One frame of stage mode through the public component, on its own entry
 * point so it can be booted headless and screenshotted (`pnpm shot`). Going
 * through `<PaperStage>` rather than hand-assembling the scene is the point:
 * if the shot needs anything the component cannot express, that is a gap in
 * the component.
 */

declare global {
  interface Window {
    __STAGE__?: { ready: boolean; errors: string[] }
  }
}

window.__STAGE__ = { ready: false, errors: [] }

const query = new URLSearchParams(window.location.search)
const num = (key: string, fallback: number) => {
  const value = Number(query.get(key))
  return Number.isFinite(value) && query.has(key) ? value : fallback
}

function Ready() {
  const gl = useThree((s) => s.gl)
  useFrame(() => {
    // Two frames in, anything that was going to fail to compile has.
    if (!window.__STAGE__!.ready && gl.info.render.frame > 2) window.__STAGE__!.ready = true
  })
  return null
}

const TEXT =
  query.get('text') ??
  'the paper remembers every hand that folded it and every room it was carried through and it keeps them all at once'

window.addEventListener('error', (e) => window.__STAGE__!.errors.push(String(e.message)))

createRoot(document.getElementById('root')!).render(
  <PaperStage
    text={TEXT}
    count={num('banners', 22)}
    progress={num('progress', 0.42)}
    reducedMotion={false}
    stage={{
      path: {
        points: [
          [0, 14],
          [0, -22],
        ],
      },
      shot: {
        shot: (query.get('shot') as ShotName) ?? 'follow',
        distance: num('distance', 5),
        lookAhead: num('lookAhead', 12),
        height: num('height', 1),
        offset: num('offset', 1.5),
      },
      lighting: 'nave',
    }}
  >
    <Ready />
  </PaperStage>,
)
