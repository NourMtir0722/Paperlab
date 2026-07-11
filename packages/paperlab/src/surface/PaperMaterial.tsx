import * as THREE from 'three'
import { useEffect, useMemo } from 'react'
import CustomShaderMaterial from 'three-custom-shader-material'
import type { SurfaceConfig } from '../config/schema'
import type { Stock } from '../core/stock'
import { composeSurface } from './compose'

export interface PaperMaterialProps {
  stock: Stock
  texture: THREE.Texture | null
  surface: SurfaceConfig
  thickness: number
}

/**
 * The paper's skin: MeshStandardMaterial (real lighting preserved) extended
 * with the composed surface-effect chunks. The program is rebuilt only when
 * the effect *structure* changes (keyed); value edits mutate uniforms in
 * place — sliders never recompile shaders.
 */
export function PaperMaterial({ stock, texture, surface, thickness }: PaperMaterialProps) {
  const composed = composeSurface(surface, stock, thickness)

  // Uniform objects bound to the current program; stable per structure.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const bound = useMemo(() => composed.uniforms, [composed.structureKey])
  useEffect(() => {
    for (const [key, uniform] of Object.entries(composed.uniforms)) {
      if (bound[key]) bound[key].value = uniform.value
    }
  })

  return (
    <CustomShaderMaterial
      // Remount on structure change, and when the async content texture
      // arrives — a program compiled without USE_MAP won't pick it up.
      key={`${composed.structureKey}:${texture ? 'map' : 'flat'}`}
      baseMaterial={THREE.MeshStandardMaterial}
      vertexShader={composed.vertexShader}
      fragmentShader={composed.fragmentShader}
      uniforms={bound}
      map={texture ?? undefined}
      color={texture ? '#ffffff' : stock.color}
      roughness={stock.roughness}
      metalness={0}
      transparent={stock.opacity < 1}
      opacity={stock.opacity}
      alphaTest={composed.alphaTest}
      side={THREE.DoubleSide}
    />
  )
}
