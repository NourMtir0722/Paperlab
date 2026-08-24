import { useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import type { Object3D, PerspectiveCamera } from 'three'
import { fitFov } from './imageExport'

export interface CaptureHandle {
  /** Render the live scene at an exact pixel size; resolves a PNG data URL. */
  capture(width: number, height: number): Promise<string>
}

/**
 * Renders one frame at an exact size and reads it back. Lives INSIDE the
 * canvas because everything it needs — the renderer, the camera, r3f's own
 * size state — is only reachable from in there.
 *
 * Two decisions carry the whole thing:
 *
 * **It resizes through r3f rather than through the renderer.** `gl.setSize`
 * is the obvious call and it is the wrong one: stage mode mounts an
 * `EffectComposer`, which sizes its buffers off r3f's `size` state, so a
 * renderer resized behind its back composites a new frame through an old
 * buffer. `setSize` moves both.
 *
 * **It lets the app's own loop draw the frame** instead of calling
 * `gl.render`. A direct render skips the composer entirely, which for stage
 * mode means exporting an ungraded picture of a scene whose grade is most of
 * how it looks. Waiting for the buffer to be the size we asked for, and then
 * for a frame drawn at that size, works the same in all three modes.
 *
 * Reading it back at all depends on `preserveDrawingBuffer: true` on the
 * editor's canvas — without it the buffer is cleared before anything outside
 * the render can see it. `captureThumbnail` already relies on the same flag.
 */
export function CaptureRig({ handleRef }: { handleRef: React.RefObject<CaptureHandle | null> }) {
  const state = useThree()
  // The handle is installed once and called much later; keep it reading the
  // live renderer rather than the one that existed when it was installed.
  const latest = useRef(state)
  latest.current = state

  useEffect(() => {
    handleRef.current = {
      async capture(width: number, height: number) {
        const { camera, scene, size, setSize, setDpr, viewport } = latest.current
        const restore = { width: size.width, height: size.height, dpr: viewport.dpr }
        const perspective = camera as PerspectiveCamera
        const fov = perspective.fov
        // Editing affordances are not artwork. The grab handle is drawn with
        // `depthTest: false` so that it sits on top of the sheet, which makes
        // it the single most prominent thing in an exported picture — a blue
        // dot in the middle of the receipt you were about to post.
        const chrome: Object3D[] = []
        scene.traverse((object) => {
          if (object.userData.paperlabChrome && object.visible) chrome.push(object)
        })
        try {
          for (const object of chrome) object.visible = false
          // Set before the resize: r3f recomputes the projection as part of
          // handling the new size, so both changes land in one update.
          perspective.fov = fitFov(fov, size.width / size.height, width / height)
          // Device pixel ratio is the viewport's business, not the file's —
          // the requested size IS the pixel size, on any monitor.
          setDpr(1)
          setSize(width, height)
          await drawnAt(width, height)
          return latest.current.gl.domElement.toDataURL('image/png')
        } finally {
          for (const object of chrome) object.visible = true
          perspective.fov = fov
          setDpr(restore.dpr)
          setSize(restore.width, restore.height)
        }
      },
    }
    return () => {
      handleRef.current = null
    }
  }, [handleRef])

  return null
}

/**
 * Wait until the drawing buffer is the size we asked for, then for a frame
 * actually drawn at it.
 *
 * Polled rather than given a fixed number of frames, because the resize
 * crosses a React commit and "how many frames is that" is a guess that is
 * only ever wrong on a slow machine — the failure being a captured image at
 * the OLD size, which looks like a working feature that ignores the frame
 * you picked. The budget is a ceiling, not a wait: it gives up rather than
 * hanging if a resize is refused (a size past the GPU's limit).
 */
function drawnAt(width: number, height: number, budget = 90): Promise<void> {
  return new Promise((resolve) => {
    let left = budget
    let settled = 0
    const tick = () => {
      const canvas = document.querySelector<HTMLCanvasElement>('.viewport canvas')
      if (canvas && canvas.width === width && canvas.height === height) settled++
      // Two frames at the right size: the first is the one that resized, the
      // second is the one drawn into it.
      if (settled >= 2 || left-- <= 0) resolve()
      else requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
}
