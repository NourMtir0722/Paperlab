import * as THREE from 'three'
import { gsap } from 'gsap'
import { useFrame, useThree } from '@react-three/fiber'
import type { ThreeEvent } from '@react-three/fiber'
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import type {
  BehaviorConfigInput,
  ClothConfig,
  CreaseConfig,
  StripConfig,
  ContentConfigInput,
  DeformerInstanceConfigInput,
  MemoryConfigInput,
  PaperConfig,
  PaperConfigInput,
  PhysicsConfigInput,
  SceneConfigInput,
  SheetConfig,
  StockName,
  SurfaceConfigInput,
} from './config/schema'
import { paperConfigSchema } from './config/schema'
import { mergeConfig, parsePreset, serializePreset } from './config/serialize'
import { computeSheetNormals } from './core/normals'
import { useStable } from './core/stable'
import { createSheetGeometry, resolveSegments } from './core/sheet'
import { FLAT_SEGMENTS, type SegmentPair } from './core/tessellation'
import { getStock } from './core/stock'
import { getPreset } from './config/presets'
import { useContentTexture } from './content/texture'
import { applyDeformerStack, displacePoint, stackAutoSegments, stackMinSegments } from './deformers/compose'
import { applyMemory, CreaseTracker } from './deformers/memory'
import { resolveCreases } from './surface/creases'
import { stackIsAnimated } from './deformers/registry'
import type { DeformerInstance } from './deformers/types'
import { getBehavior } from './behaviors/registry'
import { resolveDeformerStack } from './deformers/registry'
import type { Behavior } from './behaviors/types'
import { getIdlePreset, type IdleName, type IdlePose } from './physics/idle'
import { ClothSim } from './physics/cloth'
import { StripSim, stripNodeCount } from './physics/strip'
import { PaperMaterial } from './surface/PaperMaterial'
import { usePrefersReducedMotion } from './a11y'
import { quantizeProgress, quantizeTime } from './motion/onTwos'
import { usePaperStates } from './states/usePaperStates'
import type { PaperStateMachine, StateEvent } from './states/machine'

export interface PaperMeshProps {
  /** Built-in preset name, or a (partial) preset object. Props below override it. */
  preset?: string | PaperConfigInput
  sheet?: Partial<SheetConfig>
  stock?: StockName
  /**
   * These take the schema's INPUT types, not its parsed ones: writing
   * `content={{ type: 'text', text: 'hi' }}` has to compile, and with the
   * inferred type it does not — it demands every field of every nested
   * object. Every default stays a default.
   */
  content?: ContentConfigInput
  behavior?: BehaviorConfigInput
  deformers?: DeformerInstanceConfigInput[]
  /** Fragment-side effects: grain, aging, deckle, creases, perforation. */
  surface?: SurfaceConfigInput
  /**
   * What the sheet remembers being folded — how much of a fold this paper
   * keeps, and the creases it already carries. A sheet can be handed its
   * creases (a letter that arrives having been folded once) as readily as it
   * can be folded into them.
   */
  memory?: MemoryConfigInput
  /** Scene-level presentation that travels with the paper (lighting). */
  scene?: SceneConfigInput
  physics?: PhysicsConfigInput | 'cloth'
  onTwos?: boolean
  /** Show draggable behavior handles; cloth sheets become grabbable. */
  interactive?: boolean
  /** Start the behavior's transport loop on mount. */
  autoplay?: boolean
  /** Override prefers-reduced-motion (default: follow the system setting). */
  reducedMotion?: boolean
  position?: [number, number, number]
  rotation?: [number, number, number]
  /** Fires every animation tick with the behavior's progress (0..1). */
  onProgress?(value: number): void
  /** Fires when a handle drag ends, with the params the drag changed. */
  onBehaviorChange?(patch: Record<string, unknown>): void
  /**
   * Fires when folding the paper leaves a crease it did not have.
   *
   * The sheet applies its own creases immediately — this is how they get
   * PERSISTED. Recording happens in the frame loop, where a fold's peak
   * actually is, and routing that through React sixty times a second would
   * cost more than the rest of the feature; so the mesh holds the live truth
   * and reports it, and the host writes it into config whenever it likes.
   * The same split `onBehaviorChange` uses for handle drags.
   */
  onCrease?(creases: CreaseConfig[]): void
  /**
   * Interaction states: when the config carries `states`, pointer triggers
   * are live by default. Set false to sculpt a stateful paper without the
   * machine firing (the editor's state-editing mode).
   */
  stateTriggers?: boolean
  /** Fires when the state machine changes state. */
  onStateChange?(state: string): void
  /** Fires for `onEnter` actions ('emit:<event>'). */
  onStateAction?(event: string, state: string): void
}

