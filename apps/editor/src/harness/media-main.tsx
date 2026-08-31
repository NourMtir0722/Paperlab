import { createRoot } from 'react-dom/client'
import { useEffect, useRef, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import {
  LightRig,
  PaperFieldMesh,
  PaperLighting,
  PaperMesh,
  resolveLighting,
  type LightingName,
  type PaperConfigInput,
  type PaperHandle,
} from 'paperlab'
import { PaperStageScene, getStagePreset } from 'paperlab/stage'
import { DEMO_CARDS } from '../state/demoAssets'
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

/**
 * `?look=x,y,z` aims the camera somewhere other than the origin.
 *
 * Without it the camera can only ever look down -Z, which is fine for a
 * sheet standing up in the middle of the scene and useless for anything
 * lying flat: paper pooled on a floor is edge-on to a level camera, so the
 * one thing worth photographing about `paper-roll` was invisible. Aiming is
 * how you get to look DOWN at it.
 */
const look = numbers('look', [0, 0, 0]) as [number, number, number]
function AimCamera() {
  const camera = useThree((state) => state.camera)
  useEffect(() => {
    camera.lookAt(look[0], look[1], look[2])
  }, [camera])
  return null
}

/**
 * `?lighting=` and `?film=` exist so the light can be JUDGED headless.
 *
 * Calibrating a preset means looking at it, and every rig in this file used
 * to be pinned to `studio` — so the only way to see what `raking` or
 * `lightbox` actually does to a sheet was to open the editor and click. The
 * whole point of a preset is that it is data; this makes it data you can
 * take a photograph of.
 */
/**
 * `?stock=` overrides the preset's own paper. Same argument as `?lighting=`:
 * seven stocks that only differ in how they take light are a claim nobody can
 * check without seeing them beside each other on the same sheet of words.
 */
const stockOverride = query.get('stock') as PaperConfigInput['stock'] | null

const lighting = (query.get('lighting') ?? 'studio') as LightingName
const light = query.has('film') ? { film: query.get('film') as never } : undefined

/**
 * The rig has to be PUBLISHED, not just drawn.
 *
 * `<PaperLighting>` places the lamps; `<LightRig>` is what tells the paper
 * which lamps those are. Without the provider a sheet falls back to its own
 * `scene.lighting` — `studio` for almost every preset — so it computes its
 * backlit transmission against a lamp in FRONT of it while the actual key
 * stands behind. That is precisely the disagreement `resolveLighting` exists
 * to prevent, and this harness reproduced it: `lightbox` rendered as a flat
 * grey sheet because the paper never heard about the lamp behind it.
 */
const rig = resolveLighting(lighting, light)

/**
 * `?scroll=N` feeds a scroll-driven simulation, ramping to N over `?feed=`
 * seconds.
 *
 * `progress` cannot photograph a `strip`: that sim has no progress param, it
 * has a scroll position it DIFFERENTIATES, so a value held still pays out no
 * paper at all and the preset renders as a full roll with a leaf out forever.
 * The pile is the thing worth looking at and it only exists after the roll
 * has been turned for a while. Same argument as `?stock=` and `?lighting=`
 * above: a preset is data, and this makes it data you can take a photograph
 * of.
 */
const scrollTo = Number(query.get('scroll')) || 0
const feedSeconds = Number(query.get('feed')) || 3
/** `?grab=1` turns on drag handles / grabbable simulations, so a pointer
 *  gesture can be driven headless and photographed. */
const grabbable = query.get('grab') === '1'

function PaperFrames() {
  const ref = useRef<PaperHandle>(null)
  const [scroll, setScroll] = useState(0)
  useEffect(() => {
    window.__MEDIA__ = {
      ready: true,
      set: (p) => ref.current?.set('progress', p),
    }
    if (!scrollTo) return
    // Wall-clock ramp rather than a stepped one: the sim integrates, so it
    // needs real frames between values, not a jump to the end state.
    const start = performance.now()
    let raf = 0
    const tick = () => {
      const t = Math.min(1, (performance.now() - start) / (feedSeconds * 1000))
      setScroll(t * scrollTo)
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])
  return (
    <Canvas
      camera={{ position: numbers('cam', [0, 0.35, 2.9]) as [number, number, number], fov }}
      dpr={2}
      gl={{ preserveDrawingBuffer: true, antialias: true }}
    >
      <color attach="background" args={[background]} />
      <AimCamera />
      <LightRig rig={rig}>
        <PaperLighting rig={rig} floor={-1.5} scale={10} />
        <PaperMesh
          ref={ref}
          preset={preset}
          {...(stockOverride ? { stock: stockOverride } : {})}
          {...(scrollTo ? { physics: { type: 'strip' as const, scroll } } : {})}
          {...(grabbable ? { interactive: true } : {})}
        />
      </LightRig>
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
      <LightRig rig={rig}>
        <PaperLighting rig={rig} floor={-2.4} scale={14} />
        <group rotation={[0, phase * Math.PI * 2, 0]}>
          <PaperFieldMesh
            papers={Array.from({ length: 12 }, (_, i) => ({
              preset,
              content: DEMO_CARDS[i % DEMO_CARDS.length],
            }))}
            layout={query.get('layout') ?? 'ring'}
            motion={{ driver: 'none' }}
            entrance={{ type: 'none' }}
          />
        </group>
      </LightRig>
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
