import { createRoot } from 'react-dom/client'
import { useEffect } from 'react'
import { Canvas } from '@react-three/fiber'
import { DAMAGE_CHANNELS, Paper, PaperLighting, PaperMesh, type DamageSource, type StockName } from 'paperlab'

/**
 * One sheet, drawn with or without a damage texture attached, for
 * `pnpm test:damage` to photograph.
 *
 * The claim under test: attaching a field that nothing has happened to must
 * not change a single pixel. The damage chunk is written as an exact
 * identity — multiply by one, mix by zero, keep everything at full presence —
 * but that is an argument about arithmetic, and a program with an extra
 * chunk, an extra sampler and a different alpha test is a different program.
 * Only a render can say it draws the same picture.
 *
 *   ?damage=none       no texture at all — the sheet as it has always been
 *   ?damage=untouched  a texture with nothing in it
 *   ?damage=scorched   a texture with a burn in the middle — the CONTROL:
 *                      if this matched too, the check could not see anything
 *   ?damage=glowing    the same scorch with its burning line HOT — which must
 *                      draw exactly `scorched`: heat paints nothing on paper
 *   ?damage=hole       a hole punched through the middle — for the shadow
 *   ?detail=0          the same damage without its per-fragment fray
 *   ?stock=…           any stock; `vellum` is the one below full opacity
 *   ?scene=shadow      the sheet over a floor that RECEIVES its shadow map,
 *                      seen from above — the one place a hole's shadow shows.
 *                      Contact shadows off: they are a separate pass that
 *                      never reads a mesh's depth material.
 *
 * Built only from the main entry. The seam is the main entry's contract, and
 * a harness that reached into `paperlab/fx` to satisfy it would be testing
 * the wrong side of the wall.
 */

declare global {
  interface Window {
    __DAMAGE__?: { ready: boolean }
  }
}

const query = new URLSearchParams(window.location.search)
const mode = query.get('damage') ?? 'none'
const stock = (query.get('stock') ?? 'printer') as StockName
const scene = query.get('scene') ?? 'sheet'
// Clamped, because it comes off a URL: `?detail=Infinity` would otherwise
// reach the shader, where the fray is multiplied by a zero on pristine paper
// and NaN is what lands on the sheet.
const asked = Number(query.get('detail') ?? '1')
const detail = Number.isFinite(asked) ? Math.min(1, Math.max(0, asked)) : 1

const SIZE = 64

function field(scorch: boolean, hole = false, glow = false): DamageSource {
  const pixels = new Uint8Array(SIZE * SIZE * 4)
  for (let i = 0; i < SIZE * SIZE; i++) {
    const x = i % SIZE
    const y = (i / SIZE) | 0
    const d = Math.hypot(x - SIZE / 2, y - SIZE / 2)
    // A hole: the middle of the sheet gone. Its shadow is the question —
    // a hole that casts a solid shadow is the most obvious fake a burn has.
    pixels[i * 4 + DAMAGE_CHANNELS.presence] = hole && d < 14 ? 0 : 255
    if (scorch) pixels[i * 4 + DAMAGE_CHANNELS.char] = Math.max(0, Math.min(255, Math.round((12 - d) * 40)))
    // The burning line: a ring of heat at the scorch's rim, where a front is.
    if (glow) {
      pixels[i * 4 + DAMAGE_CHANNELS.heat] = Math.max(
        0,
        Math.min(255, Math.round((1 - Math.abs(d - 10.5) / 2.5) * 255)),
      )
    }
  }
  return { size: SIZE, pixels, version: 1, detail }
}

const damage =
  mode === 'untouched'
    ? field(false)
    : mode === 'scorched'
      ? field(true)
      : mode === 'glowing'
        ? field(true, false, true)
        : mode === 'hole'
          ? field(false, true)
          : undefined

/**
 * Ready after the content texture exists and a run of frames has been drawn.
 *
 * Counted in frames, like every harness in this repo now: a wall-clock wait
 * photographs whatever the renderer had managed by then, which on a slow
 * machine is not the finished picture.
 */
function Ready() {
  useEffect(() => {
    let frames = 0
    let raf = 0
    const tick = () => {
      if (++frames >= 60) window.__DAMAGE__ = { ready: true }
      else raf = requestAnimationFrame(tick)
    }
    document.fonts.ready.then(() => {
      raf = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(raf)
  }, [])
  return null
}

const content = { type: 'text' as const, text: 'An untouched field\ndraws nothing.', size: 40 }

function ShadowScene() {
  return (
    <Canvas
      shadows
      dpr={1}
      camera={{ position: [0, 3.4, 3.0], fov: 42 }}
      onCreated={({ camera }) => camera.lookAt(0, -1.0, -0.6)}
    >
      <color attach="background" args={['#1a1a1d']} />
      <PaperLighting preset="studio" floor={-1.05} contactShadow={false} environment={false} reducedMotion />
      <PaperMesh stock={stock} reducedMotion content={content} {...(damage ? { damage } : {})} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.05, 0]} receiveShadow>
        <planeGeometry args={[10, 10]} />
        <meshStandardMaterial color="#d8d3ca" />
      </mesh>
    </Canvas>
  )
}

createRoot(document.getElementById('root')!).render(
  scene === 'shadow' ? (
    <>
      <ShadowScene />
      <Ready />
    </>
  ) : (
    <>
      <Paper
        stock={stock}
        // Frozen, so two loads draw the same moment rather than two moments of
        // an idle sway.
        reducedMotion
        content={content}
        {...(damage ? { damage } : {})}
      />
      <Ready />
    </>
  ),
)
