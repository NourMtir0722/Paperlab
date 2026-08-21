import * as THREE from 'three'
import type { LightingPreset } from './lighting'
import { lightAngles } from './lighting'

/**
 * The room, drawn as an equirectangular image so it can light things.
 *
 * Stage mode already builds a graded sky around the whole space and it lit
 * nothing — it was a gradient mesh the camera looked at. This is the same
 * three colours plus a soft disc where the key stands, turned into an
 * environment map, so the hall is lit BY the room the viewer can see. That
 * is what puts direction into the fill: a banner turned toward the source
 * picks up the source, one turned away picks up the dark end of the room,
 * and paper's sheen finally has something to reflect.
 *
 * Procedural on purpose — the repo carries no HDRI, nothing is fetched, and
 * the grade stays editable from the same numbers the lights read.
 */

/** Small is fine: PMREM blurs it into mip levels anyway, and roughness eats the detail. */
const WIDTH = 256
const HEIGHT = 128

/**
 * Where a direction lands in an equirectangular image, matching three's own
 * `equirectUv`: `u = atan2(z, x) / 2π + 0.5`. Our azimuth is measured from
 * +Z instead (0° in front, 90° right), which works out to `u = 0.75 − az/360`.
 * Getting this right is what puts the bright patch of sky on the same side
 * of the room as the lamp casting the shadows.
 */
export function skyU(azimuthDeg: number): number {
  const u = 0.75 - azimuthDeg / 360
  return ((u % 1) + 1) % 1
}

/** Elevation to image row. Row 0 is the zenith — v is flipped by the texture. */
export function skyV(elevationDeg: number): number {
  return 0.5 - elevationDeg / 180
}

/**
 * Paint the room. The gradient runs zenith → horizon → ground with the
 * horizon held as a band rather than a hairline, because a room's brightest
 * region is the wall, not a mathematical line through it.
 */
export function drawSky(ctx: CanvasRenderingContext2D, preset: LightingPreset): void {
  const { zenith, horizon, ground } = preset.sky
  const grade = ctx.createLinearGradient(0, 0, 0, HEIGHT)
  grade.addColorStop(0, zenith)
  grade.addColorStop(0.32, zenith)
  grade.addColorStop(0.5, horizon)
  grade.addColorStop(0.58, horizon)
  grade.addColorStop(1, ground)
  ctx.fillStyle = grade
  ctx.fillRect(0, 0, WIDTH, HEIGHT)

  // The key's own patch of sky. Bright, wide and soft: this is a window or a
  // softbox, not a sun, and a hard disc would make the reflections read as
  // a lamp somebody left in shot.
  const angles = lightAngles(preset.key.position)
  const x = skyU(angles.azimuth) * WIDTH
  const y = skyV(angles.elevation) * HEIGHT
  const radius = WIDTH * 0.3
  const color = new THREE.Color(preset.key.color)
  // The disc carries the key's intensity, so turning the lamp up brightens
  // the room it is standing in rather than only the shadows it casts.
  const strength = Math.min(1, preset.key.intensity / 3)

  // Drawn three times across the seam so a key behind the paper — where the
  // wrap falls — is not sliced in half by the edge of the image.
  for (const offset of [-WIDTH, 0, WIDTH]) {
    const glow = ctx.createRadialGradient(x + offset, y, 0, x + offset, y, radius)
    glow.addColorStop(
      0,
      `rgba(${(color.r * 255) | 0}, ${(color.g * 255) | 0}, ${(color.b * 255) | 0}, ${strength})`,
    )
    glow.addColorStop(1, `rgba(${(color.r * 255) | 0}, ${(color.g * 255) | 0}, ${(color.b * 255) | 0}, 0)`)
    ctx.fillStyle = glow
    ctx.fillRect(x + offset - radius, y - radius, radius * 2, radius * 2)
  }
}

/** The room as a texture. Caller owns disposal. */
export function makeSkyEquirect(preset: LightingPreset): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = WIDTH
  canvas.height = HEIGHT
  const ctx = canvas.getContext('2d')!
  drawSky(ctx, preset)
  const texture = new THREE.CanvasTexture(canvas)
  texture.mapping = THREE.EquirectangularReflectionMapping
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

/**
 * The room, prefiltered into the mip chain a rough surface needs.
 *
 * PMREM is the expensive part and it runs ONCE per rig — a render target and
 * a handful of blur passes — after which sampling it costs a texture read.
 * Both the target and the source canvas are the caller's to dispose.
 */
export function buildEnvironment(
  renderer: THREE.WebGLRenderer,
  preset: LightingPreset,
): { texture: THREE.Texture; dispose(): void } {
  const equirect = makeSkyEquirect(preset)
  const pmrem = new THREE.PMREMGenerator(renderer)
  const target = pmrem.fromEquirectangular(equirect)
  pmrem.dispose()
  equirect.dispose()
  return {
    texture: target.texture,
    dispose: () => target.dispose(),
  }
}
