import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { cutDistance } from './cutDistance'
import type { DamageSource } from './damageContract'

/** What the surface shader samples for a burn. */
export interface DamageTextures {
  /** The source's own four channels. */
  damage: THREE.DataTexture
  /** How far each texel is from the cut — see `cutDistance`. */
  edge: THREE.DataTexture
}

/** World units per millimetre, the other way round: a default sheet is one unit, 210 mm, across. */
const MM_PER_WORLD = 210

/**
 * A `DamageSource` as the textures the surface shader samples.
 *
 * The damage texture wraps the source's own `pixels` array — no copy — and is
 * re-uploaded only on a frame where `version` has moved. A burning sheet
 * uploads 16 KB a frame at 64²; a sheet whose damage has stopped changing
 * uploads nothing, which is the same "costs nothing at rest" rule the field
 * itself follows.
 *
 * Beside it, the distance from the cut (`cutDistance`), worked out on the same
 * frames and no others: a quarter of the bytes, and a few thousand cells of
 * arithmetic.
 *
 * Linear filtering is what keeps a 64² grid from cutting holes as a staircase:
 * the shader cuts at presence one half, and bilinear interpolation turns that
 * into straight segments between texels. A hard-edged field still shows them
 * as facets; a graded one, which a real burn is, shows far fewer. No
 * mipmaps — the sheet is never far enough away for a 64² grid to alias.
 */
export function useDamageTexture(
  source: DamageSource | null | undefined,
  sheet: { width: number; height: number } = { width: 1, height: 1.4 },
): DamageTextures | null {
  const { width, height } = sheet
  const textures = useMemo(() => {
    if (!source) return null
    const damage = new THREE.DataTexture(
      source.pixels,
      source.size,
      source.size,
      THREE.RGBAFormat,
      THREE.UnsignedByteType,
    )
    const edge = new THREE.DataTexture(
      new Uint8Array(source.size * source.size),
      source.size,
      source.size,
      THREE.RedFormat,
      THREE.UnsignedByteType,
    )
    for (const t of [damage, edge]) {
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
      t.unpackAlignment = 1
    }
    measureEdge(source, edge, width, height)
    damage.userData.version = source.version
    damage.needsUpdate = true
    return { damage, edge }
  }, [source, width, height])

  // Imperatively-created, so ours to free — R3F disposes only what JSX made.
  useEffect(
    () => () => {
      textures?.damage.dispose()
      textures?.edge.dispose()
    },
    [textures],
  )

  useFrame(() => {
    if (!source || !textures) return
    if (textures.damage.userData.version === source.version) return
    textures.damage.userData.version = source.version
    textures.damage.needsUpdate = true
    measureEdge(source, textures.edge, width, height)
  })

  return textures
}

function measureEdge(source: DamageSource, edge: THREE.DataTexture, width: number, height: number): void {
  const last = Math.max(1, source.size - 1)
  cutDistance(
    source.pixels,
    source.size,
    [(width * MM_PER_WORLD) / last, (height * MM_PER_WORLD) / last],
    edge.image.data as Uint8Array,
  )
  edge.needsUpdate = true
}
