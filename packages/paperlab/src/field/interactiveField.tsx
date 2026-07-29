import * as THREE from 'three'
import { gsap } from 'gsap'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { useContext, useEffect, useMemo, useRef, useState } from 'react'
import { paperConfigSchema, type PaperConfigInput } from '../config/schema'
import { mergeConfig } from '../config/merge'
import { PaperMesh, type PaperHandle } from '../PaperMesh'
import { carryDrive, dampTo, type DampedValue } from '../physics/aero'
import { usePrefersReducedMotion } from '../a11y'
import { getLayout, type PaperPose } from './layouts'
import { tornEdgesOnDetach, type SheetLayoutOptions } from './sheetGrid'
import {
  DropZoneContext,
  DropZoneRegistry,
  DropZoneVisual,
  zoneAccepts,
  zoneContains,
  type DropZoneConfig,
  type PlacedPaper,
  type ZoneEntry,
} from './dropZones'
import { BackingSheet } from './backingSheet'
import { EMPTY_SET, resolveFieldSlotConfig, type FieldPaperSlot } from './slots'

/** Imperative field controls for the hidden a11y keyboard flow. */
export interface FieldA11yController {
  pick(slot: number): boolean
  placeAtZone(slot: number, zoneId: string): void
  cancel(slot: number): void
  zoneIds(): string[]
  slotState(slot: number): string
}

export interface InteractiveFieldProps {
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
export function InteractiveField(props: InteractiveFieldProps) {
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
        return patch ? paperConfigSchema.parse(mergeConfig(config as Record<string, unknown>, patch)) : config
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
    const pickedOverrides = config.states.states.picked?.overrides as { behavior?: unknown } | undefined
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
  // Handlers close over the current render's state, so the fresh closures live
  // in refs and the window listeners attach ONCE — re-subscribing per render
  // (worst: per slot-state change mid-drag) is listener churn for nothing.
  const onPointerMoveRef = useRef<(e: PointerEvent) => void>(() => {})
  onPointerMoveRef.current = (e: PointerEvent) => {
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
  const onPointerUpRef = useRef<(e: PointerEvent) => void>(() => {})
  onPointerUpRef.current = (e: PointerEvent) => {
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
  useEffect(() => {
    const move = (e: PointerEvent) => onPointerMoveRef.current(e)
    const up = (e: PointerEvent) => onPointerUpRef.current(e)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [])

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
  // Same ref-delegation as the pointer listeners: the real implementation is
  // rebuilt per render (fresh closures), the published object is stable.
  const a11yImplRef = useRef<FieldA11yController | null>(null)
  a11yImplRef.current = {
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
  useEffect(() => {
    const ref = props.a11yRef
    if (!ref) return
    ref.current = {
      pick: (slot) => a11yImplRef.current?.pick(slot) ?? false,
      placeAtZone: (slot, zoneId) => a11yImplRef.current?.placeAtZone(slot, zoneId),
      cancel: (slot) => a11yImplRef.current?.cancel(slot),
      zoneIds: () => a11yImplRef.current?.zoneIds() ?? [],
      slotState: (slot) => a11yImplRef.current?.slotState(slot) ?? 'rest',
    }
    return () => {
      ref.current = null
    }
  }, [props.a11yRef])

  return (
    <group>
      {sheetOptions?.backing && <BackingSheet options={sheetOptions} count={total} removed={removed} />}
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
