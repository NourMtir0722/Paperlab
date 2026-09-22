import { REVISION } from 'three'

/**
 * The shadow filter every canvas the library owns asks for.
 *
 * `<Canvas shadows>` means PCFSoftShadowMap, which three removed in r186: it
 * falls back to PCFShadowMap and warns every time a renderer's shadow map
 * is reset. So ask for PCF by name where soft is gone, and keep soft where
 * it still exists, so a consumer on an older three sees what they always did.
 */
export const CANVAS_SHADOWS: 'percentage' | 'soft' =
  Number.parseInt(REVISION, 10) >= 186 ? 'percentage' : 'soft'
