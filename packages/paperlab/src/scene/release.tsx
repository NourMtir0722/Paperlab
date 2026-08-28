import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'

/**
 * Hands the WebGL context back when the canvas unmounts.
 *
 * A browser gives a page about sixteen live WebGL contexts and then starts
 * killing the oldest to make room. Anything that mounts and unmounts paper as
 * it scrolls — the reference page is forty-odd cards doing exactly that — goes
 * over that ceiling not because too many sheets are on screen at once, but
 * because the ones that left never gave their context back.
 *
 * React Three Fiber disposes the renderer's own resources on unmount, and that
 * is not the same thing: the drawing context itself survives until the garbage
 * collector gets to the canvas, which is whenever it likes. `forceContextLoss`
 * is three.js's way of saying *now*, and it is the documented one.
 *
 * Measured on the reference page before this existed: one scroll to the bottom
 * produced 101 "Too many active WebGL contexts" warnings at a peak of thirteen
 * simultaneous canvases — comfortably under the cap, and still exhausting it.
 * Nothing was visibly blank, because a card that scrolls back into view
 * remounts and builds a fresh context; the cost was paid in that churn.
 *
 * Rendered inside a `<Canvas>`, where `useThree` can reach the renderer.
 */
export function ReleaseContextOnUnmount() {
  const gl = useThree((s) => s.gl)
  useEffect(
    () => () => {
      // Both, in this order. `forceContextLoss` releases the context and
      // `dispose` releases what the renderer still holds against it; calling
      // dispose alone is what leaves the context standing.
      gl.forceContextLoss()
      gl.dispose()
    },
    [gl],
  )
  return null
}