export interface PaperHandle {
  play(): void
  pause(): void
  readonly playing: boolean
  /** Live-override a behavior param. 'progress' always maps to the behavior's progress param. */
  set(param: string, value: unknown): void
  getProgress(): number
  /** Current full state (including live overrides) as a preset. */
  snapshot(): PaperConfig
  toJSON(): string
  readonly mesh: THREE.Mesh | null
  /**
   * Where a behavior's grab point currently sits, in world space, or null
   * when the behavior has no handles (or `interactive` is off).
   *
   * The handle is not at the corner it names: it rides the deformed surface,
   * so its position is only known after the frame's deformer stack has run.
   * Anything that wants to point AT the handle — a coach-mark, a tooltip,
   * an arrow — has to ask the frame rather than compute a UV, which is why
   * reading it is a method here and not a prop the sheet could publish.
   *
   * Written into `target` when one is passed, so a per-frame reader does not
   * allocate a vector sixty times a second.
   */
  handlePoint(id?: string, target?: THREE.Vector3): THREE.Vector3 | null
  /** Interaction-state machine access (null when the config has no states). */
  readonly state: string
  sendState(event: StateEvent): string | null
  /**
   * Drive to 'picked' through the legal chain (rest→hover→pressed→picked),
   * instantly, so every side effect fires — the keyboard/a11y entry point
   * where no pointer hover/press ever ran. Returns true if it landed.
   */
  pickProgrammatic(): boolean
  /** Instant, legal place (picked → placed) so onEnter/emit fires. */
  placeProgrammatic(): boolean
  /** Instant, legal return (picked → rest). */
  returnProgrammatic(): boolean
}

/**
 * Everything {@link resolveConfig} reads, as a plain tuple.
 *
 * Compared with {@link useStable} rather than serialized: a dependency array
 * is evaluated on EVERY render, and `content` can hold a whole bitmap as a
 * data URL, so a `JSON.stringify` here was megabytes of garbage per frame of
 * a slider drag. (There was a `resolveConfigKey` exporting the string form
 * for consumers to key their own caches on; it was never part of the package
 * entry, so no consumer could reach it, and nothing else uses it now.)
 */
function configInputs(props: PaperMeshProps): unknown[] {
  return [
    props.preset ?? null,
    props.sheet ?? null,
    props.stock ?? null,
    props.content ?? null,
    props.behavior ?? null,
    props.deformers ?? null,
    props.surface ?? null,
    props.memory ?? null,
    props.scene ?? null,
    props.physics ?? null,
    props.onTwos ?? null,
  ]
}

/** Resolve once, and again only when the inputs actually differ. */
export function useResolvedConfig(props: PaperMeshProps): PaperConfig {
  const inputs = useStable(configInputs(props))
  // biome-ignore lint/correctness/useExhaustiveDependencies: `inputs` IS every prop resolveConfig reads; the props object itself is new each render.
  return useMemo(() => resolveConfig(props), [inputs])
}

/** Resolve preset + prop overrides into a validated config. */
export function resolveConfig(props: PaperMeshProps): PaperConfig {
  const base = props.preset
    ? typeof props.preset === 'string'
      ? getPreset(props.preset)
      : parsePreset(props.preset)
    : paperConfigSchema.parse({})
  const overrides: PaperConfigInput = {}
  if (props.sheet) overrides.sheet = { ...base.sheet, ...props.sheet }
  if (props.stock) overrides.stock = props.stock
  if (props.content) overrides.content = props.content
  if (props.behavior) overrides.behavior = props.behavior
  if (props.deformers) overrides.deformers = props.deformers
  // Surface merges over the stock's defaults rather than replacing them, so
  // `surface={{ grain: 0.6 }}` on thermal keeps thermal's banding.
  if (props.surface) overrides.surface = { ...base.surface, ...props.surface }
  // Merged like surface, and for the same reason: `memory={{ set: 0.2 }}` on a
  // preset that ships creased should turn the retention down, not flatten the
  // paper on its way past.
  if (props.memory) overrides.memory = { ...base.memory, ...props.memory }
  if (props.scene) overrides.scene = { ...base.scene, ...props.scene }
  if (props.physics) overrides.physics = props.physics
  if (props.onTwos !== undefined) overrides.onTwos = props.onTwos
  return paperConfigSchema.parse(mergeConfig(base as PaperConfigInput, overrides))
}

/** Cloth grids cap their resolution — 5k verlet particles is the budget ceiling. */
const CLOTH_MAX_SEGMENTS = 28

/** Where `'auto'` probes a behavior's sweep. Endpoints matter most — a play
 *  usually starts or ends at its tightest. */
const PROGRESS_SAMPLES = [0, 0.25, 0.5, 0.75, 1] as const

const dragPlane = new THREE.Plane()
const dragPoint = new THREE.Vector3()
const planeNormal = new THREE.Vector3()
const anchorScratch = new THREE.Vector3()
const worldScratch = new THREE.Vector3()
const quatScratch = new THREE.Quaternion()

/**
 * The atom: one sheet of paper, hero-mode CPU path. The deformer stack (or
 * the cloth sim — never both) writes geometry positions each frame. GSAP
 * owns animated values; useFrame owns geometry writes.
 */
