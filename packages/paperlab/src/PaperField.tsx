import * as THREE from 'three'
import { gsap } from 'gsap'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { forwardRef, useEffect, useMemo, useRef } from 'react'
import type { PaperConfigInput } from './config/schema'
import { usePrefersReducedMotion } from './a11y'
import { DropZoneContext, DropZoneRegistry, type DropZoneConfig, type PlacedPaper } from './field/dropZones'
import {
  EMPTY_SET,
  effectiveFieldPapers,
  fieldIsInteractive,
  groupFieldPapers,
  type FieldPaperSlot,
} from './field/slots'
import { FieldGroup, type SharedMotion } from './field/fieldGroup'
import { BackingSheet } from './field/backingSheet'
import { InteractiveField, type FieldA11yController } from './field/interactiveField'
import { FieldKeyboardMirror } from './field/keyboardMirror'
import { DEFAULT_SHEET, getLayout } from './field/layouts'
import type { SheetLayoutOptions } from './field/sheetGrid'
import { fitCamera, resolveLayoutOptions } from './field/framing'

// The field system lives in field/*; this module is the public composition.
// Re-exported here so `import { … } from './PaperField'` (index.ts, tests,
// consumers) keeps working across the split.
export {
  DropZone,
  DropZoneRegistry,
  zoneAccepts,
  type DropZoneConfig,
  type DropZoneProps,
  type PlacedPaper,
} from './field/dropZones'
export {
  groupFieldPapers,
  resolveFieldSlotConfig,
  type FieldPaperSlot,
  type FieldGroupData,
} from './field/slots'
export type { FieldA11yController } from './field/interactiveField'
export {
  fieldKeyboardStep,
  type KeyboardCarry,
  type KeyboardStepResult,
} from './field/keyboardMirror'

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
  /**
   * Per-paper interaction (hero CPU path per slot instead of one instanced
   * draw call). Defaults to true when any slot's preset carries `states` —
   * a stateful field is interactive by nature.
   */
  interactive?: boolean
  /** Fires when any slot's state machine changes state. */
  onSlotStateChange?(slot: number, state: string): void
  /** Serialized drop zones (the editor's path); `<DropZone>` children also work. */
  zones?: DropZoneConfig[]
  /** Fires when a picked paper settles into any zone. */
  onPlace?(paper: PlacedPaper, zone: string): void
  /** Imperative controls for the hidden keyboard flow (wired by PaperField). */
  a11yControllerRef?: React.MutableRefObject<FieldA11yController | null>
}

export interface PaperFieldProps extends PaperFieldMeshProps {
  children?: React.ReactNode
  className?: string
  style?: React.CSSProperties
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
      () => effectiveFieldPapers(props.papers, props.images),
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
    const firstSheet = groups[0]?.config.sheet
    const layoutOptions = useMemo(
      // Sheet grids size their cells from the papers themselves — gutter is
      // then literally the spacing between stamps (explicit cell dims win).
      () => resolveLayoutOptions(layoutId, layout, props.layoutOptions, firstSheet),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [layoutId, JSON.stringify(props.layoutOptions ?? {}), firstSheet?.width, firstSheet?.height],
    )

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
      sheet: firstSheet ?? DEFAULT_SHEET,
      entranceType,
      stagger: props.entrance?.stagger ?? 0.06,
      entranceDuration: props.entrance?.duration ?? 0.9,
      total,
      reduced,
    }

    // A stateful field is interactive by nature: per-paper hero path (CPU,
    // raycastable, per-slot state machines) instead of one instanced call.
    // (`groups` already resolved every preset, so reuse them for the check.)
    const interactive =
      props.interactive ?? (papers.some((s) => s.states) || groups.some((g) => Boolean(g.config.states)))

    const isSheet = layoutId === 'sheet'
    const sheetOptions = isSheet ? (layoutOptions as SheetLayoutOptions) : null

    if (interactive) {
      return (
        <group ref={ref}>
          <InteractiveField
            papers={papers}
            fallback={props.preset}
            layoutId={layoutId}
            layoutOptions={layoutOptions}
            sheetOptions={sheetOptions}
            sheet={firstSheet ?? DEFAULT_SHEET}
            reducedMotion={props.reducedMotion}
            zones={props.zones}
            onSlotStateChange={props.onSlotStateChange}
            onPlace={props.onPlace}
            a11yRef={props.a11yControllerRef}
          />
        </group>
      )
    }

    return (
      <group ref={ref}>
        {sheetOptions?.backing && <BackingSheet options={sheetOptions} count={total} removed={EMPTY_SET} />}
        {groups.map((group, gi) => (
          <FieldGroup key={`${gi}:${group.indices.length}`} group={group} shared={shared} />
        ))}
      </group>
    )
  },
)

