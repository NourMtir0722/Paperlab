import * as THREE from 'three'
import { gsap } from 'gsap'
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import {
  createContext,
  forwardRef,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import {
  paperConfigSchema,
  type ContentConfig,
  type PaperConfig,
  type PaperConfigInput,
  type PaperStatesInput,
} from './config/schema'
import { mergeConfig } from './config/merge'
import { PaperMesh, resolveConfig, type PaperHandle } from './PaperMesh'
import { carryDrive, dampTo, type AeroPose, type DampedValue } from './physics/aero'
import { tornEdgesOnDetach } from './field/sheetGrid'
import { contentText } from './a11y'
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
import {
  outwardCorner,
  sheetBackingSize,
  sheetLayoutSchema,
  withSheetCellFromPaper,
  type SheetLayoutOptions,
} from './field/sheetGrid'
import { drawBacking } from './content/backing'
import { useContentAtlas } from './content/atlas'
import { usePrefersReducedMotion } from './a11y'
import CustomShaderMaterial from 'three-custom-shader-material'

/** A field slot references a preset — the spec's component/instance model. */
export interface FieldPaperSlot {
  preset?: string | PaperConfigInput
  content?: ContentConfig
  /** Per-instance state overrides, merged over the preset's states (spec M6 §1.1). */
  states?: PaperStatesInput
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
const scratchAero: AeroPose = { position: [0, 0, 0], rotation: [0, 0, 0] }
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
    const firstSheet = groups[0]?.config.sheet
    const layoutOptions = useMemo(() => {
      const parsed = layout.optionsSchema.parse({
        ...layout.defaults,
        ...props.layoutOptions,
      }) as Record<string, unknown>
      // Sheet grids size their cells from the papers themselves — gutter is
      // then literally the spacing between stamps (explicit cell dims win).
      if (layoutId !== 'sheet') return parsed
      return withSheetCellFromPaper(
        parsed as unknown as SheetLayoutOptions,
        props.layoutOptions,
        firstSheet,
      ) as unknown as Record<string, unknown>
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [layoutId, JSON.stringify(props.layoutOptions ?? {}), firstSheet?.width, firstSheet?.height])

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

    // A stateful field is interactive by nature: per-paper hero path (CPU,
    // raycastable, per-slot state machines) instead of one instanced call.
    const interactive =
      props.interactive ?? (papers.some((s) => s.states) || groups.some((g) => g.config.states))

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
        {sheetOptions?.backing && (
          <BackingSheet options={sheetOptions} count={total} removed={EMPTY_SET} />
        )}
        {groups.map((group, gi) => (
          <FieldGroup key={`${gi}:${group.indices.length}`} group={group} shared={shared} />
        ))}
      </group>
    )
  },
)

const EMPTY_SET: ReadonlySet<number> = new Set()

// ── Drop zones (spec M6 §5) ──────────────────────────────────────────────────

export interface DropZoneConfig {
  id: string
  /** Preset-name globs ('stamp-*'); omitted = accept all. */
  accept?: string[]
  /** World-space rect on the field plane. */
  bounds: { position: [number, number, number]; size: [number, number] }
  highlight?: 'none' | 'glow' | 'outline'
}

export interface PlacedPaper {
  slot: number
  presetName: string
  config: PaperConfig
}

export interface DropZoneProps extends DropZoneConfig {
  onPlace?(paper: PlacedPaper, zone: string): void
}

interface ZoneEntry extends DropZoneConfig {
  onPlace?: DropZoneProps['onPlace']
}

/** Shared zone state: `<DropZone>` children register; the carry loop hit-tests. */
export class DropZoneRegistry {
  private zones = new Map<string, ZoneEntry>()
  private hoveredId: string | null = null
  private listeners = new Set<() => void>()
  private version = 0

  register(zone: ZoneEntry): () => void {
    this.zones.set(zone.id, zone)
    this.notify()
    return () => {
      this.zones.delete(zone.id)
      this.notify()
    }
  }

