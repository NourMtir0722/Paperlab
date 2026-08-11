import * as THREE from 'three'
import { gsap } from 'gsap'
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import CustomShaderMaterial from 'three-custom-shader-material'
import { getStock } from '../core/stock'
import { createSheetGeometry } from '../core/sheet'
import { getBehavior } from '../behaviors/registry'
import { stackMinSegments } from '../deformers/compose'
import type { DeformerInstance } from '../deformers/types'
import type { AeroPose } from '../physics/aero'
import { useContentAtlas } from '../content/atlas'
import {
  buildDisplacementGLSL,
  buildFieldFragmentShader,
  buildFieldVertexShader,
  stackUniformValues,
} from './compose'
import { getLayout, type PaperPose } from './layouts'
import type { FieldGroupData } from './slots'

const scratchObj = new THREE.Object3D()
const scratchAero: AeroPose = { position: [0, 0, 0], rotation: [0, 0, 0] }
export const FIELD_SEGMENT_CAP = 48

/** Motion state shared across groups so a mixed-preset field moves as one field. */
export interface SharedMotion {
  phaseRef: React.MutableRefObject<number>
  mountTimeRef: React.MutableRefObject<number>
  morphRef: React.MutableRefObject<{ from: { id: string; options: unknown } | null; t: number }>
  layoutId: string
  layoutOptions: Record<string, unknown>
  entranceType: 'rise' | 'scatter' | 'none'
  stagger: number
  entranceDuration: number
  total: number
  reduced: boolean
}

