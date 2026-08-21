import { createRoot } from 'react-dom/client'
import { useEffect, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import {
  PaperFieldMesh,
  PaperLighting,
  PaperMesh,
  PaperStageScene,
  getStagePreset,
  type PaperHandle,
} from 'paperlab'

/**
 * The frame server behind `pnpm media`.
 *
 * README assets for a motion library have to move, and the honest way to
 * record that is not a screen capture — it is to hold the clock still and
 * ask for one exact frame at a time. This entry renders any preset with its
 * progress driven from the outside (`window.__MEDIA__.set(p)`), so the
 * capture tool can step 0 → 1 deterministically and get a loop with no
 * dropped frames, no compositor jitter, and the same output on any machine.
 */

declare global {
  interface Window {
    __MEDIA__?: { ready: boolean; set(progress: number): void }
  }
}

const query = new URLSearchParams(window.location.search)
const mode = query.get('mode') ?? 'paper'
const preset = query.get('preset') ?? 'receipt-unroll'
const background = query.get('bg') ?? '#111014'
/**
 * Framing is per-asset and not negotiable by eye: a 2.6-unit receipt does
 * not fit the 2.1 units the default 40° lens sees at z=2.9, so it walks out
 * of frame halfway through its own unroll. Each asset passes the camera it
 * needs.
 */
const numbers = (key: string, fallback: number[]) => {
  const raw = query.get(key)
  if (!raw) return fallback
  const parts = raw.split(',').map(Number)
  return parts.every(Number.isFinite) && parts.length === fallback.length ? parts : fallback
}
const fov = Number(query.get('fov')) || 40

function PaperFrames() {
  const ref = useRef<PaperHandle>(null)
  useEffect(() => {
    window.__MEDIA__ = {
      ready: true,
      set: (p) => ref.current?.set('progress', p),
    }
  }, [])
  return (
    <Canvas
      camera={{ position: numbers('cam', [0, 0.35, 2.9]) as [number, number, number], fov }}
      dpr={2}
      gl={{ preserveDrawingBuffer: true, antialias: true }}
    >
      <color attach="background" args={[background]} />
      <PaperLighting preset="studio" floor={-1.5} scale={10} />
      <PaperMesh ref={ref} preset={preset} />
    </Canvas>
  )
}

function FieldFrames() {
  const [phase, setPhase] = useState(0)
  useEffect(() => {
    window.__MEDIA__ = { ready: true, set: setPhase }
  }, [])
  return (
    <Canvas
      camera={{ position: numbers('cam', [0, 0.9, 6.4]) as [number, number, number], fov }}
      dpr={2}
      gl={{ preserveDrawingBuffer: true }}
    >
      <color attach="background" args={[background]} />
      <PaperLighting preset="studio" floor={-2.4} scale={14} />
      <group rotation={[0, phase * Math.PI * 2, 0]}>
        <PaperFieldMesh
          papers={Array.from({ length: 12 }, () => ({ preset }))}
          layout={query.get('layout') ?? 'ring'}
          motion={{ driver: 'none' }}
          entrance={{ type: 'none' }}
        />
      </group>
    </Canvas>
  )
}

function StageFrames() {
  const [progress, setProgress] = useState(0)
  useEffect(() => {
    window.__MEDIA__ = { ready: true, set: setProgress }
  }, [])
  // A stage preset already carries its own walk inside `stage.path` — the
  // editor keeps the walk in a separate field, the preset does not.
  const stage = getStagePreset(preset)
  return (
    <Canvas
      camera={{ position: [0, 1.7, 6], fov: 38, near: 0.05, far: 400 }}
      dpr={2}
      shadows
      gl={{ preserveDrawingBuffer: true }}
    >
      <color attach="background" args={['#0c0a0b']} />
      <PaperStageScene
        // The same rig the editor and the playground show. The README's own
        // hero was recorded off the capsule fallback, so the one picture most
        // people ever see of stage mode was the thing that renders when you
        // have NOT supplied a model.
        stage={{
          ...stage.stage,
          figure: { ...stage.stage.figure, model: `${import.meta.env.BASE_URL}figure/walking-figure.glb` },
        }}
        preset={stage.paper}
        layout={stage.layout}
        layoutOptions={stage.layoutOptions}
        text={stage.text}
        count={stage.count}
        progress={progress}
        quality="high"
      />
    </Canvas>
  )
}

createRoot(document.getElementById('root')!).render(
  mode === 'stage' ? <StageFrames /> : mode === 'field' ? <FieldFrames /> : <PaperFrames />,
)
