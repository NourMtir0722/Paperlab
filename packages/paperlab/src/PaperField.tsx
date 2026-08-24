import * as THREE from 'three'
import { gsap } from 'gsap'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { forwardRef, useEffect, useMemo, useRef } from 'react'
import { sceneSchema, type PaperConfigInput, type SceneConfigInput } from './config/schema'
import { PaperLighting } from './scene/PaperLighting'
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
import { useStable } from './core/stable'
import type { SheetLayoutOptions } from './field/sheetGrid'
import { fitCamera, resolveLayoutOptions } from './field/framing'

// The field system lives in field/*; this module is the public composition,
// so it forwards only what the public API names. The rest of field/* is
// reachable from its own module for tests and for the internals — it is not
// re-exported here, because a re-export is how something becomes public by
// accident.
export {
  DropZone,
  type DropZoneConfig,
  type DropZoneProps,
  type PlacedPaper,
} from './field/dropZones'
export type { FieldPaperSlot } from './field/slots'

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
  /**
   * Fires with a paper's index when it is clicked. Supplying it is what makes
   * the papers pickable — without a handler nothing raycasts, which matters
   * because hit-testing an instanced mesh is per-instance work on a pointer
   * move and a field is the mode with hundreds of instances in it.
   */
  onSelect?(paper: number): void
  /** Serialized drop zones (the editor's path); `<DropZone>` children also work. */
  zones?: DropZoneConfig[]
  /** Fires when a picked paper settles into any zone. */
  onPlace?(paper: PlacedPaper, zone: string): void
  /** Imperative controls for the hidden keyboard flow (wired by PaperField). */
  a11yControllerRef?: React.MutableRefObject<FieldA11yController | null>
  /**
   * Lowers what `segments: 'auto'` may ask for, per sheet. A DEVICE knob, in
   * the same sense `<PaperStage>`'s `quality` is one: it describes what the
   * machine can draw, never what the artwork is, so it does not serialize
   * into a preset or a share link. It can only ever lower the field's own
   * ceiling; nothing here can subdivide a sheet further than the library
   * would on its own.
   */
  segmentCeiling?: number
}

export interface PaperFieldProps extends PaperFieldMeshProps {
  /**
   * Lighting — the same `{ lighting, light }` a single sheet carries.
   *
   * This component used to light itself with a bare ambient and a bare
   * directional, while the editor previewed field mode through
   * `<PaperLighting>` like everything else. So the gallery you composed and
   * the gallery the exported code produced were lit by two different rigs,
   * and the export was the one nobody had looked at.
   */
  scene?: SceneConfigInput
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
    // Content-compared, not serialized: papers and preset are fresh objects
    // every render, and a paper can carry a whole bitmap inline. See
    // `useStable` for why stringifying these was the expensive half.
    const stablePapers = useStable(papers)
    const stablePreset = useStable(props.preset ?? null)
    const groups = useMemo(
      () => groupFieldPapers(stablePapers, stablePreset ?? undefined),
      [stablePapers, stablePreset],
    )
    const total = papers.length

    const layoutId = props.layout ?? 'ring'
    const layout = getLayout(layoutId)
    const firstSheet = groups[0]?.config.sheet
    const stableLayoutOptions = useStable(props.layoutOptions ?? {})
    // biome-ignore lint/correctness/useExhaustiveDependencies: `layout` is derived from layoutId, and the sheet enters by its two dimensions.
    const layoutOptions = useMemo(
      // Sheet grids size their cells from the papers themselves — gutter is
      // then literally the spacing between stamps (explicit cell dims win).
      () => resolveLayoutOptions(layoutId, layout, stableLayoutOptions, firstSheet),
      [layoutId, stableLayoutOptions, firstSheet?.width, firstSheet?.height],
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
          <FieldGroup
            // biome-ignore lint/suspicious/noArrayIndexKey: groups are derived from the slot list in order, so position is their only identity.
            key={`${gi}:${group.indices.length}`}
            group={group}
            shared={shared}
            onSelect={props.onSelect}
            segmentCeiling={props.segmentCeiling}
          />
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

  // The camera refits on prop CONTENT, not on identity — compared rather
  // than serialized, because this runs on every render of the field.
  const papersProp = useStable(meshProps.papers ?? null)
  const imagesProp = useStable(meshProps.images ?? null)
  const presetProp = useStable(meshProps.preset ?? null)
  const optionsProp = useStable(meshProps.layoutOptions ?? {})
  const field = useMemo(() => {
    const papers = effectiveFieldPapers(papersProp ?? undefined, imagesProp ?? undefined)
    const layoutId = meshProps.layout ?? 'ring'
    const layout = getLayout(layoutId)
    const sheet = groupFieldPapers(papers, presetProp ?? undefined)[0]?.config.sheet
    const options = resolveLayoutOptions(layoutId, layout, optionsProp, sheet)
    return { layout, n: papers.length, options, sheet: sheet ?? DEFAULT_SHEET }
  }, [papersProp, imagesProp, presetProp, meshProps.layout, optionsProp])

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
  { children, className, style, scene, ...meshProps },
  ref,
) {
  const rig = sceneSchema.parse(scene ?? {})
  const registry = useMemo(() => new DropZoneRegistry(), [])
  const a11yRef = useRef<FieldA11yController | null>(null)

  // The SAME derivations PaperFieldMesh uses — a slot naming a stateful
  // preset by string, or an images-driven field, must get the keyboard
  // mirror exactly when the mesh goes interactive.
  const papers = useMemo(
    () => effectiveFieldPapers(meshProps.papers, meshProps.images),
    [meshProps.papers, meshProps.images],
  )
  const stablePapers = useStable(papers)
  const stablePreset = useStable(meshProps.preset ?? null)
  const interactive = useMemo(
    () => fieldIsInteractive(stablePapers, stablePreset ?? undefined, meshProps.interactive),
    [stablePapers, stablePreset, meshProps.interactive],
  )

  return (
    <div className={className} style={{ width: '100%', height: '100%', ...style }}>
      <DropZoneContext.Provider value={registry}>
        <Canvas shadows camera={{ position: [0, 0.6, 5.2], fov: 45 }} dpr={[1, 2]}>
          <FitCamera {...meshProps} />
          {/* The floor and footprint a gallery of sheets needs — a lone sheet
              sits closer to the camera and on a tighter shadow. */}
          <PaperLighting preset={rig.lighting} light={rig.light} floor={-2.4} scale={14} />
          <PaperFieldMesh ref={ref} a11yControllerRef={a11yRef} {...meshProps} />
          {children}
        </Canvas>
        {interactive && <FieldKeyboardMirror papers={papers} controller={a11yRef} />}
      </DropZoneContext.Provider>
    </div>
  )
})