  list(): ZoneEntry[] {
    return [...this.zones.values()]
  }

  get(id: string): ZoneEntry | undefined {
    return this.zones.get(id)
  }

  get hovered(): string | null {
    return this.hoveredId
  }

  setHovered(id: string | null): void {
    if (this.hoveredId === id) return
    this.hoveredId = id
    this.notify()
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  getVersion = (): number => this.version

  private notify(): void {
    this.version++
    for (const fn of this.listeners) fn()
  }
}

const DropZoneContext = createContext<DropZoneRegistry | null>(null)

/** True when `name` matches the zone's accept globs (all zones accept by default). */
export function zoneAccepts(zone: Pick<DropZoneConfig, 'accept'>, name: string): boolean {
  if (!zone.accept || zone.accept.length === 0) return true
  return zone.accept.some((glob) => {
    const re = new RegExp(
      `^${glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`,
      'i',
    )
    return re.test(name)
  })
}

const zoneContains = (zone: ZoneEntry, x: number, y: number): boolean =>
  Math.abs(x - zone.bounds.position[0]) <= zone.bounds.size[0] / 2 &&
  Math.abs(y - zone.bounds.position[1]) <= zone.bounds.size[1] / 2

/**
 * A drop target inside a `<PaperField>`. While a paper is picked, its center
 * is tested against the bounds each frame; hovering applies the highlight
 * and release inside fires `placed` + `onPlace`.
 */
export function DropZone(props: DropZoneProps) {
  const registry = useContext(DropZoneContext)
  const { id, accept, bounds, highlight = 'glow', onPlace } = props
  useEffect(() => {
    if (!registry) return
    return registry.register({ id, accept, bounds, highlight, onPlace })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registry, id, JSON.stringify(accept ?? null), JSON.stringify(bounds), highlight, onPlace])
  if (!registry) return null
  return <DropZoneVisual registry={registry} config={{ id, accept, bounds, highlight }} />
}

/** The translucent target — brightens when the carried paper is over it. */
function DropZoneVisual({
  registry,
  config,
}: {
  registry: DropZoneRegistry
  config: DropZoneConfig
}) {
  useSyncExternalStore(registry.subscribe, registry.getVersion, registry.getVersion)
  const hovered = registry.hovered === config.id
  const style = config.highlight ?? 'glow'
  const [w, h] = config.bounds.size
  return (
    <group position={config.bounds.position}>
      {style !== 'outline' && (
        <mesh>
          <planeGeometry args={[w, h]} />
          <meshBasicMaterial
            color={hovered && style === 'glow' ? '#8ea8ff' : '#5c6f9e'}
            transparent
            opacity={hovered && style === 'glow' ? 0.32 : 0.14}
            depthWrite={false}
          />
        </mesh>
      )}
      <lineSegments>
        <edgesGeometry args={[new THREE.PlaneGeometry(w, h)]} />
        <lineBasicMaterial color={hovered ? '#aebfff' : '#6b7da8'} />
      </lineSegments>
    </group>
  )
}

/** Imperative field controls for the hidden a11y keyboard flow. */
export interface FieldA11yController {
  pick(slot: number): boolean
  placeAtZone(slot: number, zoneId: string): void
  cancel(slot: number): void
  zoneIds(): string[]
  slotState(slot: number): string
}

/**
 * Resolve one slot to its final render config: preset (or fallback) + slot
 * content + slot-level state overrides merged over the preset's states + the
 * `sheet` smart default (an 'auto' peel corner resolves to the corner facing
 * away from the sheet's center — what a thumb would find).
 */
export function resolveFieldSlotConfig(
  slot: FieldPaperSlot,
  fallback: string | PaperConfigInput | undefined,
  index: number,
  layoutId: string,
  layoutOptions: Record<string, unknown>,
): PaperConfig {
  let config = resolveConfig({ preset: slot.preset ?? fallback })
  const patch: Record<string, unknown> = {}
  if (slot.content) patch.content = slot.content
  if (slot.states) patch.states = slot.states
  if (
    layoutId === 'sheet' &&
    config.behavior?.type === 'peel' &&
    config.behavior.corner === 'auto'
  ) {
    const o = sheetLayoutSchema.parse(layoutOptions)
    patch.behavior = { corner: outwardCorner(index, o) }
  }
  if (Object.keys(patch).length > 0) {
    config = paperConfigSchema.parse(mergeConfig(config as Record<string, unknown>, patch))
  }
  return config
}

interface InteractiveFieldProps {
  papers: FieldPaperSlot[]
  fallback?: string | PaperConfigInput
  layoutId: string
  layoutOptions: Record<string, unknown>
  sheetOptions: SheetLayoutOptions | null
  reducedMotion?: boolean
  /** Serialized zones (the editor's) — merged with `<DropZone>` children. */
  zones?: DropZoneConfig[]
  onSlotStateChange?(slot: number, state: string): void
  onPlace?(paper: PlacedPaper, zone: string): void
  a11yRef?: React.MutableRefObject<FieldA11yController | null>
}

/** Behaviors with a grab point — the only ones a drag can pick (spec §1.1). */
const PICK_BEHAVIORS = new Set(['peel', 'carry'])

interface CarriedPaper {
  slot: number
  pointerId: number | null
  x: DampedValue
  y: DampedValue
  targetX: number
  targetY: number
  lastX: number
  lastY: number
  homePose: PaperPose
  settling: boolean
}

interface PressState {
  slot: number
  pointerId: number
  startX: number
  startY: number
}

/**
 * The interactive field: one hero-path PaperMesh per slot posed by the
 * layout, plus the carry controller — press past `pickThreshold` tears the
 * paper off (perforation auto-wires torn), it flies with the cursor
 * fluttering from drag velocity, zones test its center each frame, release
 * settles (snap → press → flatten) or flutters back to its slot.
 */
function InteractiveField(props: InteractiveFieldProps) {
  const { papers, fallback, layoutId, layoutOptions, sheetOptions } = props
  const total = papers.length
  const layout = getLayout(layoutId)
  const reduced = usePrefersReducedMotion(props.reducedMotion)
  const contextRegistry = useContext(DropZoneContext)
  // Editor-serialized zones need hover state even without a provider.
  const registry = useMemo(() => contextRegistry ?? new DropZoneRegistry(), [contextRegistry])
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)
  const controls = useThree((s) => s.controls) as { enabled?: boolean } | null

