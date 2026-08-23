/**
 * What the two perf pages both need, so they cannot disagree about it.
 *
 * `stage.html` and `field.html` each sample frame times and report what drew
 * them, and each had grown its own copy of the sampling constants and of the
 * one function whose whole point is not being guessed at. They also reported
 * through differently-named globals — `__PERF__` and `__FIELD_PERF__` — which
 * meant the two Node harnesses that read them could not share a line either.
 * One shape, one name.
 *
 * The meters themselves stay separate. A stage counts programs, textures and
 * the peak triangle count across a frame's several passes; a field wants the
 * instanced draw-call count and nothing else. Those are different questions,
 * and forcing one component to ask both would be a worse trade than the
 * duplication it removed.
 */

/** Warm-up frames to discard: shader compiles and texture uploads land here. */
export const WARMUP = 25

declare global {
  interface Window {
    /**
     * Where a perf page leaves its numbers for `tools/*-perf.mjs` to read.
     * `done` is the signal to stop waiting; everything else is filled in at
     * that moment.
     */
    __PERF__?: {
      frames: number[]
      done: boolean
      triangles?: number
      drawCalls?: number
      programs?: number
      textures?: number
      geometries?: number
      tier?: string
      renderer?: string
    }
  }
}

/**
 * What ACTUALLY drew this, read off the driver rather than off the launch
 * flags.
 *
 * Headless Chromium hands out SwiftShader — its CPU rasterizer — far more
 * readily than `--use-gl` suggests, and for a while every number this repo
 * recorded came from one while being labelled a GPU number. A measurement
 * read as the wrong hardware is worse than no measurement.
 */
export function rendererName(ctx: WebGLRenderingContext | WebGL2RenderingContext): string {
  const ext = ctx.getExtension('WEBGL_debug_renderer_info')
  return ext ? String(ctx.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown'
}