/** One instanced mesh: one preset's sheet/stock/behavior across its slots. */
export function FieldGroup({ group, shared }: { group: FieldGroupData; shared: SharedMotion }) {
  const { config, indices, contents } = group
  const count = indices.length
  const stock = getStock(config.stock)
  const behavior = config.behavior ? getBehavior(config.behavior.type) : null

  const progressRef = useRef(
    behavior ? ((config.behavior as Record<string, unknown>)[behavior.progressParam] as number) : 0,
  )
  const buildStackAt = (progress: number): DeformerInstance[] => {
    if (!config.behavior || !behavior) return []
    const options = { ...config.behavior, [behavior.progressParam]: progress }
    return behavior.stack(options, config.sheet)
  }
  const initialStack = useMemo(
    () => buildStackAt(progressRef.current),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(config.behavior ?? null), JSON.stringify(config.sheet)],
  )
  const structureKey = initialStack.map((i) => i.type).join('|')

  const geometry = useMemo(() => {
    const geo = createSheetGeometry(
      {
        ...config.sheet,
        segments:
          config.sheet.segments === 'auto' ? 'auto' : Math.min(config.sheet.segments, FIELD_SEGMENT_CAP),
      },
      Math.min(stackMinSegments(initialStack), FIELD_SEGMENT_CAP),
    )
    const atlasIdx = new Float32Array(count)
    const phase = new Float32Array(count)
    const bias = new Float32Array(count).fill(1)
    for (let i = 0; i < count; i++) {
      atlasIdx[i] = i
      phase[i] = ((indices[i]! * 0.618034) % 1) * 4 // golden-ratio spread by global slot
    }
    geo.setAttribute('aAtlas', new THREE.InstancedBufferAttribute(atlasIdx, 1))
    geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1))
    // Per-sheet deformation strength, written from the layout's pose each
    // frame — how a single instanced draw call bends every sheet differently.
    geo.setAttribute('aBias', new THREE.InstancedBufferAttribute(bias, 1))
    return geo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(config.sheet), structureKey, count])

  // Imperatively created — R3F won't auto-dispose a geometry passed via args.
  useEffect(() => () => geometry.dispose(), [geometry])

  const atlas = useContentAtlas(contents, config.sheet, stock)

  const shader = useMemo(() => {
    const composed = buildDisplacementGLSL(initialStack, config.sheet)
    const uniforms: Record<string, { value: unknown }> = {}
    for (const [name, value] of Object.entries(composed.uniforms)) {
      uniforms[name] = {
        value: Array.isArray(value) && value.length === 2 ? new THREE.Vector2(...value) : value,
      }
    }
    uniforms.uPlTime = { value: 0 }
    uniforms.uAtlas = { value: null }
    uniforms.uAtlasGrid = { value: new THREE.Vector2(1, 1) }
    uniforms.uBackDarken = {
      value: 1 - Math.min(0.45, 0.12 + config.sheet.thickness * 0.9) * stock.opacity,
    }
    uniforms.uStockColor = { value: new THREE.Color(stock.color) }
    uniforms.uShowThrough = { value: config.surface.showThrough ?? stock.showThrough }
    return {
      vertexShader: buildFieldVertexShader(composed),
      fragmentShader: buildFieldFragmentShader(),
      uniforms,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structureKey, JSON.stringify(config.sheet), stock.id, config.surface.showThrough])

  useEffect(() => {
    if (!atlas) return
    shader.uniforms.uAtlas!.value = atlas.texture
    ;(shader.uniforms.uAtlasGrid!.value as THREE.Vector2).set(atlas.cols, atlas.rows)
  }, [atlas, shader])

  // Behavior progress loops on GSAP — the field is always alive.
  useEffect(() => {
    if (!behavior || shared.reduced) return
    const state = { p: progressRef.current }
    const tween = gsap.to(state, {
      p: 1,
      duration: behavior.duration * Math.max(0.05, 1 - state.p),
      ease: 'power2.inOut',
      yoyo: behavior.loopMode === 'yoyo',
      repeat: -1,
      onUpdate: () => {
        progressRef.current = state.p
      },
    })
    return () => {
      tween.kill()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structureKey, shared.reduced])

  const meshRef = useRef<THREE.InstancedMesh>(null)

  useFrame(({ clock }) => {
    const mesh = meshRef.current
    if (!mesh) return
    const elapsed = clock.elapsedTime - Math.max(shared.mountTimeRef.current, 0)

    shader.uniforms.uPlTime!.value = shared.reduced ? 0 : clock.elapsedTime
    if (behavior) {
      const values = stackUniformValues(buildStackAt(progressRef.current), config.sheet)
      for (const [name, value] of Object.entries(values)) {
        const uniform = shader.uniforms[name]
        if (!uniform) continue
        if (uniform.value instanceof THREE.Vector2 && Array.isArray(value)) {
          uniform.value.set(value[0]!, value[1]!)
        } else {
          uniform.value = value
        }
      }
    }

    const layout = getLayout(shared.layoutId)
    const morph = shared.morphRef.current
    const behaviorTransform = behavior?.transform && config.behavior ? behavior : null
    const biasAttr = geometry.getAttribute('aBias') as THREE.InstancedBufferAttribute
    const biases = biasAttr.array as Float32Array
    let biasChanged = false
    for (let j = 0; j < count; j++) {
      const i = indices[j]!
      let pose = layout.pose(i, shared.total, shared.layoutOptions, shared.phaseRef.current)
      if (morph.from && morph.t < 1) {
        const prev = getLayout(morph.from.id).pose(
          i,
          shared.total,
          morph.from.options,
          shared.phaseRef.current,
        )
        pose = lerpPose(prev, pose, easeInOut(morph.t))
      }
      if (shared.entranceType !== 'none') {
        const tIn = Math.min(1, Math.max(0, (elapsed - i * shared.stagger) / shared.entranceDuration))
        if (tIn < 1) {
          pose = lerpPose(entrancePose(shared.entranceType, i, pose), pose, easeOut(tIn))
        }
      }
      const bias = Math.min(1, Math.max(0, pose.bias ?? 1))
      if (biases[j] !== bias) {
        biases[j] = bias
        biasChanged = true
      }
      scratchObj.position.set(...pose.position)
      scratchObj.rotation.set(...pose.rotation)
      scratchObj.scale.setScalar(pose.scale)
      // Behavior whole-sheet transforms (flight) run per instance, offset in
      // time by the same golden-ratio phase the shader flutter uses — pure
      // functions of t, so instancing stays exact.
      if (behaviorTransform) {
        const pose2 = scratchAero
        pose2.position[0] = pose2.position[1] = pose2.position[2] = 0
        pose2.rotation[0] = pose2.rotation[1] = pose2.rotation[2] = 0
        const t = shared.reduced ? 0 : clock.elapsedTime + ((i * 0.618034) % 1) * 4
        behaviorTransform.transform!(
          { ...config.behavior, [behaviorTransform.progressParam]: progressRef.current },
          t,
          pose2,
        )
        scratchObj.position.x += pose2.position[0]
        scratchObj.position.y += pose2.position[1]
        scratchObj.position.z += pose2.position[2]
        scratchObj.rotation.x += pose2.rotation[0]
        scratchObj.rotation.y += pose2.rotation[1]
        scratchObj.rotation.z += pose2.rotation[2]
      }
      scratchObj.updateMatrix()
      mesh.setMatrixAt(j, scratchObj.matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
    if (biasChanged) biasAttr.needsUpdate = true
  })

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, undefined, count]}
      frustumCulled={false}
      castShadow
      receiveShadow
    >
      <CustomShaderMaterial
        key={`${structureKey}:${count}`}
        baseMaterial={THREE.MeshStandardMaterial}
        vertexShader={shader.vertexShader}
        fragmentShader={shader.fragmentShader}
        uniforms={shader.uniforms}
        roughness={stock.roughness}
        metalness={0}
        side={THREE.DoubleSide}
      />
    </instancedMesh>
  )
}

function entrancePose(type: 'rise' | 'scatter', i: number, target: PaperPose): PaperPose {
  if (type === 'rise') {
    return {
      position: [target.position[0], target.position[1] - 3.2, target.position[2] - 0.5],
      rotation: [target.rotation[0] - 0.7, target.rotation[1], target.rotation[2] + 0.25],
      scale: target.scale * 0.85,
      bias: target.bias,
    }
  }
  const a = i * 2.399
  return {
    position: [Math.cos(a) * 7, Math.sin(a * 1.3) * 4, Math.sin(a) * 6],
    rotation: [Math.sin(a) * 2, a, Math.cos(a) * 2],
    scale: target.scale * 0.6,
    bias: target.bias,
  }
}

function lerpPose(a: PaperPose, b: PaperPose, t: number): PaperPose {
  const lerp = (x: number, y: number) => x + (y - x) * t
  return {
    position: [
      lerp(a.position[0], b.position[0]),
      lerp(a.position[1], b.position[1]),
      lerp(a.position[2], b.position[2]),
    ],
    rotation: [
      lerp(a.rotation[0], b.rotation[0]),
      lerp(a.rotation[1], b.rotation[1]),
      lerp(a.rotation[2], b.rotation[2]),
    ],
    scale: lerp(a.scale, b.scale),
    bias: lerp(a.bias ?? 1, b.bias ?? 1),
  }
}

const easeOut = (t: number) => 1 - (1 - t) ** 3
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2)