  // Once a stamp leaves its slot the silhouette stays bare — paper has
  // memory: a returned stamp sits ON its silhouette, detached.
  const [removed, setRemoved] = useState<ReadonlySet<number>>(EMPTY_SET)
  // Runtime config patches (torn perforation, carry override) — merged over
  // the slot config; the machine `rebase`s instead of resetting.
  const [slotPatches, setSlotPatches] = useState<Record<number, Record<string, unknown>>>({})
  const [slotStates, setSlotStates] = useState<Record<number, string>>({})

  const slotConfigs = useMemo(
    () =>
      papers.map((slot, i) => {
        const config = resolveFieldSlotConfig(slot, fallback, i, layoutId, layoutOptions)
        const patch = slotPatches[i]
        return patch
          ? paperConfigSchema.parse(mergeConfig(config as Record<string, unknown>, patch))
          : config
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      JSON.stringify(papers),
      JSON.stringify(fallback ?? null),
      layoutId,
      JSON.stringify(layoutOptions),
      slotPatches,
    ],
  )
  const poses = useMemo(
    () => slotConfigs.map((_, i) => layout.pose(i, total, layoutOptions, 0)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layoutId, JSON.stringify(layoutOptions), total],
  )

  const groupRefs = useRef<(THREE.Group | null)[]>([])
  const handleRefs = useRef<(PaperHandle | null)[]>([])
  const pressRef = useRef<PressState | null>(null)
  const carriedRef = useRef<CarriedPaper | null>(null)

  // Registry zones can register after mount; read live in the frame loop.
  const zonesLive = (): ZoneEntry[] => [...(props.zones ?? []), ...registry.list()]

  const slotName = (i: number): string => {
    const preset = papers[i]?.preset ?? fallback
    return typeof preset === 'string' ? preset : (slotConfigs[i]?.meta.name ?? 'paper')
  }

  const onSlotState = (i: number, state: string) => {
    setSlotStates((prev) => ({ ...prev, [i]: state }))
    if (state === 'picked' || state === 'placed') {
      setRemoved((prev) => (prev.has(i) ? prev : new Set(prev).add(i)))
    }
    props.onSlotStateChange?.(i, state)
  }

  // ── Pointer → field-plane projection ──
  const raycaster = useMemo(() => new THREE.Raycaster(), [])
  const planeScratch = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), [])
  const pointScratch = useMemo(() => new THREE.Vector3(), [])
  const ndcScratch = useMemo(() => new THREE.Vector2(), [])
  const planePoint = (clientX: number, clientY: number, planeZ: number): [number, number] | null => {
    const rect = gl.domElement.getBoundingClientRect()
    ndcScratch.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    )
    raycaster.setFromCamera(ndcScratch, camera)
    planeScratch.constant = -planeZ
    const hit = raycaster.ray.intersectPlane(planeScratch, pointScratch)
    return hit ? [hit.x, hit.y] : null
  }

  // ── Pick: the tear ──
  const pick = (slot: number, atX: number, atY: number, pointerId: number | null = null): boolean => {
    const config = slotConfigs[slot]
    const handle = handleRefs.current[slot]
    const home = poses[slot]
    if (!config?.states || !handle || !home) return false
    if (!config.behavior || !PICK_BEHAVIORS.has(config.behavior.type)) return false
    if (slotStates[slot] === 'placed' || carriedRef.current) return false

    // Auto-wire the sticker model: perforation edges that faced neighbors
    // tear through (manual state wins), and `picked` defaults to a carry
    // hanging from the peeled corner unless the preset choreographs its own.
    const patch: Record<string, unknown> = {}
    if (sheetOptions && config.surface.perforation) {
      const auto = tornEdgesOnDetach(slot, sheetOptions)
      patch.surface = {
        perforation: { state: { ...auto, ...config.surface.perforation.state } },
      }
    }
    const pickedOverrides = config.states.states.picked?.overrides as
      | { behavior?: unknown }
      | undefined
    if (!pickedOverrides?.behavior) {
      const grab =
        config.behavior.type === 'peel' && config.behavior.corner !== 'auto'
          ? config.behavior.corner
          : 'top-left'
      patch.states = {
        states: {
          picked: { overrides: { behavior: { type: 'carry', grab, drive: 0.3 } } },
        },
      }
    }
    if (Object.keys(patch).length > 0) {
      setSlotPatches((prev) => ({ ...prev, [slot]: mergeConfig(prev[slot] ?? {}, patch) }))
    }

    // Drive the machine through rest→hover→pressed→picked so every side effect
    // fires for BOTH pointer (already at 'pressed') and keyboard (still at
    // 'rest') entry — raw send('pick') from 'rest' was a silent no-op.
    handle.pickProgrammatic()
    carriedRef.current = {
      slot,
      pointerId,
      x: { value: atX, velocity: 0 },
      y: { value: atY, velocity: 0 },
      targetX: atX,
      targetY: atY,
      lastX: atX,
      lastY: atY,
      homePose: home,
      settling: false,
    }
    if (controls) controls.enabled = false
    return true
  }

  // ── The settle: the 400ms that sells everything (spec §5.3) ──
  const settleInto = (carried: CarriedPaper, zone: ZoneEntry) => {
    const group = groupRefs.current[carried.slot]
    const handle = handleRefs.current[carried.slot]
    if (!group || !handle) return
    carried.settling = true
    handle.placeProgrammatic()
    handle.set('drive', 0)
    registry.setHovered(null)

    const paper: PlacedPaper = {
      slot: carried.slot,
      presetName: slotName(carried.slot),
      config: slotConfigs[carried.slot]!,
    }
    const zoneZ = zone.bounds.position[2]
    const done = () => {
      carriedRef.current = null
      if (controls) controls.enabled = true
      zone.onPlace?.(paper, zone.id)
      props.onPlace?.(paper, zone.id)
    }
    if (reduced) {
      group.position.set(group.position.x, group.position.y, zoneZ + 0.005)
      group.rotation.set(0, 0, 0)
      group.scale.setScalar(1)
      done()
      return
    }
    const tl = gsap.timeline({ onComplete: done })
    // 1 · Snap — position tweens to the drop point on the zone plane.
    tl.to(group.position, { z: zoneZ + 0.005, duration: 0.12, ease: 'power3.out' }, 0)
    tl.to(group.rotation, { x: 0, y: 0, z: 0, duration: 0.12, ease: 'power3.out' }, 0)
    // 2 · Press — the paper bows into the surface, shadow tightening.
    tl.to(group.scale, { x: 1.02, y: 1.02, z: 1, duration: 0.09, ease: 'power2.in' }, 0.12)
    tl.to(group.position, { z: zoneZ + 0.001, duration: 0.18, ease: 'power2.out' }, 0.12)
    // 3 · Flatten — tiny overshoot on scale (1.0 → 0.985 → 1.0).
    tl.to(group.scale, { x: 0.985, y: 0.985, duration: 0.06, ease: 'power1.inOut' }, 0.3)
    tl.to(group.scale, { x: 1, y: 1, duration: 0.06, ease: 'power1.out' }, 0.36)
  }

  // ── The return: flutter back to the slot on a slight arc (spec §5.4) ──
  const returnHome = (carried: CarriedPaper) => {
    const group = groupRefs.current[carried.slot]
    const handle = handleRefs.current[carried.slot]
    if (!group || !handle) return
    carried.settling = true
    registry.setHovered(null)

    const home = carried.homePose
    const done = () => {
      handle.returnProgrammatic()
      carriedRef.current = null
      if (controls) controls.enabled = true
    }
    if (reduced) {
      group.position.set(...home.position)
      group.rotation.set(...home.rotation)
      group.scale.setScalar(home.scale)
      done()
      return
    }
    const from = { x: group.position.x, y: group.position.y, z: group.position.z }
    const dist = Math.hypot(from.x - home.position[0], from.y - home.position[1])
    const duration = Math.min(0.8, Math.max(0.25, dist * 0.55))
    // Curved path: a slight arc perpendicular to the travel, not linear.
    const arc = Math.min(0.35, dist * 0.25)
    const proxy = { t: 0 }
    gsap.to(proxy, {
      t: 1,
      duration,
      ease: 'power2.inOut',
      onUpdate: () => {
        const t = proxy.t
        const lift = Math.sin(t * Math.PI) * arc
        group.position.x = from.x + (home.position[0] - from.x) * t
        group.position.y = from.y + (home.position[1] - from.y) * t + lift
        group.position.z = from.z + (home.position[2] - from.z) * t
        // Flutter decays as it approaches.
        handle.set('drive', (1 - t) * 0.5)
      },
      onComplete: done,
    })
    gsap.to(group.rotation, { x: home.rotation[0], y: home.rotation[1], z: home.rotation[2], duration })
    gsap.to(group.scale, { x: home.scale, y: home.scale, z: home.scale, duration: duration * 0.5 })
  }

  // ── Press / drag / release wiring ──
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const press = pressRef.current
      const carried = carriedRef.current
      if (carried && !carried.settling && (carried.pointerId === null || e.pointerId === carried.pointerId)) {
        const hit = planePoint(e.clientX, e.clientY, carried.homePose.position[2] + 0.15)
        if (hit) {
          carried.targetX = hit[0]
          carried.targetY = hit[1]
        }
        return
      }
      if (!press) return
      const hit = planePoint(e.clientX, e.clientY, poses[press.slot]?.position[2] ?? 0)
      if (!hit) return
      const dist = Math.hypot(hit[0] - press.startX, hit[1] - press.startY)
      const threshold = slotConfigs[press.slot]?.states?.pickThreshold ?? 0.1
      if (dist > threshold) {
        const { slot, pointerId } = press
        pressRef.current = null
        pick(slot, hit[0], hit[1], pointerId)
      }
    }
    const up = (e: PointerEvent) => {
      pressRef.current = null
      const carried = carriedRef.current
      if (!carried || carried.settling) return
      if (carried.pointerId !== null && e.pointerId !== carried.pointerId) return
      const name = slotName(carried.slot)
      const zone = zonesLive().find(
        (z) => zoneContains(z, carried.x.value, carried.y.value) && zoneAccepts(z, name),
      )
      if (zone) settleInto(carried, zone)
      else returnHome(carried)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  })

  // ── The carry loop: damped follow, velocity flutter, zone hover ──
  useFrame((_, delta) => {
    const carried = carriedRef.current
    if (!carried || carried.settling) return
    const group = groupRefs.current[carried.slot]
    const handle = handleRefs.current[carried.slot]
    if (!group || !handle) return
    const dt = Math.min(delta, 1 / 30)

    if (reduced) {
      // Reduced motion: direct cursor-following, no flutter, no lag.
      carried.x.value = carried.lastX = carried.targetX
      carried.y.value = carried.lastY = carried.targetY
      group.position.x = carried.targetX
      group.position.y = carried.targetY
      group.position.z = carried.homePose.position[2] + 0.15
    } else {
      dampTo(carried.x, carried.targetX, 0.09, dt)
      dampTo(carried.y, carried.targetY, 0.09, dt)
      const vx = (carried.x.value - carried.lastX) / dt
      const vy = (carried.y.value - carried.lastY) / dt
      carried.lastX = carried.x.value
      carried.lastY = carried.y.value
      const speed = Math.hypot(vx, vy)
      group.position.x = carried.x.value
      group.position.y = carried.y.value
      group.position.z = carried.homePose.position[2] + 0.15
      // Drag velocity becomes flutter + rotational lag: yaw trails the drag.
      handle.set('drive', carryDrive(speed))
      const lag = 0.25
      group.rotation.y += (THREE.MathUtils.clamp(-vx * lag, -0.6, 0.6) - group.rotation.y) * 0.12
      group.rotation.x += (THREE.MathUtils.clamp(vy * lag * 0.7, -0.5, 0.5) - group.rotation.x) * 0.12
    }

    // Zone hover: center test each frame; scale-up is the "this will stick" cue.
    const name = slotName(carried.slot)
    const zone = zonesLive().find(
      (z) => zoneContains(z, group.position.x, group.position.y) && zoneAccepts(z, name),
    )
    registry.setHovered(zone?.id ?? null)
    const targetScale = (zone ? 1.03 : 1) * carried.homePose.scale
    group.scale.x += (targetScale - group.scale.x) * 0.15
    group.scale.y = group.scale.z = group.scale.x
  })

  // ── a11y controller: keyboard pick → move between zones → place/escape ──
  useEffect(() => {
    if (!props.a11yRef) return
    props.a11yRef.current = {
      pick: (slot) => {
        const home = poses[slot]
        if (!home) return false
        // pick() drives the machine (rest→…→picked) itself — no raw events.
        return pick(slot, home.position[0], home.position[1])
      },
      placeAtZone: (slot, zoneId) => {
        const carried = carriedRef.current
        const zone = zonesLive().find((z) => z.id === zoneId)
        const group = groupRefs.current[slot]
        if (!carried || carried.slot !== slot || !zone || !group) return
        group.position.x = zone.bounds.position[0]
        group.position.y = zone.bounds.position[1]
        carried.x.value = group.position.x
        carried.y.value = group.position.y
        settleInto(carried, zone)
      },
      cancel: (slot) => {
        const carried = carriedRef.current
        if (carried && carried.slot === slot && !carried.settling) returnHome(carried)
      },
      zoneIds: () => zonesLive().map((z) => z.id),
      slotState: (slot) => slotStates[slot] ?? 'rest',
    }
    return () => {
      if (props.a11yRef) props.a11yRef.current = null
    }
  })

  return (
    <group>
      {sheetOptions?.backing && (
        <BackingSheet options={sheetOptions} count={total} removed={removed} />
      )}
      {(props.zones ?? []).map((zone) => (
        <DropZoneVisual key={zone.id} registry={registry} config={zone} />
      ))}
      {slotConfigs.map((config, i) => {
        const pose = poses[i]!
        return (
          <group
            key={i}
            ref={(g) => {
              groupRefs.current[i] = g
            }}
            position={pose.position}
            rotation={pose.rotation}
            scale={pose.scale}
            onPointerDown={(e: ThreeEvent<PointerEvent>) => {
              if (carriedRef.current) return
              const hit = planePoint(e.clientX, e.clientY, pose.position[2])
              if (!hit) return
              pressRef.current = { slot: i, pointerId: e.pointerId, startX: hit[0], startY: hit[1] }
            }}
          >
            <PaperMesh
              ref={(h) => {
                handleRefs.current[i] = h
              }}
              preset={config}
              reducedMotion={props.reducedMotion}
              onStateChange={(state) => onSlotState(i, state)}
            />
          </group>
        )
      })}
    </group>
  )
}


