import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import type { DamageSource } from './damageContract'

/**
 * A `DamageSource` as a texture the surface shader can sample.
 *
 * The texture wraps the source's own `pixels` array — no copy — and is
 * re-uploaded only on a frame where `version` has moved. A burning sheet
 * uploads 16 KB a frame at 64²; a sheet whose damage has stopped changing
 * uploads nothing, which is the same "costs nothing at rest" rule the field
 * itself follows.
 *
 * Linear filtering is what keeps a 64² grid from cutting holes as a staircase:
 * the shader cuts at presence one half, and bilinear interpolation turns that
 * into straight segments between texels. A hard-edged field still shows them
 * as facets; a graded one, which a real burn is, shows far fewer. No
 * mipmaps — the sheet is never far enough away for a 64² grid to alias.
 */
export function useDamageTexture(source: DamageSource | null | undefined): THREE.DataTexture | null {
  const texture = useMemo(() => {
    if (!source) return null
    const t = new THREE.DataTexture(
      source.pixels,
      source.size,
      source.size,
      THREE.RGBAFormat,
      THREE.UnsignedByteType,
    )
    t.magFilter = THREE.LinearFilter
    t.minFilter = THREE.LinearFilter
    t.wrapS = THREE.ClampToEdgeWrapping
    t.wrapT = THREE.ClampToEdgeWrapping
    t.generateMipmaps = false
    // Data, not colour. A colour-managed texture would be decoded as sRGB and
    // move every channel's midpoint — presence one half would stop being the
    // edge of the hole.
    t.colorSpace = THREE.NoColorSpace
    // Row 0 is v = 0, which is how the source writes it.
    t.flipY = false
    t.userData.version = source.version
    t.needsUpdate = true
    return t
  }, [source])

  // Imperatively-created, so ours to free — R3F disposes only what JSX made.
  useEffect(() => () => texture?.dispose(), [texture])

  useFrame(() => {
    if (!source || !texture) return
    if (texture.userData.version === source.version) return
    texture.userData.version = source.version
    texture.needsUpdate = true
  })

  return texture
}
