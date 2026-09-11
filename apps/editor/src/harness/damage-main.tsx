import { createRoot } from 'react-dom/client'
import { useEffect } from 'react'
import { DAMAGE_CHANNELS, Paper, type DamageSource, type StockName } from 'paperlab'

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
 *   ?stock=…           any stock; `vellum` is the one below full opacity
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

const SIZE = 64

function field(scorch: boolean): DamageSource {
  const pixels = new Uint8Array(SIZE * SIZE * 4)
  for (let i = 0; i < SIZE * SIZE; i++) {
    const x = i % SIZE
    const y = (i / SIZE) | 0
    pixels[i * 4 + DAMAGE_CHANNELS.presence] = 255
    if (scorch) {
      const d = Math.hypot(x - SIZE / 2, y - SIZE / 2)
      pixels[i * 4 + DAMAGE_CHANNELS.char] = Math.max(0, Math.min(255, Math.round((12 - d) * 40)))
    }
  }
  return { size: SIZE, pixels, version: 1 }
}

const damage = mode === 'untouched' ? field(false) : mode === 'scorched' ? field(true) : undefined

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

createRoot(document.getElementById('root')!).render(
  <>
    <Paper
      stock={stock}
      // Frozen, so two loads draw the same moment rather than two moments of
      // an idle sway.
      reducedMotion
      content={{ type: 'text', text: 'An untouched field\ndraws nothing.', size: 40 }}
      {...(damage ? { damage } : {})}
    />
    <Ready />
  </>,
)
