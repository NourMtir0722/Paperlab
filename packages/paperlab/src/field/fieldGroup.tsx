import * as THREE from 'three'
import { gsap } from 'gsap'
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import CustomShaderMaterial from 'three-custom-shader-material'
import { getStock } from '../core/stock'
import { createSheetGeometry } from '../core/sheet'
import { getBehavior } from '../behaviors/registry'
import { stackAutoSegments, stackMinSegments } from '../deformers/compose'
import type { SegmentPair } from '../core/tessellation'
import type { DeformerInstance, SheetDims } from '../deformers/types'
import type { AeroPose } from '../physics/aero'
import { useContentAtlas } from '../content/atlas'
import {
  buildDisplacementGLSL,
  buildFieldFragmentShader,
  buildFieldVertexShader,
  stackUniformValues,
} from './compose'
import { getLayout, type PaperPose } from './layouts'
import { translucencyUniforms, translucencyValues } from '../surface/translucency'
import { useLightRig } from '../scene/rig'
import { fieldShapeStack } from './stack'
import type { FieldGroupData } from './slots'

const scratchObj = new THREE.Object3D()
const scratchAero: AeroPose = { position: [0, 0, 0], rotation: [0, 0, 0] }
/**
 * Caps the FLOOR a deformer stack can demand of a field instance. Field mode
 * trades a deformer's stated minimum for instance count, which hero mode
 * never does.
 */
export const FIELD_SEGMENT_CAP = 48

/**
 * Caps what `'auto'` may ASK for in a field, as distinct from the floor above.
 *
 * It used to sit at the old flat 72 on the grounds that a field draws this
 * buffer once per instance — a real argument, made when nothing else could
 * hold the count down. Two things changed. The demand now lands on the axis
 * that bends rather than being spread over both, so a banner asking 128
 * across asks 8 down and the buffer grows on one side only. And
 * `segmentCeiling` gives the caller a working lever, which is what the
 * quality tiers now use: `low` and `medium` cap themselves well below this
 * line, so raising it only raises what a machine that measured fast enough
 * is allowed to ask for.
 *
 * 128, matching what a hero sheet was allowed before the hero ceiling moved
 * to 192. A field still asks for less than one sheet does, which is the
 * asymmetry worth keeping.
 */
export const FIELD_AUTO_CEILING = 128

/** Mirrors the hero path's sweep sampling — see PaperMesh. */
const PROGRESS_SAMPLES = [0, 0.25, 0.5, 0.75, 1] as const

/** Motion state shared across groups so a mixed-preset field moves as one field. */
export interface SharedMotion {
  phaseRef: React.MutableRefObject<number>
  mountTimeRef: React.MutableRefObject<number>
  morphRef: React.MutableRefObject<{ from: { id: string; options: unknown } | null; t: number }>
  layoutId: string
  layoutOptions: Record<string, unknown>
  /** The field's paper size — one sheet for every group, so layouts agree. */
  sheet: SheetDims
  entranceType: 'rise' | 'scatter' | 'none'
  stagger: number
  entranceDuration: number
  total: number
  reduced: boolean
}

/** Opting a mesh out of raycasting entirely — cheaper than testing and discarding. */
const NO_RAYCAST = () => {}

