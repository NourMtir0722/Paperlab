import * as THREE from 'three'
import { useEffect, useMemo } from 'react'
import CustomShaderMaterial from 'three-custom-shader-material'
import type { LightingName, SurfaceConfig } from '../config/schema'
import type { Stock } from '../core/stock'
import { composeSurface } from './compose'
import { resolveCreases, type CreaseShading } from './creases'
import { useLightRig } from '../scene/rig'
import type { DamageSource } from './damageContract'
import { useDamageTexture } from './useDamageTexture'

export interface PaperMaterialProps {
  stock: Stock
  texture: THREE.Texture | null
  /** content.back rendered on the reverse side (stock color otherwise). */
  backTexture?: THREE.Texture | null
  surface: SurfaceConfig
  thickness: number
  /** World dims — perforation holes are sized in world units. */
  sheet?: { width: number; height: number }
  /**
   * Scene lighting — transmission is measured against its key light. A
   * `<LightRig>` above this material wins over it: in a stage the paper is
   * lit by the hall, not by the preset it was authored with.
   */
  lighting?: LightingName
  /**
   * Crease lines to draw, resolved from `surface.creaseLines` plus whatever
   * the sheet remembers being folded along. Left off, only the authored ones
   * render — which is what a material with no memory behind it should do.
   */
  creases?: CreaseShading[]
  /** Char, wet, heat and missing paper over the sheet's UV. See `DamageSource`. */
  damage?: DamageSource | null
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
  creases,
  damage,
}: PaperMaterialProps) {
  const rig = useLightRig(lighting)
  const damageTexture = useDamageTexture(damage)
  const composed = composeSurface(
    surface,
    stock,
    thickness,
    {
      hasFrontMap: Boolean(texture),
      hasBackMap: Boolean(backTexture),
      hasDamage: Boolean(damageTexture),
    },
    sheet,
    rig,
    creases ?? resolveCreases(surface, [], sheet ?? { width: 1, height: 1.4 }),
  )

  // Uniform objects bound to the current program; stable per structure.
  // biome-ignore lint/correctness/useExhaustiveDependencies: Uniform objects are bound per shader program — rebinding on value change would drop the binding every frame.
  const bound = useMemo(() => composed.uniforms, [composed.structureKey])
  useEffect(() => {
    for (const [key, uniform] of Object.entries(composed.uniforms)) {
      if (!bound[key] || key === 'uFrontMap' || key === 'uBackMap' || key === 'uDamage') continue
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
    if (bound.uDamage) bound.uDamage.value = damageTexture
  }, [bound, texture, backTexture, damageTexture])

  return (
    <>
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
      {/*
        What the shadow pass draws, when this sheet removes paper — see
        `ComposedSurface.depth`. Same uniforms object as the colour program,
        so the damage texture, the deckle and the perforation state are the
        ones the viewer sees. RGBA packing, which is what three's shadow maps
        read; three copies `side` and `alphaTest` over from the colour
        material itself.
      */}
      {composed.depth ? (
        <CustomShaderMaterial
          key={`${composed.structureKey}:depth`}
          attach="customDepthMaterial"
          baseMaterial={THREE.MeshDepthMaterial}
          vertexShader={composed.depth.vertexShader}
          fragmentShader={composed.depth.fragmentShader}
          uniforms={bound}
          depthPacking={THREE.RGBADepthPacking}
        />
      ) : null}
    </>
  )
}
