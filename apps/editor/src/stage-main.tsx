import * as THREE from 'three'
import { createRoot } from 'react-dom/client'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useMemo } from 'react'
import {
  Figure,
  PaperFieldMesh,
  PaperLighting,
  getWalkPath,
  shotSchema,
  stageCamera,
  walkPathSchema,
  type PaperConfigInput,
} from 'paperlab'

/**
 * A single frame of stage mode, on its own entry point so it can be booted
 * headless and screenshotted (`pnpm shot`). This is the eyeball test the
 * unit suite cannot give: whether the colonnade, the backlit paper, the
 * figure and the shot actually compose into the picture they were built for.
 */

declare global {
  interface Window {
    __STAGE__?: { ready: boolean; errors: string[] }
  }
}

window.__STAGE__ = { ready: false, errors: [] }

// Read overrides off the query string so the harness can sweep settings
// without a rebuild: ?walked=6&shot=low&lighting=nave
const query = new URLSearchParams(window.location.search)
const num = (key: string, fallback: number) => {
  const value = Number(query.get(key))
  return Number.isFinite(value) && query.has(key) ? value : fallback
}

const WALK = walkPathSchema.parse({
  points: [
    [0, 14],
    [0, -22],
  ],
})
const FIGURE_HEIGHT = 1.75
const BANNERS = num('banners', 22)
const WALKED = num('walked', 9)

/** A banner: tall, thin, translucent stock, with a long slow ripple in it. */
const banner: PaperConfigInput = {
  sheet: { width: 1.5, height: 8.5, segments: 96 },
  stock: 'vellum',
  content: {
    type: 'text',
    text: 'PAPERLAB\nthe paper remembers\nevery hand that\nfolded it\n\n— stage mode —',
    size: 34,
    align: 'center',
    color: '#241f1a',
    lineHeight: 1.9,
  },
  surface: { grain: 0.25 },
  deformers: [
    // Pinned at the top, because a hung banner does not ripple where it is fixed.
    { type: 'wave', options: { amplitude: 0.17, wavelength: 0.9, speed: 0.08, angle: 0, pinnedEdge: 'top' } },
  ],
  scene: { lighting: 'nave' },
}

function Shot({ walked }: { walked: number }) {
  const camera = useThree((s) => s.camera)
  const path = useMemo(() => getWalkPath(WALK), [])
  const options = useMemo(
    () =>
      shotSchema.parse({
        shot: (query.get('shot') as never) ?? 'follow',
        distance: num('distance', 5),
        lookAhead: num('lookAhead', 12),
        height: num('height', 1),
        offset: num('offset', 1.5),
      }),
    [],
  )

  useFrame(() => {
    const { position, target } = stageCamera(path, walked, FIGURE_HEIGHT, options)
    camera.position.set(position[0], position[1], position[2])
    camera.lookAt(target[0], target[1], target[2])
  })
  return null
}

function Ready() {
  const gl = useThree((s) => s.gl)
  useFrame(() => {
    // Two frames in, everything that was going to fail to compile has.
    if (!window.__STAGE__!.ready && gl.info.render.frame > 2) {
      window.__STAGE__!.ready = true
    }
  })
  return null
}

function Stage() {
  return (
    <Canvas
      shadows
      dpr={1}
      camera={{ fov: 38, near: 0.05, far: 220 }}
      gl={{ antialias: true }}
      onCreated={({ gl, scene }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping
        scene.background = new THREE.Color('#0c0a0b')
      }}
    >
      <Shot walked={WALKED} />
      <Ready />
      <PaperLighting preset="nave" floor={0} scale={60} />
      {/* The floor the figure and the banners stand on — without something to
          catch the shadow there is no ground, and no sense of scale. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[120, 160]} />
        <meshStandardMaterial color="#0e0b09" roughness={1} />
      </mesh>
      {/* The source itself, at the end of the walk: every reference frame
          resolves to a bright void, and a directional light has no body to
          be one. */}
      <mesh position={[0, 14, -30]}>
        <planeGeometry args={[70, 46]} />
        <meshBasicMaterial color="#fff4e2" toneMapped={false} fog={false} />
      </mesh>
      <PaperFieldMesh
        preset={banner}
        papers={Array.from({ length: BANNERS }, () => ({}))}
        layout="colonnade"
        layoutOptions={{ path: WALK, aisle: 2.6, twist: 26, drape: 0.6, rise: 0.3, breathe: 0.35 }}
        motion={{ driver: 'none' }}
        entrance={{ type: 'none' }}
        reducedMotion={false}
      />
      <Figure path={WALK} figure={{ height: FIGURE_HEIGHT }} distance={WALKED} frozen={false} />
    </Canvas>
  )
}

window.addEventListener('error', (e) => window.__STAGE__!.errors.push(String(e.message)))
createRoot(document.getElementById('root')!).render(<Stage />)