/** One instanced mesh: one preset's sheet/stock/behavior across its slots. */
export function FieldGroup({
  group,
  shared,
  onSelect,
  segmentCeiling,
}: {
  group: FieldGroupData
  shared: SharedMotion
  /** Called with the paper's GLOBAL index — a group only holds the slots that share its preset. */
  onSelect?: (paper: number) => void
  /** Lowers what `'auto'` may ask for on this group's sheet. Never raises it. */
  segmentCeiling?: number
}) {
  const autoCeiling = Math.min(segmentCeiling ?? FIELD_AUTO_CEILING, FIELD_AUTO_CEILING)
  const { config, indices, contents } = group
  const count = indices.length
  const stock = getStock(config.stock)
  // The scene's rig if it publishes one — in a stage the banners are lit by
  // the hall, not by the preset each one happens to carry.
  const rig = useLightRig(config.scene.lighting)
  // A raw deformer stack is the Advanced fork of a behavior and wins over one
  // — the same precedence the hero path's buildStack applies. Field mode used
  // to read `behavior` only, so a preset shaped by `deformers` rendered flat.
  const behavior = config.behavior && !config.deformers ? getBehavior(config.behavior.type) : null

  const progressRef = useRef(
    behavior ? ((config.behavior as Record<string, unknown>)[behavior.progressParam] as number) : 0,
  )
  const buildStackAt = (progress: number): DeformerInstance[] => fieldShapeStack(config, progress)
  // biome-ignore lint/correctness/useExhaustiveDependencies: Serialized deps — the stack rebuilds on shape, not on identity.
  const initialStack = useMemo(
    () => buildStackAt(progressRef.current),
    [
      JSON.stringify(config.behavior ?? null),
      JSON.stringify(config.deformers ?? null),
      JSON.stringify(config.sheet),
    ],
  )
  const structureKey = initialStack.map((i) => i.type).join('|')

  // biome-ignore lint/correctness/useExhaustiveDependencies: Keyed on sheet, stack structure, count and the ceiling — the only things that change the buffer.
  const geometry = useMemo(() => {
    const floor = stackMinSegments(initialStack, config.sheet)
    // Same sweep-sampling as the hero path: one buffer serves every instance
    // for the whole play, so it has to hold the densest moment of it, not the
    // current one.
    const want: SegmentPair = [0, 0]
    for (const p of PROGRESS_SAMPLES) {
      const [x, y] = stackAutoSegments(buildStackAt(p), config.sheet)
      if (x > want[0]) want[0] = x
      if (y > want[1]) want[1] = y
    }
    const geo = createSheetGeometry(
      {
        ...config.sheet,
        segments:
          config.sheet.segments === 'auto' ? 'auto' : Math.min(config.sheet.segments, FIELD_SEGMENT_CAP),
      },
      [Math.min(floor[0], FIELD_SEGMENT_CAP), Math.min(floor[1], FIELD_SEGMENT_CAP)],
      // Bounded by the auto ceiling and NOT by FIELD_SEGMENT_CAP, which is a
      // floor cap and stays one. Capping the target as well looked tidy and
      // was a visual regression: it is the only thing that could have held
      // `crumple` — whose creases have no target, only a floor of 72 — down
      // to 48 in a field, which is coarser than the deformer says it needs to
      // look like a crumple at all.
      [Math.min(want[0], autoCeiling), Math.min(want[1], autoCeiling)],
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
  }, [JSON.stringify(config.sheet), structureKey, count, autoCeiling])

  // Imperatively created — R3F won't auto-dispose a geometry passed via args.
  useEffect(() => () => geometry.dispose(), [geometry])

  const atlas = useContentAtlas(contents, config.sheet, stock)

  // biome-ignore lint/correctness/useExhaustiveDependencies: Keyed on the stack structure — uniforms update in place, the program does not.
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
    // Transmission reads the scene's own key light, so a backlit sheet can
    // never disagree with the lamp casting its shadow.
    Object.assign(uniforms, translucencyUniforms(config.surface.translucency ?? stock.translucency, rig))
    return {
      vertexShader: buildFieldVertexShader(composed),
      fragmentShader: buildFieldFragmentShader(),
      uniforms,
    }
  }, [
    structureKey,
    JSON.stringify(config.sheet),
    stock.id,
    config.surface.showThrough,
    config.surface.translucency,
  ])

  // Moving a light writes four uniforms; it must never recompile a program,
  // which is what putting the rig in the memo above would have done on every
  // frame of a slider drag.
  useEffect(() => {
    const values = translucencyValues(config.surface.translucency ?? stock.translucency, rig)
    shader.uniforms.uTranslucency!.value = values.translucency
    ;(shader.uniforms.uBackLightDir!.value as THREE.Vector3).copy(values.direction)
    ;(shader.uniforms.uBackLightColor!.value as THREE.Color).copy(values.color)
    shader.uniforms.uAmbientTransmission!.value = values.ambient
  }, [shader, rig, config.surface.translucency, stock.translucency])

  useEffect(() => {
    if (!atlas) return
    shader.uniforms.uAtlas!.value = atlas.texture
    ;(shader.uniforms.uAtlasGrid!.value as THREE.Vector2).set(atlas.cols, atlas.rows)
  }, [atlas, shader])

  // Behavior progress loops on GSAP — the field is always alive.
  // biome-ignore lint/correctness/useExhaustiveDependencies: Keyed on the behavior itself; progress lives on a ref so the tween is not restarted each render.
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
      let pose = layout.pose(i, shared.total, shared.layoutOptions, shared.phaseRef.current, shared.sheet)
      if (morph.from && morph.t < 1) {
        const prev = getLayout(morph.from.id).pose(
          i,
          shared.total,
          morph.from.options,
          shared.phaseRef.current,
          shared.sheet,
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
    // biome-ignore lint/a11y/noStaticElementInteractions: An R3F <instancedMesh> is a three.js object, not a DOM node — it has no role to give and no keyboard to receive. The keyboard route into the same action is on the canvas, which `useWalk` makes focusable and drives with the arrow keys.
    <instancedMesh
      ref={meshRef}
      args={[geometry, undefined, count]}
      frustumCulled={false}
      castShadow
      receiveShadow
      // Only raycastable when somebody is listening: hit-testing an instanced
      // mesh is per-instance work on every pointer move, and this is the mode
      // that puts hundreds of instances on screen at once. Spread rather than
      // `raycast={undefined}`, which does not mean "leave the default" — it
      // assigns undefined over the method three is about to call.
      {...(onSelect ? {} : { raycast: NO_RAYCAST })}
      onClick={
        onSelect &&
        ((event) => {
          if (event.instanceId === undefined) return
          // `instanceId` counts within THIS group; the layout — and anything
          // that wants to know which paper was clicked — counts across all of
          // them, so the group's own index list is the translation.
          const paper = indices[event.instanceId]
          if (paper === undefined) return
          event.stopPropagation()
          onSelect(paper)
        })
      }
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
