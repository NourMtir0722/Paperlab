import * as THREE from 'three'
import { gsap } from 'gsap'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { forwardRef, useEffect, useMemo, useRef } from 'react'
import type { ContentConfig, PaperConfig, PaperConfigInput } from './config/schema'
import { resolveConfig } from './PaperMesh'
import { getStock } from './core/stock'
import { createSheetGeometry } from './core/sheet'
import { getBehavior } from './behaviors/registry'
import { stackMinSegments } from './deformers/compose'
import type { DeformerInstance } from './deformers/types'
import {
  buildDisplacementGLSL,
  buildFieldFragmentShader,
  buildFieldVertexShader,
  stackUniformValues,
} from './field/compose'
import { getLayout, type PaperPose } from './field/layouts'
import { useContentAtlas } from './content/atlas'
import { usePrefersReducedMotion } from './a11y'
import CustomShaderMaterial from 'three-custom-shader-material'

/** A field slot references a preset — the spec's component/instance model. */
export interface FieldPaperSlot {
  preset?: string | PaperConfigInput
  content?: ContentConfig
}

export interface PaperFieldMeshProps {
  /** Per-paper slots; length sets the instance count. Slot presets override the shared one. */
  papers?: FieldPaperSlot[]
  /** Sugar: image URLs → papers with image content. */
  images?: string[]
  /** Shared preset for slots that don't name their own. */
  preset?: string | PaperConfigInput
  layout?: string
  layoutOptions?: Record<string, unknown>
  motion?: { driver?: 'autoplay' | 'drag' | 'none'; speed?: number }
  entrance?: { type?: 'rise' | 'scatter' | 'none'; stagger?: number; duration?: number }
  /** Override prefers-reduced-motion (default: follow the system setting). */
  reducedMotion?: boolean
}

export interface PaperFieldProps extends PaperFieldMeshProps {
  children?: React.ReactNode
  className?: string
  style?: React.CSSProperties
}

export interface FieldGroupData {
  config: PaperConfig
  /** Global slot indices this group renders (layout poses use global i / total n). */
  indices: number[]
  contents: ContentConfig[]
}

/** Group slots by resolved preset — one instanced draw call per distinct preset. */
export function groupFieldPapers(
  papers: FieldPaperSlot[],
  fallback?: string | PaperConfigInput,
): FieldGroupData[] {
  const groups = new Map<string, FieldGroupData>()
  papers.forEach((slot, i) => {
    const config = resolveConfig({ preset: slot.preset ?? fallback })
    const key = JSON.stringify(config)
    let group = groups.get(key)
    if (!group) {
      group = { config, indices: [], contents: [] }
      groups.set(key, group)
    }
    group.indices.push(i)
    group.contents.push(slot.content ?? config.content)
  })
  return [...groups.values()]
}

const scratchObj = new THREE.Object3D()
const FIELD_SEGMENT_CAP = 48

