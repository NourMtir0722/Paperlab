import * as THREE from 'three'
import { useEffect, useMemo } from 'react'
import CustomShaderMaterial from 'three-custom-shader-material'
import type { LightingName, SurfaceConfig } from '../config/schema'
import type { Stock } from '../core/stock'
import { composeSurface } from './compose'

export interface PaperMaterialProps {
  stock: Stock
  texture: THREE.Texture | null
  /** content.back rendered on the reverse side (stock color otherwise). */
  backTexture?: THREE.Texture | null
  surface: SurfaceConfig
  thickness: number
  /** World dims — perforation holes are sized in world units. */
  sheet?: { width: number; height: number }
  /** Scene lighting — transmission is measured against its key light. */
  lighting?: LightingName
}

/**
 * The paper's skin: MeshStandardMaterial (real lighting preserved) extended
 * with the composed surface-effect chunks. Content textures are sampled by
 * OUR fragment (not material.map) so front and back faces can differ — real
 * paper doesn't mirror its front through the sheet. Programs rebuild only
 * on structure change; value edits mutate uniforms in place.
 */
export function PaperMaterial({
  stock,
  texture,
  backTexture,
  surface,
  thickness,
  sheet,
  lighting = 'studio',
}: PaperMaterialProps) {
  const composed = composeSurface(
    surface,
    stock,
    thickness,
    {
      hasFrontMap: Boolean(texture),
      hasBackMap: Boolean(backTexture),
    },
    sheet,
    lighting,
  )

  // Uniform objects bound to the current program; stable per structure.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const bound = useMemo(() => composed.uniforms, [composed.structureKey])
  useEffect(() => {
    for (const [key, uniform] of Object.entries(composed.uniforms)) {
      if (!bound[key] || key === 'uFrontMap' || key === 'uBackMap') continue
      if (bound[key].value instanceof THREE.Color && uniform.value instanceof THREE.Color) {
        ;(bound[key].value as THREE.Color).copy(uniform.value)
      } else {
        bound[key].value = uniform.value
      }
    }
  })
  useEffect(() => {
    if (bound.uFrontMap) bound.uFrontMap.value = texture
    if (bound.uBackMap) bound.uBackMap.value = backTexture ?? null
  }, [bound, texture, backTexture])

  return (
    <CustomShaderMaterial
      key={composed.structureKey}
      baseMaterial={THREE.MeshStandardMaterial}
      vertexShader={composed.vertexShader}
      fragmentShader={composed.fragmentShader}
      uniforms={bound}
      color="#ffffff"
      roughness={stock.roughness}
      metalness={0}
      transparent={stock.opacity < 1}
      opacity={stock.opacity}
      alphaTest={composed.alphaTest}
      side={THREE.DoubleSide}
    />
  )
}