/** Warmer than printer stock — the classic gummed backing paper. */
const BACKING_TINT = '#f3ecdd'

/**
 * The shared sheet behind a stamp grid: one extra paper sized to the grid
 * bounds + margin, non-interactive, excluded from `papers` indices. Its
 * content is a generated canvas of ghost silhouettes, redrawn on state
 * change (never per-frame).
 */
function BackingSheet({
  options,
  count,
  removed,
}: {
  options: SheetLayoutOptions
  count: number
  removed: ReadonlySet<number>
}) {
  const { width, height } = sheetBackingSize(options)
  const canvas = useMemo(() => {
    if (typeof document === 'undefined') return null
    const c = document.createElement('canvas')
    const scale = Math.min(1024, Math.round(360 * Math.max(width, height))) / Math.max(width, height)
    c.width = Math.max(2, Math.round(width * scale))
    c.height = Math.max(2, Math.round(height * scale))
    return c
  }, [width, height])
  const texture = useMemo(() => (canvas ? new THREE.CanvasTexture(canvas) : null), [canvas])

  const removedKey = [...removed].sort((a, b) => a - b).join(',')
  useEffect(() => {
    if (!canvas || !texture) return
    drawBacking(canvas, { options, count, tint: BACKING_TINT, removed })
    texture.needsUpdate = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvas, texture, JSON.stringify(options), count, removedKey])
  useEffect(() => () => texture?.dispose(), [texture])

  return (
    <mesh receiveShadow>
      <planeGeometry args={[width, height]} />
      <meshStandardMaterial map={texture} color="#ffffff" roughness={0.92} metalness={0} />
    </mesh>
  )
}

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
    const behaviorTransform = behavior?.transform && config.behavior ? behavior : null
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
  const registry = useMemo(() => new DropZoneRegistry(), [])
  const a11yRef = useRef<FieldA11yController | null>(null)

  const papers = meshProps.papers ?? []
  const interactive =
    meshProps.interactive ??
    papers.some(
      (s) => s.states || (typeof s.preset === 'object' && s.preset?.states) || false,
    )

  return (
    <div className={className} style={{ width: '100%', height: '100%', ...style }}>
      <DropZoneContext.Provider value={registry}>
        <Canvas shadows camera={{ position: [0, 0.6, 5.2], fov: 45 }} dpr={[1, 2]}>
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

const mirrorHidden: React.CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
}