interface SharedMotion {
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

/**
 * Field mode: sheets render as one instanced draw call PER DISTINCT PRESET
 * (usually one). Deformer stacks run as composed GLSL vertex chunks
 * (parity-tested against the CPU path); content lives in per-group atlases;
 * motion state (driver phase, entrance clock, layout morph) is shared so
 * mixed-preset fields move as one field.
 */
export const PaperFieldMesh = forwardRef<THREE.Group, PaperFieldMeshProps>(
  function PaperFieldMesh(props, ref) {
    const reduced = usePrefersReducedMotion(props.reducedMotion)

    const papers = useMemo<FieldPaperSlot[]>(
      () =>
        props.papers ??
        (props.images
          ? props.images.map((src) => ({
              content: { type: 'image', src, fit: 'cover' } as ContentConfig,
            }))
          : Array.from({ length: 12 }, () => ({}))),
      [props.papers, props.images],
    )
    const groups = useMemo(
      () => groupFieldPapers(papers, props.preset),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [JSON.stringify(papers), JSON.stringify(props.preset ?? null)],
    )
    const total = papers.length

    const layoutId = props.layout ?? 'ring'
    const layout = getLayout(layoutId)
    const layoutOptions = useMemo(
      () => layout.optionsSchema.parse({ ...layout.defaults, ...props.layoutOptions }),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [layoutId, JSON.stringify(props.layoutOptions ?? {})],
    ) as Record<string, unknown>

    // ── Shared motion state: one driver phase / entrance clock / morph for
    // every group, so a mixed-preset field moves as one field. ──
    const phaseRef = useRef(0)
    const dragVelRef = useRef(0)
    const mountTimeRef = useRef(-1)
    const morphRef = useRef<SharedMotion['morphRef']['current']>({ from: null, t: 1 })
    const prevLayout = useRef({ id: layoutId, options: layoutOptions })
    const gl = useThree((s) => s.gl)

    const driver = reduced ? 'none' : (props.motion?.driver ?? 'autoplay')
    const speed = props.motion?.speed ?? 0.5
    const entranceType = reduced ? 'none' : (props.entrance?.type ?? 'rise')

    useEffect(() => {
      const prev = prevLayout.current
      if (prev.id !== layoutId || JSON.stringify(prev.options) !== JSON.stringify(layoutOptions)) {
        morphRef.current = { from: prev, t: 0 }
        gsap.to(morphRef.current, { t: 1, duration: 0.9, ease: 'power2.inOut' })
        prevLayout.current = { id: layoutId, options: layoutOptions }
      }
    }, [layoutId, layoutOptions])

    useEffect(() => {
      if (driver !== 'drag') return
      const el = gl.domElement
      let lastX: number | null = null
      const down = (e: PointerEvent) => {
        lastX = e.clientX
      }
      const move = (e: PointerEvent) => {
        if (lastX === null) return
        const dx = e.clientX - lastX
        lastX = e.clientX
        phaseRef.current += dx * 0.0012
        dragVelRef.current = dx * 0.0012
      }
      const up = () => {
        lastX = null
      }
      el.addEventListener('pointerdown', down)
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
      return () => {
        el.removeEventListener('pointerdown', down)
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
      }
    }, [driver, gl])

    useFrame(({ clock }, delta) => {
      if (mountTimeRef.current < 0) mountTimeRef.current = clock.elapsedTime
      if (driver === 'autoplay') phaseRef.current += delta * speed * 0.02
      if (driver === 'drag') {
        phaseRef.current += dragVelRef.current * 0.5
        dragVelRef.current *= 0.94
      }
    })

    const shared: SharedMotion = {
      phaseRef,
      mountTimeRef,
      morphRef,
      layoutId,
      layoutOptions,
      entranceType,
      stagger: props.entrance?.stagger ?? 0.06,
      entranceDuration: props.entrance?.duration ?? 0.9,
      total,
      reduced,
    }

    return (
      <group ref={ref}>
        {groups.map((group, gi) => (
          <FieldGroup key={`${gi}:${group.indices.length}`} group={group} shared={shared} />
        ))}
      </group>
    )
  },
)

/** One instanced mesh: one preset's sheet/stock/behavior across its slots. */
function FieldGroup({ group, shared }: { group: FieldGroupData; shared: SharedMotion }) {
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
          config.sheet.segments === 'auto'
            ? 'auto'
            : Math.min(config.sheet.segments, FIELD_SEGMENT_CAP),
      },
      Math.min(stackMinSegments(initialStack), FIELD_SEGMENT_CAP),
    )
    const atlasIdx = new Float32Array(count)
    const phase = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      atlasIdx[i] = i
      phase[i] = ((indices[i]! * 0.618034) % 1) * 4 // golden-ratio spread by global slot
    }
    geo.setAttribute('aAtlas', new THREE.InstancedBufferAttribute(atlasIdx, 1))
    geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1))
    return geo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(config.sheet), structureKey, count])

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
        const tIn = Math.min(
          1,
          Math.max(0, (elapsed - i * shared.stagger) / shared.entranceDuration),
        )
        if (tIn < 1) {
          pose = lerpPose(entrancePose(shared.entranceType, i, pose), pose, easeOut(tIn))
        }
      }
      scratchObj.position.set(...pose.position)
      scratchObj.rotation.set(...pose.rotation)
      scratchObj.scale.setScalar(pose.scale)
      scratchObj.updateMatrix()
      mesh.setMatrixAt(j, scratchObj.matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
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
    }
  }
  const a = i * 2.399
  return {
    position: [Math.cos(a) * 7, Math.sin(a * 1.3) * 4, Math.sin(a) * 6],
    rotation: [Math.sin(a) * 2, a, Math.cos(a) * 2],
    scale: target.scale * 0.6,
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
  }
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2)

/** `<PaperField />` owns its own Canvas; PaperFieldMesh drops into existing scenes. */
export const PaperField = forwardRef<THREE.Group, PaperFieldProps>(function PaperField(
  { children, className, style, ...meshProps },
  ref,
) {
  return (
    <div className={className} style={{ width: '100%', height: '100%', ...style }}>
      <Canvas shadows camera={{ position: [0, 0.6, 5.2], fov: 45 }} dpr={[1, 2]}>
        <ambientLight intensity={0.7} />
        <directionalLight
          position={[3, 5, 4]}
          intensity={1.4}
          castShadow
          shadow-mapSize={[1024, 1024]}
          shadow-normalBias={0.05}
        />
        <PaperFieldMesh ref={ref} {...meshProps} />
        {children}
      </Canvas>
    </div>
  )
})