/**
 * Frames whatever the layout actually lays out. A fixed camera can only suit
 * one layout — a `wall` of 12 runs past the top of a frame that a `pile`
 * leaves nearly empty — and layouts are pure, so the right distance is just
 * arithmetic over their poses.
 */
function FitCamera(meshProps: PaperFieldMeshProps) {
  const camera = useThree((s) => s.camera)
  const width = useThree((s) => s.size.width)
  const height = useThree((s) => s.size.height)

  const field = useMemo(() => {
    const papers = effectiveFieldPapers(meshProps.papers, meshProps.images)
    const layoutId = meshProps.layout ?? 'ring'
    const layout = getLayout(layoutId)
    const sheet = groupFieldPapers(papers, meshProps.preset)[0]?.config.sheet
    const options = resolveLayoutOptions(layoutId, layout, meshProps.layoutOptions, sheet)
    return { layout, n: papers.length, options, sheet: sheet ?? DEFAULT_SHEET }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    JSON.stringify(meshProps.papers ?? null),
    JSON.stringify(meshProps.images ?? null),
    JSON.stringify(meshProps.preset ?? null),
    meshProps.layout,
    JSON.stringify(meshProps.layoutOptions ?? {}),
  ])

  useEffect(() => {
    if (!(camera instanceof THREE.PerspectiveCamera)) return
    const { position, target } = fitCamera(
      field.layout,
      field.n,
      field.options,
      field.sheet,
      camera.fov,
      width / Math.max(height, 1),
    )
    camera.position.set(...position)
    camera.lookAt(...target)
    camera.updateProjectionMatrix()
  }, [camera, width, height, field])

  return null
}

/** `<PaperField />` owns its own Canvas; PaperFieldMesh drops into existing scenes. */
export const PaperField = forwardRef<THREE.Group, PaperFieldProps>(function PaperField(
  { children, className, style, ...meshProps },
  ref,
) {
  const registry = useMemo(() => new DropZoneRegistry(), [])
  const a11yRef = useRef<FieldA11yController | null>(null)

  // The SAME derivations PaperFieldMesh uses — a slot naming a stateful
  // preset by string, or an images-driven field, must get the keyboard
  // mirror exactly when the mesh goes interactive.
  const papers = useMemo(
    () => effectiveFieldPapers(meshProps.papers, meshProps.images),
    [meshProps.papers, meshProps.images],
  )
  const interactive = useMemo(
    () => fieldIsInteractive(papers, meshProps.preset, meshProps.interactive),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(papers), JSON.stringify(meshProps.preset ?? null), meshProps.interactive],
  )

  return (
    <div className={className} style={{ width: '100%', height: '100%', ...style }}>
      <DropZoneContext.Provider value={registry}>
        <Canvas shadows camera={{ position: [0, 0.6, 5.2], fov: 45 }} dpr={[1, 2]}>
          <FitCamera {...meshProps} />
          <ambientLight intensity={0.7} />
          <directionalLight
            position={[3, 5, 4]}
            intensity={1.4}
            castShadow
            shadow-mapSize={[1024, 1024]}
            shadow-normalBias={0.05}
          />
          <PaperFieldMesh ref={ref} a11yControllerRef={a11yRef} {...meshProps} />
          {children}
        </Canvas>
        {interactive && <FieldKeyboardMirror papers={papers} controller={a11yRef} />}
      </DropZoneContext.Provider>
    </div>
  )
})