/** Carry state of the hidden keyboard mirror: which paper is aloft, which zone is focused. */
export interface KeyboardCarry {
  slot: number
  zoneIndex: number
}

/** A keyboard step's decision: the next carry state and whether it consumed the key. */
export interface KeyboardStepResult {
  carry: KeyboardCarry | null
  handled: boolean
}

/**
 * The M6 §6 keyboard flow as a pure step (so it's testable without a DOM):
 * given the current carry state, the focused paper `slot`, and the pressed
 * `key`, it drives the field `controller` (pick → move between zones → place /
 * cancel) and returns the next carry state. All side effects go through
 * `controller`; the caller applies `carry` to its state and calls
 * `preventDefault()` when `handled` is true.
 */
export function fieldKeyboardStep(
  carry: KeyboardCarry | null,
  slot: number,
  key: string,
  controller: FieldA11yController,
): KeyboardStepResult {
  if (!carry) {
    // Not carrying: Enter/Space on a focused paper picks it up.
    if (key === 'Enter' || key === ' ') {
      return { carry: controller.pick(slot) ? { slot, zoneIndex: 0 } : null, handled: true }
    }
    return { carry, handled: false }
  }
  // Carrying: only the paper actually aloft responds.
  if (carry.slot !== slot) return { carry, handled: false }
  const zoneCount = Math.max(controller.zoneIds().length, 1)
  if (key === 'ArrowRight' || key === 'ArrowDown') {
    return { carry: { ...carry, zoneIndex: (carry.zoneIndex + 1) % zoneCount }, handled: true }
  }
  if (key === 'ArrowLeft' || key === 'ArrowUp') {
    return {
      carry: { ...carry, zoneIndex: (carry.zoneIndex - 1 + zoneCount) % zoneCount },
      handled: true,
    }
  }
  if (key === 'Enter' || key === ' ') {
    const zone = controller.zoneIds()[carry.zoneIndex]
    if (zone) controller.placeAtZone(slot, zone)
    return { carry: null, handled: true }
  }
  if (key === 'Escape') {
    controller.cancel(slot)
    return { carry: null, handled: true }
  }
  return { carry, handled: false }
}