export const PaperMesh = forwardRef<PaperHandle, PaperMeshProps>(function PaperMesh(props, ref) {
  // Each resolveConfig call is several zod parses (superRefine re-parses every
  // state override) — memoized so a render without config-prop changes is free.
  const resolved = useResolvedConfig(props)
  // Reduced motion: behaviors freeze at their resting pose, physics is off,
  // idle motion is off. The sheet still renders fully sculpted.
  const reduced = usePrefersReducedMotion(props.reducedMotion)
  // Interaction states: the machine animates a live config between state
  // overrides; `config` below is that animated view (the base when no states).
  // Reduced motion keeps the machine but makes transitions instant.
  const statesLive = Boolean(resolved.states) && props.stateTriggers !== false
  const {
    config,
    machine,
    state: machineState,
  } = usePaperStates(resolved, statesLive, reduced, props.onStateAction, props.onStateChange)
  const behavior: Behavior | null = config.behavior ? getBehavior(config.behavior.type) : null
  const machineRef = useRef<PaperStateMachine | null>(null)
  machineRef.current = machine
  // The animated `config` has `states` stripped — keep the resolved preset
  // around so snapshot()/toJSON() never lose the state machine.
  const resolvedRef = useRef(resolved)
  resolvedRef.current = resolved
  // Two object-shaped simulations now, so the kind is read off the tag rather
  // than off `typeof` — which was only ever "cloth" by having no rival.
  const simKind =
    !reduced && typeof config.physics === 'object' ? (config.physics.type as 'cloth' | 'strip') : null
  const isCloth = simKind === 'cloth'
  const isStrip = simKind === 'strip'
  const idle =
    !reduced && typeof config.physics === 'string' && config.physics !== 'none'
      ? getIdlePreset(config.physics as IdleName)
      : null

  const meshRef = useRef<THREE.Mesh>(null)
  const groupRef = useRef<THREE.Group>(null)
  const handleRefs = useRef<(THREE.Mesh | null)[]>([])

  const overridesRef = useRef<Record<string, unknown>>({})
  const dirtyRef = useRef(true)
  const playingRef = useRef(false)
  const tweenRef = useRef<gsap.core.Tween | null>(null)
  const draggingRef = useRef<string | null>(null)

  const configRef = useRef(config)
  configRef.current = config

  /**
   * The caller's rotation with the preset's `scene.turn` folded in.
   *
   * Additive, and about Y: `turn` is how the composition wants to be READ
   * (see `sceneSchema.turn`), while the prop is where the caller has decided
   * to put this paper. A preset does not get to overrule that, so it leans on
   * top of it.
   */
  const baseRotation = useMemo<[number, number, number]>(() => {
    const [rx, ry, rz] = props.rotation ?? [0, 0, 0]
    return [rx, ry + (config.scene.turn * Math.PI) / 180, rz]
  }, [props.rotation, config.scene.turn])

  const controls = useThree((s) => s.controls) as { enabled?: boolean } | null
  const camera = useThree((s) => s.camera)

  const behaviorKey = JSON.stringify(config.behavior ?? null)
  const deformersKey = JSON.stringify(config.deformers ?? null)
  const sheetKey = JSON.stringify(config.sheet)
  /**
   * What the SHAPE path needs to know about physics, and nothing more.
   *
   * Deliberately not `JSON.stringify(config.physics)`. A simulation's config
   * is live — `strip.scroll` is rewritten every single frame by the host —
   * and a key that moves every frame re-runs the segment probe, hands the
   * geometry memo fresh array identities, rebuilds the geometry, and through
   * it rebuilds the sim, which throws away everything the sim had integrated.
   * A scroll-driven roll pinned to its own starting tail forever, sixty times
   * a second.
   *
   * Nothing downstream of here reads a sim's VALUES: an object-shaped physics
   * means there is no deformer stack at all, so the only thing that can change
   * the shape path is whether a sim is present and which one.
   */
  const physicsKey = typeof config.physics === 'object' ? config.physics.type : config.physics

  /**
   * The crease LINES, without their depths.
   *
   * Depth is exactly the part that moves while you are folding, and the only
   * thing downstream of this key is the geometry probe — which does not care.
   * `fold`'s appetite for segments is set by its hinge radius and its
   * direction, never by how far it has closed, so a crease deepening from 2°
   * to 20° cannot change the answer. Keying on the depth too would rebuild
   * the geometry on every frame of every fold, and take the sim and the
   * base-position buffer down with it — the same trap `physicsKey` above
   * exists to avoid.
   */
  const memoryKey = config.memory.creases.map((c) => `${c.angle}:${c.offset}`).join('|')

  /**
   * The creases WITH their depths — what the sheet is actually carrying.
   *
   * The lines-only key above cannot serve here, and the difference is the
   * whole reason there are two. Dragging a crease deeper changes no line, so
   * a lines-only key never fires: the tracker would go on holding the array
   * it was handed when the crease was created, the shading would follow the
   * edit (it reads config) and the geometry would not, and the depth slider
   * would darken the mark without bending the paper.
   */
  const creaseKey = config.memory.creases.map((c) => `${c.angle}:${c.offset}:${c.depth}`).join('|')

  /**
   * The sheet's live memory. Seeded from config and updated in the frame
   * loop; `onCrease` is how it gets back to config.
   */
  const creasesRef = useRef<CreaseTracker | null>(null)
  creasesRef.current ??= new CreaseTracker(config.memory.creases)
  const creases = creasesRef.current

  // biome-ignore lint/correctness/useExhaustiveDependencies: The keys are change triggers; the body only touches refs.
  useEffect(() => {
    if (!draggingRef.current && !playingRef.current) overridesRef.current = {}
    // The slots track folds in a stack that no longer exists. The creases they
    // left do not go with it — a sheet does not un-crease because you gave it
    // a new behavior — so they carry over as the sheet's authored set.
    creases.reset()
    dirtyRef.current = true
  }, [behaviorKey, deformersKey, sheetKey, physicsKey])

  // Config-side creases changing means something outside the frame loop has an
  // opinion: an edit, a shared link, or the host persisting what we just
  // recorded. `adopt` works out which — an edit resets the folds it was
  // watching, an echo of its own recording does not.
  // biome-ignore lint/correctness/useExhaustiveDependencies: Keyed on the creases themselves; the body reads them off config.
  useEffect(() => {
    creases.adopt(configRef.current.memory.creases)
    dirtyRef.current = true
  }, [creaseKey])

  // biome-ignore lint/correctness/useExhaustiveDependencies: Keyed on the stack shape — the probe reads config off a ref.
  const { minSegments, autoSegments, animatedStack } = useMemo(() => {
    const cfg = configRef.current
    // Creases are in the probe because a crease with no live fold on its line
    // is a fold instance the grid has never been asked about — an authored
    // dog-ear on an otherwise flat sheet needs `fold`'s 48-segment floor as
    // much as a real fold does, and a flat sheet is tessellated 2×2.
    const probe = withMemory(buildStack(cfg, {}), cfg)
    if (!probe) {
      return {
        minSegments: [2, 2] as SegmentPair,
        autoSegments: [FLAT_SEGMENTS, FLAT_SEGMENTS] as SegmentPair,
        animatedStack: false,
      }
    }

    // The grid is built once; a behavior's stack is not the same shape all
    // the way through. An unroll is a tight roll at one end of its progress
    // and a flat sheet at the other, so sizing to the configured moment
    // would leave the sheet under-tessellated for the rest of the play.
    // Sample the sweep and keep the densest answer. Every behavior's
    // progressParam is a 0..1 number — pinned by behaviors.test.ts, because
    // this loop silently samples the wrong range if that ever stops holding.
    //
    // Whether the stack is TIME-DRIVEN is answered off the same sweep, and
    // for the same reason: it is a property of the stack's shape, not of the
    // moment it happens to be at, and the frame loop needs it before it has
    // built anything — see `useFrame` below.
    const want = stackAutoSegments(probe, cfg.sheet)
    let animated = stackIsAnimated(probe)
    if (cfg.behavior && !cfg.deformers) {
      const param = getBehavior(cfg.behavior.type).progressParam
      for (const p of PROGRESS_SAMPLES) {
        const at = withMemory(buildStack(cfg, { [param]: p }), cfg)
        if (!at) continue
        const [x, y] = stackAutoSegments(at, cfg.sheet)
        if (x > want[0]) want[0] = x
        if (y > want[1]) want[1] = y
        animated ||= stackIsAnimated(at)
      }
    }
    return {
      minSegments: stackMinSegments(probe, cfg.sheet),
      autoSegments: want,
      animatedStack: animated,
    }
  }, [behaviorKey, deformersKey, physicsKey, memoryKey])

  // biome-ignore lint/correctness/useExhaustiveDependencies: Keyed on the sheet — rebuilding geometry on identity would orphan GPU buffers every render.
  const geometry = useMemo(() => {
    if (isStrip) {
      // A strip is a 2×N quad ribbon: one column each side, one row per chain
      // node. The row count has to agree with the sim exactly, so both derive
      // it from the same function.
      const strip = configRef.current.physics as StripConfig
      const nodes = stripNodeCount(config.sheet.height, strip.perforation)
      return new THREE.PlaneGeometry(config.sheet.width, config.sheet.height, 1, nodes - 1)
    }
    if (!isCloth) return createSheetGeometry(config.sheet, minSegments, autoSegments)
    // Cloth: explicit capped grid so sim particles == mesh vertices.
    const [sx, sy] = resolveSegments(config.sheet, 2)
    const capped = Math.min(Math.max(sx, sy), CLOTH_MAX_SEGMENTS)
    return new THREE.PlaneGeometry(config.sheet.width, config.sheet.height, capped, capped)
  }, [
    sheetKey,
    minSegments,
    autoSegments,
    isCloth,
    isStrip,
    isStrip ? (config.physics as StripConfig).perforation : 0,
  ])

  // Imperatively-created geometry is ours to free — R3F only auto-disposes
  // JSX-created objects, so a sheet change would otherwise orphan GPU buffers.
  useEffect(() => () => geometry.dispose(), [geometry])

  const basePositions = useMemo(
    () => Float32Array.from(geometry.attributes.position!.array as Float32Array),
    [geometry],
  )

  // biome-ignore lint/correctness/useExhaustiveDependencies: Rebuild only on geometry or pin layout change — sliders update the sim in place.
  const stripSim = useMemo(() => {
    if (!isStrip) return null
    const strip = configRef.current.physics as StripConfig
    return new StripSim(config.sheet.height, config.sheet.width, {
      scroll: strip.scroll,
      tightness: strip.tightness,
      core: strip.core,
      tail: strip.tail,
      perforation: strip.perforation,
      crease: strip.crease,
      stiffness: strip.stiffness,
      drag: strip.drag,
      gravity: strip.gravity,
      floor: strip.floor,
      inertia: strip.inertia,
    })
  }, [geometry, isStrip])

  // biome-ignore lint/correctness/useExhaustiveDependencies: Rebuild only on geometry or pin layout change — sliders update the sim in place.
  const sim = useMemo(() => {
    if (!isCloth) return null
    const cloth = configRef.current.physics as ClothConfig
    const cols = (geometry.parameters as { widthSegments: number }).widthSegments + 1
    const rows = (geometry.parameters as { heightSegments: number }).heightSegments + 1
    return new ClothSim(cols, rows, config.sheet.width, config.sheet.height, cloth.pins, {
      stiffness: cloth.stiffness,
      gravity: cloth.gravity,
      wind: cloth.wind,
      floor: cloth.floor,
    })
  }, [geometry, isCloth, isCloth ? (config.physics as ClothConfig).pins : ''])

  const stock = getStock(config.stock)
  const texture = useContentTexture(config.content, config.sheet, stock)
  const backTexture = useContentTexture(config.content.back, config.sheet, stock)

  // Per-frame config: when a state machine is live it OWNS the animated numeric
  // values (GSAP tweens them); we poll its mutable liveConfig each frame rather
  // than routing every tick through React. Falls back to the React config for
  // non-stateful papers.
  const liveConfig = (): PaperConfig => machineRef.current?.liveConfig ?? configRef.current

  const effectiveOptions = (t: number): Record<string, unknown> | null => {
    const cfg = liveConfig()
    if (!cfg.behavior || !behavior) return null
    const o = { ...cfg.behavior, ...overridesRef.current }
    return behavior.loop ? { ...o, ...behavior.loop(o, t) } : o
  }

  const play = () => {
    if (!behavior) return
    playingRef.current = true
    if (tweenRef.current) {
      tweenRef.current.play()
      return
    }
    const param = behavior.progressParam
    const start = (effectiveOptions(0)?.[param] as number) ?? 0
    const state = { p: start }
    tweenRef.current = gsap.to(state, {
      p: 1,
      duration: behavior.duration * (1 - start),
      ease: 'power2.inOut',
      yoyo: behavior.loopMode === 'yoyo',
      repeat: -1,
      onRepeat: () => {
        if (behavior.loopMode === 'restart') state.p = 0
      },
      onUpdate: () => {
        const p = configRef.current.onTwos ? quantizeProgress(state.p, behavior.duration) : state.p
        overridesRef.current[param] = p
        dirtyRef.current = true
        props.onProgress?.(p)
      },
    })
  }

  const pause = () => {
    playingRef.current = false
    tweenRef.current?.pause()
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: Mount-only: autoplay starts once, and the cleanup kills the tween on unmount.
  useEffect(() => {
    if (props.autoplay && !reduced) play()
    return () => {
      tweenRef.current?.kill()
      tweenRef.current = null
    }
  }, [])

  const snapshot = (): PaperConfig => {
    // Re-attach `states`: the rendered config is the animated view with the
    // machine stripped, but a snapshot is a preset — states are part of it.
    const states = resolvedRef.current.states
    const cfg = states ? { ...configRef.current, states } : configRef.current
    if (!cfg.behavior) return states ? paperConfigSchema.parse(cfg) : cfg
    return paperConfigSchema.parse({
      ...cfg,
      behavior: { ...cfg.behavior, ...overridesRef.current },
    })
  }

  useImperativeHandle(ref, () => ({
    play,
    pause,
    get playing() {
      return playingRef.current
    },
    set(param: string, value: unknown) {
      const key = param === 'progress' && behavior ? behavior.progressParam : param
      overridesRef.current[key] = value
      dirtyRef.current = true
      if (behavior && key === behavior.progressParam) props.onProgress?.(value as number)
    },
    getProgress() {
      if (!behavior) return 0
      return (effectiveOptions(0)?.[behavior.progressParam] as number) ?? 0
    },
    snapshot,
    toJSON: () => serializePreset(snapshot()),
    get mesh() {
      return meshRef.current
    },
    handlePoint(id?: string, target?: THREE.Vector3) {
      const handles = behavior?.handles
      if (!handles?.length) return null
      const index = id ? handles.findIndex((h) => h.id === id) : 0
      const mesh = handleRefs.current[index]
      if (!mesh) return null
      return mesh.getWorldPosition(target ?? new THREE.Vector3())
    },
    get state() {
      return machineState
    },
    sendState: (event: StateEvent) => machineRef.current?.send(event) ?? null,
    pickProgrammatic: () => machineRef.current?.pickProgrammatic() ?? false,
    placeProgrammatic: () => machineRef.current?.placeProgrammatic() ?? false,
    returnProgrammatic: () => machineRef.current?.returnProgrammatic() ?? false,
  }))

  /**
   * The crease lines the shader draws.
   *
   * Off CONFIG rather than off the tracker, and that is the honest trade. The
   * shading is a shader uniform behind a React memo, so it updates when the
   * host writes a recorded crease back — a frame or two after the geometry
   * has it. A crease that has just formed is a fold the sheet is still most
   * of the way inside; the mark landing as it opens rather than as it closes
   * is the order it happens in on real paper anyway.
   */
  const shadedCreases = useMemo(
    () => resolveCreases(config.surface, config.memory.creases, config.sheet),
    [config.surface, config.memory.creases, config.sheet],
  )

  const idlePose = useRef<IdlePose>({ position: [0, 0, 0], rotation: [0, 0, 0] })

  useFrame(({ clock }, delta) => {
    const cfg = liveConfig()
    // Reduced motion freezes time-driven deformers at their resting phase.
    const now = reduced ? 0 : cfg.onTwos ? quantizeTime(clock.elapsedTime) : clock.elapsedTime

    // Whole-sheet motion — idle presets and behavior transforms (flight's
    // travel across the scene) compose additively; vertices stay untouched.
    const hasBehaviorTransform = Boolean(behavior?.transform && cfg.behavior)
    if ((idle?.transform || hasBehaviorTransform) && groupRef.current) {
      const pose = idlePose.current
      pose.position[0] = pose.position[1] = pose.position[2] = 0
      pose.rotation[0] = pose.rotation[1] = pose.rotation[2] = 0
      idle?.transform?.(now, pose)
      if (hasBehaviorTransform) {
        const o = effectiveOptions(now)
        if (o) behavior!.transform!(o, now, pose, cfg.sheet)
      }
      const base = props.position ?? [0, 0, 0]
      const baseRot = baseRotation
      groupRef.current.position.set(
        base[0] + pose.position[0],
        base[1] + pose.position[1],
        base[2] + pose.position[2],
      )
      groupRef.current.rotation.set(
        baseRot[0] + pose.rotation[0],
        baseRot[1] + pose.rotation[1],
        baseRot[2] + pose.rotation[2],
      )
    }

    // Simulation path: the strip owns the vertices.
    if (isStrip && stripSim) {
      const strip = cfg.physics as StripConfig
      stripSim.setParams({
        scroll: strip.scroll,
        tightness: strip.tightness,
        core: strip.core,
        tail: strip.tail,
        crease: strip.crease,
        stiffness: strip.stiffness,
        drag: strip.drag,
        gravity: strip.gravity,
        floor: strip.floor,
        inertia: strip.inertia,
      })
      stripSim.step(delta)
      if (!stripSim.asleep) {
        const position = geometry.attributes.position as THREE.BufferAttribute
        stripSim.writeInto(position.array as Float32Array)
        position.needsUpdate = true
        // Per-segment normals are what make the folds read: the underside of
        // each turn faces away from the key and goes dark on its own.
        computeSheetNormals(geometry)
        geometry.computeBoundingSphere()
      }
      return
    }

    // Simulation path: cloth owns the vertices.
    if (isCloth && sim) {
      const cloth = cfg.physics as ClothConfig
      sim.setParams({
        wind: cloth.wind,
        gravity: cloth.gravity,
        stiffness: cloth.stiffness,
        floor: cloth.floor,
      })
      sim.step(delta)
      if (!sim.asleep) {
        const position = geometry.attributes.position as THREE.BufferAttribute
        ;(position.array as Float32Array).set(sim.positions)
        position.needsUpdate = true
        computeSheetNormals(geometry)
      }
      return
    }

    // Shape path: the deformer stack.
    //
    // Decide whether there is anything to do BEFORE building it. A resting
    // sheet — no loop, no time-driven deformer, no transition, nothing
    // dirtied — used to expand its whole stack every frame and throw it
    // away, which is a behavior's `stack()` call and its deformer objects
    // sixty times a second for a picture that does not move.
    const animated = !reduced && animatedStack
    const hasLoop = !reduced && Boolean(cfg.behavior && behavior?.loop)
    // A state transition tweens numeric leaves off the React path, so the
    // stack must re-apply every frame while the machine is transitioning.
    const machineAnimating = Boolean(machineRef.current?.transitioning)
    if (!dirtyRef.current && !hasLoop && !animated && !machineAnimating) return

    const raw = buildStack(cfg, overridesRef.current, behavior, now)

    // How much this paper keeps: its own override, else what the stock is
    // made of. The same shape as every other stock default in the library.
    const setAmount = cfg.memory.set ?? stock.takesSet

    // Read the folds BEFORE memory rewrites them. `applyMemory` raises a live
    // fold to its crease's depth, and a tracker watching that would be reading
    // its own output — the crease would hold the fold open, and the held-open
    // fold would keep the crease alive, with nothing in the loop that is
    // actually the paper being folded.
    if (raw && creases.observe(raw, setAmount)) props.onCrease?.(creases.creases)

    const stack = withMemory(raw, cfg, creases.creases)
    if (!stack) return
    dirtyRef.current = false

    const ctx = { t: now, sheet: cfg.sheet }
    applyDeformerStack(geometry, basePositions, stack, ctx)

    if (props.interactive && behavior?.handles) {
      const o = effectiveOptions(now)
      behavior.handles.forEach((h, i) => {
        const mesh = handleRefs.current[i]
        if (!mesh || !o) return
        const [u, v] = h.anchor(o, cfg.sheet)
        anchorScratch.set((u - 0.5) * cfg.sheet.width, (v - 0.5) * cfg.sheet.height, 0)
        displacePoint(anchorScratch, u, v, stack, ctx)
        mesh.position.copy(anchorScratch)
      })
    }
  })

  const localDragPoint = (e: ThreeEvent<PointerEvent>): { x: number; y: number } | null => {
    const group = groupRef.current
    if (!group) return null
    planeNormal.set(0, 0, 1).applyQuaternion(group.getWorldQuaternion(quatScratch))
    dragPlane.setFromNormalAndCoplanarPoint(planeNormal, group.getWorldPosition(dragPoint))
    const hit = e.ray.intersectPlane(dragPlane, dragPoint)
    if (!hit) return null
    group.worldToLocal(hit)
    return { x: hit.x, y: hit.y }
  }

  const onHandleDrag = (e: ThreeEvent<PointerEvent>) => {
    if (!behavior?.handles || !draggingRef.current) return
    const handleSpec = behavior.handles.find((h) => h.id === draggingRef.current)
    const local = localDragPoint(e)
    const o = effectiveOptions(0)
    if (!handleSpec || !local || !o) return
    Object.assign(overridesRef.current, handleSpec.drag(local, o, configRef.current.sheet))
    dirtyRef.current = true
    const p = overridesRef.current[behavior.progressParam]
    if (typeof p === 'number') props.onProgress?.(p)
  }

  // Cloth grab: pick the nearest particle, then drag it on a camera-facing
  // plane through the grab point — full 3D pull, not just in-plane.
  const grabAnchor = useRef(new THREE.Vector3())
  const clothDown = (e: ThreeEvent<PointerEvent>) => {
    if (!isCloth || !sim || !props.interactive || !groupRef.current) return
    e.stopPropagation()
    if (controls) controls.enabled = false
    grabAnchor.current.copy(e.point) // world-space anchor for the drag plane
    const local = groupRef.current.worldToLocal(worldScratch.copy(e.point))
    sim.grabNearest(local.x, local.y, local.z)
    draggingRef.current = 'cloth'
    ;(e.target as Element).setPointerCapture(e.pointerId)
  }
  const clothMove = (e: ThreeEvent<PointerEvent>) => {
    if (draggingRef.current !== 'cloth' || !sim || !groupRef.current) return
    camera.getWorldDirection(planeNormal)
    dragPlane.setFromNormalAndCoplanarPoint(planeNormal, grabAnchor.current)
    const hit = e.ray.intersectPlane(dragPlane, dragPoint)
    if (!hit) return
    groupRef.current.worldToLocal(hit)
    sim.moveGrab(hit.x, hit.y, hit.z)
  }
  const clothUp = (e: ThreeEvent<PointerEvent>) => {
    if (draggingRef.current !== 'cloth' || !sim) return
    draggingRef.current = null
    if (controls) controls.enabled = true
    sim.release()
    ;(e.target as Element).releasePointerCapture(e.pointerId)
  }

  /**
   * Take hold of the paper and pull, and the roll turns.
   *
   * Same drag plane as cloth — camera-facing, through the point first
   * touched — which degrades the right way for a strip. Head-on, that plane
   * holds depth fixed and the gesture is purely up and down, which is the
   * pull the object is famous for; from three-quarters it opens up and the
   * paper can be drawn out toward the viewer as well.
   *
   * The sim reads only y and z: the strip carries its width along x and never
   * twists, so there is nothing for a sideways drag to mean.
   */
  const stripDown = (e: ThreeEvent<PointerEvent>) => {
    if (!isStrip || !stripSim || !props.interactive || !groupRef.current) return
    e.stopPropagation()
    const local = groupRef.current.worldToLocal(worldScratch.copy(e.point))
    // Nothing is committed until the grab lands. `grabNearest` returns -1 when
    // there is no free paper to catch — every node still wound on the roll
    // belongs to the spiral — and disabling the camera before finding that out
    // left the controls dead for good: the early return skips both the pointer
    // capture and `stripUp`, so nothing ever turned them back on.
    if (stripSim.grabNearest(local.y, local.z) < 0) return
    if (controls) controls.enabled = false
    grabAnchor.current.copy(e.point)
    draggingRef.current = 'strip'
    ;(e.target as Element).setPointerCapture(e.pointerId)
  }
  const stripMove = (e: ThreeEvent<PointerEvent>) => {
    if (draggingRef.current !== 'strip' || !stripSim || !groupRef.current) return
    camera.getWorldDirection(planeNormal)
    dragPlane.setFromNormalAndCoplanarPoint(planeNormal, grabAnchor.current)
    const hit = e.ray.intersectPlane(dragPlane, dragPoint)
    if (!hit) return
    groupRef.current.worldToLocal(hit)
    stripSim.moveGrab(hit.y, hit.z)
  }
  const stripUp = (e: ThreeEvent<PointerEvent>) => {
    if (draggingRef.current !== 'strip' || !stripSim) return
    draggingRef.current = null
    if (controls) controls.enabled = true
    stripSim.release()
    ;(e.target as Element).releasePointerCapture(e.pointerId)
  }

  // Interaction-state triggers (rest ↔ hover ↔ pressed); pick/place/return
  // are driven by the field's carry controller through `sendState`.
  const sendState = (event: StateEvent) => machineRef.current?.send(event)

  return (
    <group ref={groupRef} position={props.position} rotation={baseRotation}>
      <mesh
        ref={meshRef}
        geometry={geometry}
        castShadow
        receiveShadow
        frustumCulled={false}
        onPointerOver={statesLive ? () => sendState('enter') : undefined}
        onPointerOut={statesLive ? () => sendState('leave') : undefined}
        onPointerDown={
          isCloth || isStrip || statesLive
            ? (e) => {
                if (isCloth) clothDown(e)
                if (isStrip) stripDown(e)
                if (statesLive) sendState('down')
              }
            : undefined
        }
        onPointerMove={isCloth ? clothMove : isStrip ? stripMove : undefined}
        onPointerUp={
          isCloth || isStrip || statesLive
            ? (e) => {
                if (isCloth) clothUp(e)
                if (isStrip) stripUp(e)
                if (statesLive) sendState('up')
              }
            : undefined
        }
      >
        <PaperMaterial
          stock={stock}
          texture={texture}
          backTexture={backTexture}
          surface={config.surface}
          thickness={config.sheet.thickness}
          sheet={config.sheet}
          lighting={config.scene.lighting}
          creases={shadedCreases}
        />
      </mesh>
      {props.interactive &&
        // Any simulation, not cloth alone: a sim owns the vertices, so there
        // is no deformer stack for a handle to drive. Harmless as `!isCloth`
        // only because the schema makes a sim and a behavior exclusive — the
        // intent is what is written here.
        !simKind &&
        behavior?.handles?.map((h, i) => (
          <mesh
            key={h.id}
            // Marked as chrome so a renderer that is producing a PICTURE can
            // leave it out. The handle is an editing affordance, and it is
            // drawn with `depthTest: false` precisely so it sits on top of
            // the sheet — which makes it the most prominent thing in any
            // frame captured for export. The editor's capture rig reads this.
            userData={{ paperlabChrome: true }}
            ref={(m) => {
              handleRefs.current[i] = m
            }}
            onPointerDown={(e) => {
              e.stopPropagation()
              draggingRef.current = h.id
              pause()
              if (controls) controls.enabled = false
              ;(e.target as Element).setPointerCapture(e.pointerId)
            }}
            onPointerMove={onHandleDrag}
            onPointerUp={(e) => {
              if (!draggingRef.current) return
              draggingRef.current = null
              if (controls) controls.enabled = true
              ;(e.target as Element).releasePointerCapture(e.pointerId)
              props.onBehaviorChange?.({ ...overridesRef.current })
            }}
          >
            <sphereGeometry args={[0.035, 16, 16]} />
            <meshBasicMaterial color="#4f7cff" depthTest={false} transparent opacity={0.9} />
          </mesh>
        ))}
    </group>
  )
})

/**
 * A stack with the sheet's CONFIGURED creases folded in — the probe's view of
 * memory.
 *
 * The frame loop does not use this: it has the tracker's live creases, which
 * are ahead of config by however long the host takes to persist them. Both
 * paths agree on the lines, which is the only thing the geometry probe reads.
 */
function withMemory(
  stack: DeformerInstance[] | null,
  config: PaperConfig,
  creases: CreaseConfig[] = config.memory.creases,
): DeformerInstance[] | null {
  // A simulation owns the vertices, exactly as it does in `buildStack` — and
  // a crease must not be the thing that hands a cloth sheet a deformer stack
  // it would never run. The frame loop returns down the sim path long before
  // this, so today the only reader is the segment probe; saying it here is
  // what keeps that true when it stops being the only reader.
  if (typeof config.physics === 'object') return null
  const out = applyMemory(stack ?? [], creases)
  // Empty and null mean different things upstream — null is "nothing deforms
  // this sheet", which is the answer that gets it the flat-sheet grid.
  return out.length > 0 ? out : null
}

/** Expand the config into the deformer stack that should run this frame. */
function buildStack(
  config: PaperConfig,
  overrides: Record<string, unknown>,
  behavior?: Behavior | null,
  t = 0,
): DeformerInstance[] | null {
  // A simulation owns the vertices — no deformer stack.
  if (typeof config.physics === 'object') return null
  const idle =
    typeof config.physics === 'string' && config.physics !== 'none'
      ? getIdlePreset(config.physics as IdleName)
      : null
  const idleStack = idle?.stack?.() ?? []

  let shapeStack: DeformerInstance[] = []
  if (config.deformers) {
    // Raw deformer stack wins — it's the Advanced fork of a behavior.
    shapeStack = resolveDeformerStack(config.deformers)
  } else if (config.behavior) {
    const b = behavior ?? getBehavior(config.behavior.type)
    let options: Record<string, unknown> = { ...config.behavior, ...overrides }
    if (b.loop) options = { ...options, ...b.loop(options, t) }
    shapeStack = b.stack(options, config.sheet)
  }

  const combined = [...shapeStack, ...idleStack]
  return combined.length > 0 ? combined : null
}
