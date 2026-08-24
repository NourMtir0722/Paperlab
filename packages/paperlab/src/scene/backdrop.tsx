import * as THREE from 'three'
import { useEffect, useState } from 'react'
import { useThree } from '@react-three/fiber'
import type { BackdropConfig } from '../config/schema'

/**
 * What is behind the sheet.
 *
 * Painted onto a canvas at the viewport's own size and handed to
 * `scene.background`, rather than assigned as a texture directly. Three
 * stretches a background texture to the frame whatever shape it is, so a
 * landscape photograph behind a 9:16 export would come out squashed — and
 * the export sizes are exactly where a backdrop matters most. Painting it
 * means `cover` is really cover, and `fade` and `blur` come along for free
 * in the same pass.
 *
 * It sets the SCENE's background, so it belongs to whoever owns the canvas.
 * `<Paper>` and `<PaperField>` render it; `<PaperMesh>` deliberately does
 * not — it drops into someone else's scene, and a sheet that repainted the
 * background of the app it was embedded in would be a component doing
 * something nobody asked it to.
 */
export function PaperBackdrop({ backdrop }: { backdrop?: BackdropConfig }) {
  const scene = useThree((s) => s.scene)
  const size = useThree((s) => s.size)
  const [image, setImage] = useState<HTMLImageElement | null>(null)

  const src = backdrop?.image ?? ''

  useEffect(() => {
    if (!src) {
      setImage(null)
      return
    }
    let live = true
    const img = new Image()
    img.crossOrigin = 'anonymous'
    // A picture that will not load leaves the colour, which is the honest
    // rendering of "no backdrop image" — not a black frame and not a throw.
    img.onload = () => live && setImage(img)
    img.onerror = () => live && setImage(null)
    img.src = src
    return () => {
      live = false
    }
  }, [src])

  const key = JSON.stringify({ backdrop: backdrop ?? null, w: size.width, h: size.height, loaded: !!image })

  // biome-ignore lint/correctness/useExhaustiveDependencies: key serializes everything the paint reads.
  useEffect(() => {
    if (!backdrop) return
    const previous = scene.background
    const texture = paintBackdrop(backdrop, size.width, size.height, image)
    scene.background = texture
    return () => {
      scene.background = previous
      texture.dispose()
    }
  }, [key])

  return null
}

/** Exported for the test — the painting is the part that can be wrong. */
export function paintBackdrop(
  backdrop: BackdropConfig,
  width: number,
  height: number,
  image: HTMLImageElement | null,
): THREE.CanvasTexture {
  // Half resolution. It is out of focus behind the subject and it is drawn
  // once per resize, so the pixels buy nothing and the memory is real.
  const w = Math.max(2, Math.round(width / 2))
  const h = Math.max(2, Math.round(height / 2))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!

  ctx.fillStyle = backdrop.color
  ctx.fillRect(0, 0, w, h)

  if (image && image.width > 0 && image.height > 0) {
    const scale =
      backdrop.fit === 'cover'
        ? Math.max(w / image.width, h / image.height)
        : Math.min(w / image.width, h / image.height)
    const dw = image.width * scale
    const dh = image.height * scale
    ctx.save()
    // Scaled by the SHORT edge: a blur measured in pixels is a different
    // amount of blur on a phone frame than on a hero, and the backdrop
    // should sit the same distance behind the paper in both.
    if (backdrop.blur > 0) ctx.filter = `blur(${backdrop.blur * Math.min(w, h) * 0.06}px)`
    ctx.drawImage(image, (w - dw) / 2, (h - dh) / 2, dw, dh)
    ctx.restore()
    if (backdrop.fade > 0) {
      ctx.globalAlpha = backdrop.fade
      ctx.fillStyle = backdrop.color
      ctx.fillRect(0, 0, w, h)
      ctx.globalAlpha = 1
    }
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}