/**
 * The hidden DOM mirror of an interactive field: each paper is a button.
 * Keyboard flow — focus a paper, Enter picks it, arrow keys move between
 * zones, Enter places, Escape returns it to its slot (spec M6 §6). The key
 * handling lives in the pure {@link fieldKeyboardStep} so it can be tested.
 */
function FieldKeyboardMirror({
  papers,
  controller,
}: {
  papers: FieldPaperSlot[]
  controller: React.MutableRefObject<FieldA11yController | null>
}) {
  const [carrying, setCarrying] = useState<{ slot: number; zoneIndex: number } | null>(null)

  const paperLabel = (slot: FieldPaperSlot, i: number): string => {
    try {
      const config = resolveConfig({ preset: slot.preset })
      return `Paper ${i + 1}: ${contentText({ ...config, content: slot.content ?? config.content })}`
    } catch {
      return `Paper ${i + 1}`
    }
  }

  const onKeyDown = (i: number) => (e: React.KeyboardEvent) => {
    const ctl = controller.current
    if (!ctl) return
    const { carry, handled } = fieldKeyboardStep(carrying, i, e.key, ctl)
    if (handled) e.preventDefault()
    if (carry !== carrying) setCarrying(carry)
  }

  return (
    <div style={mirrorHidden} role="group" aria-label="Interactive papers">
      {papers.map((slot, i) => (
        <button
          key={i}
          type="button"
          onKeyDown={onKeyDown(i)}
          aria-label={paperLabel(slot, i)}
          aria-pressed={carrying?.slot === i}
        >
          {paperLabel(slot, i)}
          {carrying?.slot === i && (
            <span aria-live="polite">
              {' '}
              — carrying; zone {controller.current?.zoneIds()[carrying.zoneIndex] ?? 'none'};
              Enter places, Escape returns
            </span>
          )}
        </button>
      ))}
    </div>
  )
}
