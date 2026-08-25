import { useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import type { Object3D, PerspectiveCamera } from 'three'
import { fitFov } from './imageExport'
import { frameTimes, pickClipFormat } from './videoExport'

export interface ClipRequest {
  width: number
  height: number
  /** How many frames the clip is made of. */
  frames: number
  /** Frames per second the clip is paced at. */
  fps: number
  /** Out and back, or one way. See `frameTimes`. */
  style: 'loop' | 'pingpong'
  /** Put the motion at `t` (0..1). The caller owns this — only it knows the mode. */
  step(t: number): void
  /** Reports frames done, for a menu that would otherwise look frozen. */
  onProgress?(done: number, total: number): void
}

export interface CaptureHandle {
  /** Render the live scene at an exact pixel size; resolves a PNG data URL. */
  capture(width: number, height: number): Promise<string>
  /** Step the motion frame by frame and record it. Rejects with a readable reason. */
  recordClip(request: ClipRequest): Promise<{ blob: Blob; extension: string }>
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
    /**
     * Put the scene into export shape, run `body`, and put it back however
     * that goes.
     *
     * **It resizes the DOM, not the renderer.** Calling r3f's `setSize` is
     * the obvious move and it does not hold: r3f re-runs a configure block on
     * every render of `<Canvas>`, and that block measures
     * `canvas.parentElement` and resets `size` and `dpr` back to what the
     * container says. Any store write during a capture — and stage mode makes
     * several, `onQualityChange` among them — silently reverted the export to
     * viewport size. Sizing the container instead makes r3f's own model agree
     * with the export, so re-renders re-assert the size we want rather than
     * fighting it, and the composer and dpr follow for free.
     *
     * The container is sized in CSS pixels that come to exactly the requested
     * DEVICE pixels at the live dpr, so the file is the size that was asked
     * for on any monitor without touching r3f's dpr at all.
     *
     * Restoring is a `finally` and there is one of them rather than one per
     * caller, because getting it half right is how an export leaves the
     * viewport 1080×1920 with the grab handle missing.
     */
    const framed = async <T,>(width: number, height: number, body: () => Promise<T>): Promise<T> => {
      const { camera, scene, gl } = latest.current
      const canvas = gl.domElement as HTMLCanvasElement
      // Two different elements, and confusing them is what made the first
      // attempt at this leave the editor stretched. `container` is the
      // canvas's direct parent, which is the element r3f measures. `panel` is
      // the editor's own grid track, which is what GROWS when an oversized
      // canvas sits in it — and a grown track is a container that measures
      // large, which is a canvas that stays large: a loop that sustains
      // itself long after the export is over.
      const container = canvas.parentElement
      const panel = canvas.closest('.viewport') as HTMLElement | null
      if (!container || !panel) throw new Error('the canvas is not mounted where it was expected')

      const dpr = latest.current.viewport.dpr || 1
      const perspective = camera as PerspectiveCamera
      const fov = perspective.fov
      // Measured BEFORE anything is touched. The panel is a grid track that
      // sizes to its contents, so once an oversized canvas has been in it the
      // track has grown — and measuring on the way out reads the inflated
      // number and restores the editor to the export's size.
      const home = container.getBoundingClientRect()
      const restore = {
        container: container.getAttribute('style'),
        panel: panel.getAttribute('style'),
      }
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
        perspective.fov = fitFov(fov, canvas.width / canvas.height, width / height)
        perspective.updateProjectionMatrix()
        // Out of flow, so an export frame larger than the panel it sits in
        // does not push the rest of the editor around for the two seconds it
        // takes; clipped, so it does not paint over the panels either. The
        // panel is pinned at its own size for the same reason: it is a grid
        // track that sizes to its contents, and a 1920px canvas in it moves
        // every other panel on the screen.
        panel.style.overflow = 'hidden'
        panel.style.width = `${panel.clientWidth}px`
        panel.style.height = `${panel.clientHeight}px`
        container.style.position = 'absolute'
        container.style.top = '0'
        container.style.left = '0'
        container.style.width = `${width / dpr}px`
        container.style.height = `${height / dpr}px`
        await drawnAt(width, height)
        return await body()
      } finally {
        for (const object of chrome) object.visible = true
        perspective.fov = fov
        perspective.updateProjectionMatrix()
        // Written back verbatim: these elements are styled by the stylesheet,
        // and clearing individual properties would leave whatever this set.
        if (restore.container === null) container.removeAttribute('style')
        else container.setAttribute('style', restore.container)
        if (restore.panel === null) panel.removeAttribute('style')
        else panel.setAttribute('style', restore.panel)
        // Putting the styles back is not enough. r3f reads the container in a
        // configure block that runs on RENDER, so with nothing re-rendering
        // afterwards the editor sat at the export's size with the canvas
        // hanging over the panels until something else happened to touch
        // state. Hand it the size the panel had before any of this.
        // r3f reads the container in a configure block that runs on RENDER,
        // so with nothing re-rendering afterwards the canvas would keep the
        // export's size until something unrelated touched state. Hand it the
        // size the panel had before any of this, and write the canvas's own
        // inline size back by hand in the same breath so that anything which
        // re-renders in the next beat — stage mode resumes its walk right
        // here — measures a panel that is already the right size again.
        if (home.width > 0 && home.height > 0) await settleBackTo(canvas, home, latest)
      }
    }

    handleRef.current = {
      capture(width: number, height: number) {
        return framed(width, height, async () => latest.current.gl.domElement.toDataURL('image/png'))
      },

      /**
       * Record the motion by stepping it, not by watching it.
       *
       * `captureStream(0)` is a stream with no frame rate of its own and
       * `requestFrame()` pushes exactly one frame into it, so the app decides
       * which frames exist. That is what `tools/media.mjs` buys with ffmpeg
       * and frame-by-frame rendering: no dropped frames and no compositor
       * jitter, on any machine.
       *
       * The loop is PACED to the target frame rate rather than run flat out,
       * because `MediaRecorder` timestamps frames by wall clock — pushing 72
       * frames as fast as they render would produce a correct sequence
       * played at whatever speed the machine happened to manage.
       */
      async recordClip({ width, height, frames, fps, style, step, onProgress }) {
        const canvas = latest.current.gl.domElement as HTMLCanvasElement & {
          captureStream?(frameRate?: number): MediaStream
        }
        if (typeof MediaRecorder === 'undefined' || !canvas.captureStream) {
          throw new Error('this browser cannot record a canvas')
        }
        const format = pickClipFormat()
        if (!format) throw new Error('this browser has no video format it can encode')

        return framed(width, height, async () => {
          // MediaRecorder locks the clip's dimensions when the stream opens,
          // so a canvas that has not finished resizing yields a whole clip at
          // the wrong size — which looks like a working feature that ignores
          // the frame you picked. Refuse rather than record that.
          if (canvas.width !== width || canvas.height !== height) {
            const r3f = latest.current.size
            throw new Error(
              `canvas ${canvas.width}×${canvas.height}, r3f ${r3f.width}×${r3f.height}, wanted ${width}×${height}`,
            )
          }
          const stream = canvas.captureStream!(0)
          const track = stream.getVideoTracks()[0] as MediaStreamTrack & { requestFrame?(): void }
          // Without it every frame would have to be paced by hope: the stream
          // would emit on its own schedule and the stepping would be decor.
          if (!track?.requestFrame) throw new Error('this browser cannot be asked for exact frames')

          const chunks: BlobPart[] = []
          const recorder = new MediaRecorder(stream, {
            mimeType: format.mimeType,
            videoBitsPerSecond: 12_000_000,
          })
          recorder.ondataavailable = (e) => {
            if (e.data.size > 0) chunks.push(e.data)
          }
          const finished = new Promise<void>((resolve, reject) => {
            recorder.onstop = () => resolve()
            recorder.onerror = () => reject(new Error('the recorder stopped early'))
          })

          recorder.start()
          const interval = 1000 / fps
          const startedAt = performance.now()
          const times = frameTimes(frames, style)
          for (let i = 0; i < times.length; i++) {
            step(times[i]!)
            // Two frames: one for the step to reach the scene through React
            // and the deformer stack, one to draw it.
            await nextFrame()
            await nextFrame()
            // Hold until this frame's slot, so the clip plays at `fps`.
            while (performance.now() - startedAt < i * interval) await nextFrame()
            track.requestFrame()
            onProgress?.(i + 1, times.length)
          }
          // One slot's worth of tail, so the last frame has a duration rather
          // than being cut off the moment it is pushed.
          await new Promise((resolve) => setTimeout(resolve, interval))
          recorder.stop()
          await finished
          for (const t of stream.getTracks()) t.stop()
          return { blob: new Blob(chunks, { type: format.mimeType }), extension: format.extension }
        })
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
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

/**
 * Put the canvas back to the size the panel had, and keep putting it back
 * until it stays.
 *
 * One assignment is not enough and neither are two. r3f watches the
 * container with a ResizeObserver and re-asserts from a `<Canvas>` render on
 * top of that, so there are two independent writers with notifications
 * already in flight when an export ends — and whichever of them lands last
 * wins. A stale 1920 landing after the restore regrows the panel, and a
 * grown panel measures large, which keeps the canvas large: the loop
 * sustains itself and the editor never comes back.
 *
 * So this is a poll, the same shape as `drawnAt` and for the same reason:
 * the DOM is the thing that has to agree, and the only way to know it agrees
 * is to look. It stops once the size has held for several consecutive
 * frames, and gives up rather than spinning if something else owns the size
 * for good.
 */
async function settleBackTo(
  canvas: HTMLCanvasElement,
  home: { width: number; height: number },
  latest: { current: { setSize(width: number, height: number): void } },
  budget = 45,
): Promise<void> {
  let held = 0
  for (let i = 0; i < budget && held < 4; i++) {
    if (Math.abs(canvas.clientWidth - home.width) < 1 && Math.abs(canvas.clientHeight - home.height) < 1) {
      held++
    } else {
      held = 0
      canvas.style.width = `${home.width}px`
      canvas.style.height = `${home.height}px`
      latest.current.setSize(home.width, home.height)
    }
    await nextFrame()
  }
}

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
