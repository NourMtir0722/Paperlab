import { createRoot } from 'react-dom/client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { FaceLandmarker, FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'
import { Paper, type DamageSource, type PaperHandle } from 'paperlab'
import {
  Afterglow,
  DamageField,
  FireEmitter,
  FxFireFluid,
  FxFireLight,
  FxFlames,
  FxMatchFlame,
  FxParticles,
  FxPost,
  FxWisps,
  ParticlePool,
  fxQualityFor,
  type FieldStats,
  type MatchFlameState,
} from 'paperlab/fx'
import { Breath } from './breath'
import { FIRE_FULL_FRONT, FIRE_LEVEL_EASE, HOLD, roomYield } from './burn'
import { FLAME_RADIUS, coolFromBlow, flameHeat } from './flame'
import { GestureReader, type GestureFrame } from './gestures'
import { pinchPoint, palmLength, toClient, type Landmark } from './landmarks'
import { LighterWatch, type FlameSighting } from './lighter'
import { Match, type MatchState } from './match'
import { drawOverlay, type HandMark } from './overlay'
import '../styles.css'
import { ModeTabs } from '../chrome/ModeTabs'

/**
 * **Set fire to a sheet of paper with your hands.**
 *
 * One effect, and it is the fire the lab tunes (`/fx-lab`): the same field,
 * the same simulator, the same look. Nothing is configured
 * here — the library's defaults ARE the tuned fire, so this page inherits
 * every change the lab makes without knowing about any of them.
 *
 * Two ways to light it, and the first is the one worth having:
 *
 *   a real flame    hold a lighter up to the camera    `lighter.ts`
 *   a pinch, held   a match, struck in free air        `match.ts`
 *
 * The camera is not asked to recognise a lighter. It is asked whether
 * anything in the frame is bright, warm and flickering, which is what a flame
 * is and what a lamp is not — see `lighter.ts`. Where that flame is in the
 * frame is where the paper catches, so you light the sheet by holding the
 * flame up to the part you want to burn.
 *
 * The pinch is the way in for anyone without a lighter, and it is the same
 * gesture as before: held still in free air for a third of a second, it is a
 * match. Blowing puts either of them out, and blowing hard enough puts the
 * whole burn out and leaves the edge smouldering.
 *
 * **A flame that is SEEN lights the sheet for good.** The first sighting — a
 * lighter in the frame, or a lit match touching the paper — holds a flame to
 * that spot for as long as the lab holds its scripted one (`HOLD`), whatever
 * the camera sees after, and the fire then runs until the whole sheet has
 * burnt. A flame that had to be seen on every frame to keep igniting was one
 * that flickered in and out of the detector and never properly caught.
 *
 * **What the camera sees is drawn over the page** (`overlay.ts`): the hand's
 * bones and a labelled box while it is tracked, and a box round a flame once
 * one is found, with a banner that says so. A hand driving something it cannot
 * feel has to be shown that it is being read.
 *
 * No sound (Noor, 2026-09-13).
 *
 * **Everything else that used to be here is gone.** Scoring, folding,
 * crumpling, painting, tearing, ripping, resizing, peeling, throwing, the
 * stock dial and the synthetic pointer were a vocabulary built to show that
 * the library could be driven by a hand. That case is made; this page is now
 * the fire's, and one page doing one thing well is worth more than twelve
 * gestures nobody can remember (Noor, 2026-09-13).
 */

/**
 * Where the tracker's two halves come from, and why they differ.
 *
 * The WASM is served by this page, from this origin. `pnpm hands:setup` puts
 * it there, copied out of `node_modules` — it is executable code running in a
 * page that holds a camera stream, nothing else in this repo pulls that from a
 * third party at runtime, and as `@mediapipe/tasks-vision` it is Apache-2.0,
 * so there is no question about hosting it ourselves.
 *
 * The MODEL WEIGHTS come from Google. That is deliberate and it is the more
 * interesting of the two: Google publishes no licence for them anywhere that
 * can be found — not the task's docs page, not the models page, and the model
 * card those link to is a 404. Serving them from our own origin would be
 * redistribution under terms nobody can read. Linking to them is not. So the
 * page makes exactly one third-party request, only when someone presses start,
 * and says so where they can see it.
 */
const TRACKER_BASE = new URL('tracker/', document.baseURI).href
const HAND_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'
/** The face model, behind blowing it out. Loaded second; the page works without it. */
const FACE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'

/** What to say when the setup step has not been run. */
const MISSING_ASSETS = 'the tracker’s wasm is not in apps/editor/.hands — run `pnpm hands:setup`'

async function assetsPresent(): Promise<boolean> {
  try {
    const response = await fetch(`${TRACKER_BASE}vision_wasm_internal.js`, { method: 'HEAD' })
    return response.ok
  } catch {
    return false
  }
}

type Status = 'idle' | 'starting' | 'live' | 'error'

/**
 * What the effects are allowed to cost here. Fixed rather than measured: this
 * page runs a camera, a hand tracker and a cloth simulation, and the fire's
 * own simulation is untiered — every device burns the same fire, this only
 * decides how much of it is drawn.
 */
const FX_TIER = 'medium' as const

/** How far back the camera stands, so the whole sheet and the floor are in frame. */
const CAMERA_Z = 3.6

/** Where the floor lies — the same height the sheet stops at, so a burnt piece lands on it. */
const FLOOR_Y = -1.05

/** A breath reading older than this has stopped counting. */
const BREATH_STALE_MS = 500

/**
 * How long the "fire detected" banner outlasts the last sighting. The
 * detector's answer flickers with the flame it is reading; a banner that
 * flickered with it would read as the page being unsure.
 */
const BANNER_HOLD_MS = 1500

/**
 * How long ago the last face reading was, on whatever clock is being used.
 *
 * The DISTANCE, not the difference. `drive` lets a caller own the clock so a
 * timed gesture can be tested without a wall clock, and a test that hands the
 * page an injected time and then goes back to `performance.now()` moves the
 * clock BACKWARDS — at which point a plain subtraction is negative, the
 * reading never goes stale, and the last breath anyone blew goes on blowing
 * forever. A reading from a clock that no longer agrees with this one is not
 * a fresh reading either way round.
 */
const sinceBreath = (now: number, at: number): number => Math.abs(now - at)

/** How fast the air in the room moves, per unit of `cloth.wind`. */
const SMOKE_WIND = 1.2

/** How far in front of the sheet a flame held in free air stands (~2 cm). */
const AIR_Z = 0.1
const airPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -AIR_Z)
const airPoint = new THREE.Vector3()

/**
 * What the sheet draws: the burn's `Afterglow`, plus how much of the room's
 * light is left while the fire burns (`DamageSource.firelight`).
 *
 * The fire is the key light while it burns and the room yields to it — the
 * lab does exactly this with its own wrapper (`FieldView`), and a page that
 * inherits the lab's fire should inherit its light too. `Afterglow` carries
 * no firelight of its own, so this forwards everything else to it.
 */
class Firelit implements DamageSource {
  readonly firelight = { room: 1 }
  constructor(private readonly glow: DamageSource) {}
  get size() {
    return this.glow.size
  }
  get pixels() {
    return this.glow.pixels
  }
  get version() {
    return this.glow.version
  }
  get detail() {
    return this.glow.detail
  }
  get time() {
    return this.glow.time
  }
  get look() {
    return this.glow.look
  }
}

/**
 * Where the panel's struck match is held, and for how long — the way in on a
 * machine with no camera. Below the middle, because paper burns upward.
 *
 * In seconds of the BURN's clock, not the page's: a burn advances a fifteenth
 * of a second per frame however long the frame took, so a match measured in
 * wall time is a shorter match on a slow machine.
 */
const STRIKE_AT = { u: 0.5, v: 0.32 }

/** How often the camera frame is searched for a flame — every other frame is ten a second. */
const LIGHTER_EVERY = 2

/** How big a frame the flame is looked for in. Small on purpose: it is a blob, not a face. */
const LIGHTER_WIDTH = 320
const LIGHTER_HEIGHT = 240

const NO_STATS: FieldStats = { front: 0, charred: 0, consumed: 0, wetted: 0, saturation: 0, remaining: 1 }

/** A fresh field, at the tier's edge detail. */
function newField(): DamageField {
  const field = new DamageField()
  field.detail = fxQualityFor(FX_TIER).detail
  return field
}

/** What a hand looks like coming out of the tracker — or out of the harness. */
export interface HandInput {
  landmarks: Landmark[]
  /** The tracker's confidence that this is a hand, 0..1 — for the label. Scripted hands leave it out. */
  score?: number
}

/** What one frame of hands and faces did to the fire. What `test:hands` reads. */
interface DriveResult {
  /** The acting hand's pose. */
  gesture: GestureFrame
  /** The match in hand: none, arming, or lit. */
  match: MatchState
  /** Whether the camera can see a flame of its own. */
  lighter: boolean
  /** Where the paper is being lit, in UV, or null. */
  at: { u: number; v: number } | null
  /**
   * Where the acting hand is pointing on the sheet, lit or not — what a
   * script uses to find the paper, since a scripted hand cannot see it.
   */
  uv: { u: number; v: number } | null
  /** Fraction of the sheet's texels on the burn front. */
  front: number
  /** Fraction of the sheet still there. */
  remaining: number
  particles: number
  blow: number
}

declare global {
  interface Window {
    /**
     * The camera, bypassed.
     *
     * `pnpm test:hands` drives this with scripted hands and painted frames,
     * because the claim worth testing is not the tracking — it is that a
     * held match lights the paper, that a flame in the frame does, and that
     * a breath puts it out. A webcam cannot be automated and is not the part
     * that can break. `now` lets a script own the clock: a match is defined
     * by how long it is held, and a timing gesture measured against wall
     * time is a test that passes on a laptop and fails on a loaded CI box.
     */
    __HANDS__?: {
      drive(
        hands: HandInput[] | null,
        aspect: number,
        face?: { pucker: number } | null,
        now?: number,
      ): DriveResult
      /** Hand the lighter watch a frame of pixels, as the camera would. */
      sees(pixels: Uint8Array, width: number, height: number): boolean
      /** Live vertex positions of the sheet, for seeing whether it moved. */
      vertices(): number[] | null
      /** What the overlay is drawing right now: a tracked hand, a found flame. */
      marks(): { hand: boolean; fire: boolean }
      /** A fresh sheet, without waiting for the panel's button to appear. */
      fresh(): void
    }
  }
}

interface StageApi {
  canvas: HTMLCanvasElement
  /** Where a client-space point lands on the sheet, or null if it missed. */
  hitUV(clientX: number, clientY: number): { u: number; v: number } | null
  /** Where it is in the air in front of the sheet, in world space. */
  worldAt(clientX: number, clientY: number): { x: number; y: number; z: number } | null
}

const ndc = new THREE.Vector2()

/**
 * Hands the canvas and a raycaster up to the page: where a flame is on the
 * sheet is a raycast, and a child inside the canvas can simply ask for the
 * camera rather than the page guessing.
 */
function CanvasBridge({ getMesh, onReady }: { getMesh(): THREE.Mesh | null; onReady(api: StageApi): void }) {
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const raycaster = useThree((s) => s.raycaster)

  useEffect(() => {
    camera.position.z = CAMERA_Z
    camera.updateProjectionMatrix()
  }, [camera])

  useEffect(() => {
    onReady({
      canvas: gl.domElement,
      hitUV(clientX, clientY) {
        const mesh = getMesh()
        if (!mesh) return null
        const rect = gl.domElement.getBoundingClientRect()
        ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1)
        raycaster.setFromCamera(ndc, camera)
        // The sim rewrites vertices every frame and does not touch the bounds
        // it left behind: a stale sphere makes a draped sheet unhittable.
        mesh.geometry.computeBoundingSphere()
        const hit = raycaster.intersectObject(mesh, false)[0]
        return hit?.uv ? { u: hit.uv.x, v: hit.uv.y } : null
      },
      worldAt(clientX, clientY) {
        const rect = gl.domElement.getBoundingClientRect()
        ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1)
        raycaster.setFromCamera(ndc, camera)
        const at = raycaster.ray.intersectPlane(airPlane, airPoint)
        return at ? { x: at.x, y: at.y, z: at.z } : null
      },
    })
  }, [gl, camera, raycaster, getMesh, onReady])

  return null
}

/** Everything the fire needs, handed to the loop that advances it. */
interface FireRig {
  field: DamageField
  /** What the sheet draws — the field, plus the embers a blown-out edge keeps. */
  glow: Afterglow
  pool: ParticlePool
  emitter: FireEmitter
  /** Where a flame is on the sheet, in UV, or null. The camera loop writes it. */
  flame: React.RefObject<{ u: number; v: number } | null>
  /**
   * A flame held to the paper whatever the camera sees next: where, and how
   * much of it is left, in seconds of the burn's clock. The panel's match
   * and every first sighting set it.
   */
  ignition: React.RefObject<{ at: { u: number; v: number }; left: number }>
  /** What the sheet draws, and how much of the room's light is left. */
  view: Firelit
  matchFlame: React.RefObject<MatchFlameState>
  stats: React.RefObject<FieldStats>
  wind(): number
  /** How hard the viewer is blowing, 0..1 — a real one cools the fire. */
  blow(): number
  locate(u: number, v: number): { x: number; y: number; z: number } | null
  /** The sheet has burnt at all — said with WHICH field, so a stale one can be ignored. */
  onBurnt(field: DamageField): void
}

/**
 * The fire's own frame loop, inside the canvas.
 *
 * On the RENDER clock rather than the tracker's. The camera delivers about
 * thirty frames a second and none at all when it is off, so a burn driven
 * from the camera loop ran at the camera's rate, stalled whenever a hand left
 * the frame, and could not be lit on a machine without a camera. A fire that
 * only burns while someone is watching it is an animation of one.
 */
function Fire({ rig }: { rig: FireRig }) {
  const held = useRef(0)
  /** How big the fire is, 0..1, eased — what the room's light yields to. */
  const level = useRef(0)
  useFrame((_, delta) => {
    const dt = Math.min(0.1, Math.max(0, delta))
    const { field, pool, emitter } = rig
    const ignition = rig.ignition.current
    const struck = ignition.left > 0
    const at = rig.flame.current ?? (struck ? ignition.at : null)
    if (at) {
      held.current += dt
      field.ignite(at.u, at.v, FLAME_RADIUS, flameHeat(held.current, dt))
    } else {
      held.current = 0
    }
    if (struck) ignition.left = Math.max(0, ignition.left - dt)
    // A real blow takes heat off the sheet; a sustained one puts the fire out
    // and leaves the edge to smoulder. The same function the lab's blow uses.
    coolFromBlow(field, rig.blow(), dt)
    const stats = field.step(dt)
    rig.glow.step(dt, rig.blow())
    rig.stats.current = stats
    const air = rig.wind() * SMOKE_WIND
    pool.wind[0] = air * 0.25
    pool.wind[2] = air
    emitter.update(dt)
    pool.step(dt)
    // Nothing listens for the pops — the page is silent — but the pool counts
    // them either way, so they are drained rather than left to pile up.
    pool.takePops()
    // The fire is the key light while it burns, and the room yields to it —
    // the lab's ease and the lab's share, on the burn's own clock.
    const target = Math.min(1, stats.front / FIRE_FULL_FRONT)
    level.current += (target - level.current) * (1 - Math.exp(-dt / FIRE_LEVEL_EASE))
    rig.view.firelight.room = 1 - ROOM_YIELD * level.current
    if (stats.charred > 0 || stats.remaining < 1) rig.onBurnt(field)
  })
  return null
}

/** The sheet: the lab's own, hung by its top edge over a floor it can fall onto. */
const PAPER = {
  content: { type: 'text' as const, text: 'Same sky.\nDifferent days.\nA kinder view.', size: 40 },
  stock: 'printer' as const,
  physics: {
    type: 'cloth' as const,
    pins: 'top-edge' as const,
    wind: 0,
    stiffness: 0.8,
    gravity: 1,
    floor: FLOOR_Y,
  },
  scene: { lighting: 'noir' as const, floor: { enabled: true, y: FLOOR_Y } },
}

/** How much of the room's light the fire takes over at its height — the lab's, for this lighting. */
const ROOM_YIELD = roomYield(PAPER.scene.lighting)

function App() {
  const [status, setStatus] = useState<Status>('idle')
  const [message, setMessage] = useState('')
  const [blowReady, setBlowReady] = useState(false)
  /** Whether the camera can see a flame right now — the panel says so. */
  const [sawLighter, setSawLighter] = useState(false)
  /**
   * Whether this sheet has been burnt at all. React state, set ONCE, and the
   * only thing about the fire that is: the rest is read off the field every
   * frame, because a number that changes sixty times a second has no business
   * re-rendering the tree that owns the canvas.
   */
  const [burnt, setBurnt] = useState(false)
  const burntRef = useRef(false)

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const cursorRef = useRef<HTMLDivElement | null>(null)
  const readoutRef = useRef<HTMLParagraphElement | null>(null)

  const paperRef = useRef<PaperHandle | null>(null)
  const stageRef = useRef<StageApi | null>(null)
  const landmarkerRef = useRef<HandLandmarker | null>(null)
  const faceRef = useRef<FaceLandmarker | null>(null)
  const readerRef = useRef<GestureReader>(new GestureReader())
  const matchRef = useRef<Match>(new Match())
  const breathRef = useRef<Breath>(new Breath(0))
  const breathAtRef = useRef(0)
  const watchRef = useRef<LighterWatch>(new LighterWatch())
  /** The little canvas the camera frame is searched in. */
  const sampleRef = useRef<HTMLCanvasElement | null>(null)

  // ── Fire. The field is what has happened to the sheet; the pool and the
  //    emitter are what the burn throws into the air.
  const fieldRef = useRef<DamageField | null>(null)
  const glowRef = useRef<Afterglow | null>(null)
  const poolRef = useRef<ParticlePool | null>(null)
  const emitterRef = useRef<FireEmitter | null>(null)
  const lastMatchRef = useRef<MatchState>('none')
  const flameRef = useRef<{ u: number; v: number } | null>(null)
  const matchFlameRef = useRef<MatchFlameState>({ position: null, state: 'none', blow: 0, touching: false })
  const ignitionRef = useRef({ at: STRIKE_AT, left: 0 })
  const viewRef = useRef<Firelit | null>(null)
  /** The overlay, and what it is drawing — see `overlay.ts`. */
  const overlayRef = useRef<HTMLCanvasElement | null>(null)
  const handMarkRef = useRef<HandMark | null>(null)
  const flameMarkRef = useRef<FlameSighting | null>(null)
  /** When the camera last saw a flame — the banner outlasts a flicker. */
  const lastSeenRef = useRef(Number.NEGATIVE_INFINITY)
  /** `fresh`, for the scripted hook — which is installed before `fresh` is defined. */
  const freshRef = useRef<() => void>(() => {})
  const statsRef = useRef<FieldStats>(NO_STATS)
  const worldRef = useRef(new THREE.Vector3())
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef(0)
  const windRef = useRef(0)
  /**
   * The breath, as the sheet's own wind.
   *
   * Two copies of one number on purpose. `windRef` is read every frame by the
   * smoke and the flames, which are drawn from refs and never re-render; the
   * cloth's `wind` is a PROP, and a prop written every frame re-renders the
   * tree that owns the canvas. `Breath` already quantises — that is what
   * `WIND_STEP` is for — so the prop only has to be published when the
   * quantised value actually changes, which is once or twice a breath.
   */
  const [wind, setWind] = useState(0)
  const windQRef = useRef(0)

  const locate = useCallback(
    (u: number, v: number) => paperRef.current?.surfacePoint(u, v, worldRef.current) ?? null,
    [],
  )

  const fireRefs = useCallback(() => {
    fieldRef.current ??= newField()
    glowRef.current ??= new Afterglow(fieldRef.current)
    viewRef.current ??= new Firelit(glowRef.current)
    poolRef.current ??= new ParticlePool(fxQualityFor(FX_TIER).particles)
    emitterRef.current ??= new FireEmitter(fieldRef.current, poolRef.current, locate, {
      caps: fxQualityFor(FX_TIER).caps,
    })
    return {
      field: fieldRef.current,
      glow: glowRef.current,
      pool: poolRef.current,
      emitter: emitterRef.current,
    }
  }, [locate])

  /**
   * Latched once: see `burnt`.
   *
   * Only for the CURRENT sheet. A fresh sheet swaps the field in refs and
   * asks React to re-render; until it has, the frame loop is still holding
   * the old field and still reporting it burnt — and when the reset came from
   * outside a React event (the scripted hook), that report landed before the
   * re-render, latched `burnt` straight back to true, cancelled the state
   * change, and the page never re-rendered at all: the fire went on burning
   * the old sheet under a panel that said it was fresh.
   */
  const markBurnt = useCallback((field: DamageField) => {
    if (field !== fieldRef.current || burntRef.current) return
    burntRef.current = true
    setBurnt(true)
  }, [])

  /** Strike a match, without a hand. The way in for anyone with no camera. */
  const strike = useCallback(() => {
    ignitionRef.current = { at: STRIKE_AT, left: HOLD }
  }, [])

  /**
   * A flame has touched the paper at `at`: hold one there for the lab's
   * `HOLD`, whatever the camera sees next, and let the fire run from there
   * until the sheet is gone.
   *
   * Only on a sheet that is not already alight. A burning sheet needs no more
   * lighting, and one fire started from where the flame first touched is what
   * was asked for — "the burn starts from where he started the fire".
   */
  const commit = useCallback((at: { u: number; v: number }) => {
    if (statsRef.current.front > 0 || ignitionRef.current.left > 0) return
    ignitionRef.current = { at, left: HOLD }
  }, [])

  /** Redraw what the camera sees over the stage. */
  const paintOverlay = useCallback(() => {
    const canvas = overlayRef.current
    const stage = stageRef.current
    if (!canvas || !stage) return
    const ratio = window.devicePixelRatio || 1
    const width = Math.round(canvas.clientWidth * ratio)
    const height = Math.round(canvas.clientHeight * ratio)
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
    }
    const context = canvas.getContext('2d')
    if (context)
      drawOverlay(context, stage.canvas.getBoundingClientRect(), handMarkRef.current, flameMarkRef.current)
  }, [])

  const getMesh = useCallback(() => paperRef.current?.mesh ?? null, [])
  const onReady = useCallback((api: StageApi) => {
    stageRef.current = api
  }, [])

  /**
   * The per-frame readout, written straight to the DOM: thirty setState calls
   * a second to move a dot would re-render the tree that owns the canvas.
   */
  const paint = useCallback((result: DriveResult, at: { x: number; y: number } | null) => {
    const cursor = cursorRef.current
    if (cursor) {
      cursor.style.transform = `translate(${at?.x ?? 0}px, ${at?.y ?? 0}px)`
      cursor.style.opacity = at ? '1' : '0'
      cursor.dataset.flame = result.match === 'lit' ? 'lit' : result.match === 'arming' ? 'arming' : 'none'
    }
    const readout = readoutRef.current
    if (readout) {
      readout.textContent = [
        result.lighter ? 'a flame in the frame' : result.match === 'lit' ? 'a match, lit' : result.match,
        `front ${(result.front * 100).toFixed(1)}%`,
        `left ${(result.remaining * 100).toFixed(0)}%`,
        `air ${result.particles}`,
        `blow ${result.blow.toFixed(2)}`,
      ].join(' · ')
    }
  }, [])

  /**
   * One frame of hands: the pose, the match it may be holding, and where on
   * the sheet that flame lands.
   *
   * Split from the camera loop so `test:hands` can drive it with scripted
   * hands and its own clock.
   */
  const step = useCallback(
    (
      hands: HandInput[] | null,
      aspect: number,
      face?: { pucker: number } | null,
      now = performance.now(),
    ) => {
      const stage = stageRef.current
      const rect = stage?.canvas.getBoundingClientRect() ?? null
      const hand = hands?.[0]?.landmarks ?? null
      const gesture = readerRef.current.read(hand, aspect)

      if (face) {
        windRef.current = breathRef.current.push(face.pucker)
        breathAtRef.current = now
      } else if (sinceBreath(now, breathAtRef.current) > BREATH_STALE_MS) {
        windRef.current = breathRef.current.push(null)
      }
      if (windRef.current !== windQRef.current) {
        windQRef.current = windRef.current
        setWind(windRef.current)
      }
      const blow = sinceBreath(now, breathAtRef.current) < BREATH_STALE_MS ? breathRef.current.blow : 0

      const at = hand ? pinchPoint(hand) : null
      const palm = hand ? palmLength(hand, aspect) : null
      const client = at && rect ? toClient(at, rect) : null
      const uv = client ? (stage?.hitUV(client.x, client.y) ?? null) : null
      const match = matchRef.current.push({
        pinching: gesture.name === 'pinch',
        at,
        palm,
        blow,
        now,
        aspect,
      })

      // A lit match is a flame in the world, drawn where the hand is; where it
      // touches the paper is where the paper catches.
      const world = match !== 'none' && client ? (stage?.worldAt(client.x, client.y) ?? null) : null
      const flame = match === 'lit' && client ? (stage?.hitUV(client.x, client.y) ?? null) : null
      const m = matchFlameRef.current
      m.state = match
      m.position = world
      m.blow = blow
      m.touching = flame !== null
      m.time = now / 1000
      if (match === 'lit') flameRef.current = flame
      else if (lastMatchRef.current === 'lit') flameRef.current = null
      // Where a lit match first touches the paper is where the fire starts.
      if (flame) commit(flame)
      lastMatchRef.current = match

      handMarkRef.current = hand ? { landmarks: hand, score: hands?.[0]?.score ?? 1, match } : null
      paintOverlay()

      const stats = statsRef.current
      const result: DriveResult = {
        gesture,
        match,
        lighter: flameRef.current !== null && match !== 'lit',
        at: flameRef.current,
        uv,
        front: stats.front,
        remaining: stats.remaining,
        particles: poolRef.current?.count ?? 0,
        blow,
      }
      paint(result, client)
      return result
    },
    [commit, paint, paintOverlay],
  )

  /**
   * A flame the camera can see, wherever it is in the frame.
   *
   * The paper catches where the flame IS: the frame's coordinates are mapped
   * the same way a hand's are, so holding a lighter up to the top left of the
   * sheet burns the top left of the sheet.
   */
  const sees = useCallback(
    (pixels: Uint8Array, width: number, height: number) => {
      const stage = stageRef.current
      const seen = watchRef.current.see(pixels, width, height)
      flameMarkRef.current = seen
      paintOverlay()
      // The banner says so while a flame is seen, and for a moment after: the
      // detector's answer flickers with the flame, and a banner that flickered
      // with it would read as doubt.
      const now = performance.now()
      if (seen) {
        lastSeenRef.current = now
        setSawLighter(true)
      } else if (now - lastSeenRef.current > BANNER_HOLD_MS) {
        setSawLighter(false)
      }
      // Only while the match is not in charge: a hand holding a lit match is
      // already saying where the fire is, and two answers is none.
      if (matchRef.current.lit) return seen !== null
      if (!seen) {
        // The lighter left the frame. Whatever has caught goes on burning —
        // that is what a fire does — but nothing is lighting the paper any
        // more, and a flame left behind would go on igniting fresh texels
        // forever from wherever it was last seen.
        flameRef.current = null
        return false
      }
      if (!stage) return true
      const client = toClient(seen, stage.canvas.getBoundingClientRect())
      flameRef.current = stage.hitUV(client.x, client.y)
      if (flameRef.current) commit(flameRef.current)
      return true
    },
    [commit, paintOverlay],
  )

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    readerRef.current.reset()
    matchRef.current.reset()
    breathRef.current.reset()
    watchRef.current.reset()
    flameRef.current = null
    matchFlameRef.current.state = 'none'
    matchFlameRef.current.position = null
    handMarkRef.current = null
    flameMarkRef.current = null
    paintOverlay()
    landmarkerRef.current?.close()
    landmarkerRef.current = null
    faceRef.current?.close()
    faceRef.current = null
    setBlowReady(false)
    setSawLighter(false)
    for (const track of streamRef.current?.getTracks() ?? []) track.stop()
    streamRef.current = null
    setStatus('idle')
  }, [paintOverlay])

  const start = useCallback(async () => {
    setStatus('starting')
    setMessage('asking for the camera…')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' },
      })
      streamRef.current = stream
      const video = videoRef.current
      if (!video || !stageRef.current) throw new Error('the page is not mounted yet')
      video.srcObject = stream
      await video.play()

      setMessage('loading the hand model…')
      if (!(await assetsPresent())) throw new Error(MISSING_ASSETS)
      const fileset = await FilesetResolver.forVisionTasks(TRACKER_BASE)
      // GPU is worth trying and not worth insisting on: the delegate fails on
      // some drivers, and CPU at one hand is comfortably fast enough here.
      const options = {
        baseOptions: { modelAssetPath: HAND_MODEL_URL, delegate: 'GPU' as const },
        runningMode: 'VIDEO' as const,
        // One: the hand that holds the flame. The rest of the vocabulary that
        // needed a second one is gone.
        numHands: 1,
        // Forgiving on purpose. At the defaults (0.5 each) the tracker drops a
        // hand the moment it turns side-on to hold a pinch, and a match that
        // goes out because the tracker blinked was the first thing Noor met:
        // "the sensitivity is bad".
        minHandDetectionConfidence: 0.35,
        minHandPresenceConfidence: 0.35,
        minTrackingConfidence: 0.35,
      }
      landmarkerRef.current = await HandLandmarker.createFromOptions(fileset, options).catch(() =>
        HandLandmarker.createFromOptions(fileset, {
          ...options,
          baseOptions: { ...options.baseOptions, delegate: 'CPU' as const },
        }),
      )

      setStatus('live')
      setMessage('')

      // The face model is several megabytes and only blowing needs it, so it
      // loads AFTER the hands are live. If it never arrives, everything but
      // blowing the fire out still works.
      FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: FACE_MODEL_URL, delegate: 'GPU' as const },
        runningMode: 'VIDEO',
        outputFaceBlendshapes: true,
        numFaces: 1,
      })
        .then((face) => {
          if (!streamRef.current) return face.close()
          faceRef.current = face
          setBlowReady(true)
        })
        .catch(() => setBlowReady(false))

      let lastFrame = -1
      let pucker: number | null = null
      let tick = 0
      const loop = () => {
        rafRef.current = requestAnimationFrame(loop)
        const landmarker = landmarkerRef.current
        if (!landmarker || video.readyState < 2) return
        // The camera runs at its own rate. Detecting the same frame twice
        // costs a full inference and tells us nothing new.
        if (video.currentTime === lastFrame) return
        lastFrame = video.currentTime
        const stamp = performance.now()
        const result = landmarker.detectForVideo(video, stamp)

        // A face costs a second inference, and a mouth does not change shape
        // in 33 ms — so it runs on every other frame and the last reading
        // stands in between.
        const faceModel = faceRef.current
        if (faceModel && tick % 2 === 0) {
          const blendshapes = faceModel.detectForVideo(video, stamp).faceBlendshapes[0]
          pucker = blendshapes?.categories.find((c) => c.categoryName === 'mouthPucker')?.score ?? null
        }

        // And the flame, on its own beat: it is a blob of bright pixels, so it
        // is looked for in a small frame and only every few frames.
        if (tick % LIGHTER_EVERY === 0) {
          sampleRef.current ??= document.createElement('canvas')
          const sample = sampleRef.current
          sample.width = LIGHTER_WIDTH
          sample.height = LIGHTER_HEIGHT
          const context = sample.getContext('2d', { willReadFrequently: true })
          if (context) {
            context.drawImage(video, 0, 0, LIGHTER_WIDTH, LIGHTER_HEIGHT)
            const frame = context.getImageData(0, 0, LIGHTER_WIDTH, LIGHTER_HEIGHT)
            sees(new Uint8Array(frame.data.buffer), LIGHTER_WIDTH, LIGHTER_HEIGHT)
          }
        }
        tick += 1

        step(
          result.landmarks.map((landmarks, i) => ({
            landmarks: [...landmarks],
            score: result.handedness[i]?.[0]?.score,
          })),
          video.videoWidth / video.videoHeight,
          pucker === null ? null : { pucker },
          stamp,
        )
      }
      loop()
    } catch (error) {
      setStatus('error')
      setMessage(String(error instanceof Error ? error.message : error))
      stop()
    }
  }, [sees, step, stop])

  useEffect(() => stop, [stop])

  // The scripted-hand hook. Same shape as the other harnesses' globals, and
  // dev-only for the same reason they are.
  useEffect(() => {
    window.__HANDS__ = {
      drive: (hands, aspect, face, now) => step(hands, aspect, face, now),
      sees: (pixels, width, height) => sees(pixels, width, height),
      vertices() {
        const position = paperRef.current?.mesh?.geometry.attributes.position
        return position ? Array.from(position.array as Float32Array) : null
      },
      marks: () => ({ hand: handMarkRef.current !== null, fire: flameMarkRef.current !== null }),
      fresh: () => freshRef.current(),
    }
    return () => {
      window.__HANDS__ = undefined
    }
  }, [sees, step])

  /** A fresh sheet: a new field, and a new fire. What has burnt cannot unburn. */
  const fresh = useCallback(() => {
    fieldRef.current = newField()
    glowRef.current = new Afterglow(fieldRef.current)
    viewRef.current = new Firelit(glowRef.current)
    poolRef.current = new ParticlePool(fxQualityFor(FX_TIER).particles)
    emitterRef.current = new FireEmitter(fieldRef.current, poolRef.current, locate, {
      caps: fxQualityFor(FX_TIER).caps,
    })
    statsRef.current = NO_STATS
    flameRef.current = null
    ignitionRef.current = { at: STRIKE_AT, left: 0 }
    flameMarkRef.current = null
    watchRef.current.reset()
    burntRef.current = false
    setBurnt(false)
  }, [locate])
  freshRef.current = fresh

  const { field, glow, pool, emitter } = fireRefs()
  // The breath, as the simulator's wind — off the quantised copy, so the
  // fluid is not handed a new params object on every frame.
  const fireWind = useMemo(() => ({ wind: wind * 2.5 }), [wind])
  // And as the cloth's: blowing at the sheet moves the sheet.
  const physics = useMemo(() => ({ ...PAPER.physics, wind }), [wind])
  const rig: FireRig = {
    field,
    glow,
    pool,
    emitter,
    flame: flameRef,
    ignition: ignitionRef,
    view: viewRef.current ?? new Firelit(glow),
    matchFlame: matchFlameRef,
    stats: statsRef,
    wind: () => windRef.current,
    // A breath nobody has read for a while is not a breath: the level only
    // moves when a face frame arrives, so a mouth that left the camera would
    // otherwise go on blowing forever and the fire could never be lit again.
    blow: () =>
      sinceBreath(performance.now(), breathAtRef.current) < BREATH_STALE_MS ? breathRef.current.blow : 0,
    locate,
    onBurnt: markBurnt,
  }

  /** What went wrong starting the camera — `start` leaves it in `message` and puts the page back to idle. */
  const failed = status === 'idle' && message !== ''

  return (
    <div className="app lab">
      <header className="topbar">
        <div className="brand">Paperlab</div>
        <div className="filename">Fire, by hand</div>
        <ModeTabs current="hands" />
        <div className="spacer" />
      </header>

      {/* The tool: the camera, and the match for anyone without one. */}
      <aside className="left hud">
        <h2>Camera</h2>
        {status === 'live' ? (
          <button type="button" className="pill" onClick={stop}>
            Stop the camera
          </button>
        ) : (
          <button type="button" className="pill" onClick={start} disabled={status === 'starting'}>
            {status === 'starting' ? 'Starting…' : 'Start the camera'}
          </button>
        )}
        {failed ? (
          <p className="error" role="alert">
            {message}
          </p>
        ) : (
          <p className="rail-caption">
            {status === 'live'
              ? sawLighter
                ? 'A flame in the frame — hold it to the paper.'
                : blowReady
                  ? 'Blow to put it out.'
                  : 'Loading the face model, for blowing it out…'
              : message || 'The camera stays on this machine; one request is made to Google for the model.'}
          </p>
        )}
        {/* The camera's own picture, small: it is how you aim a flame you are
            holding, and without it nobody can tell what the tracker sees. */}
        <video ref={videoRef} className="camera" playsInline muted hidden={status !== 'live'} />

        <h2>No camera?</h2>
        <button type="button" className="control-button" onClick={strike}>
          Strike a match
        </button>
        {burnt && (
          <button type="button" className="control-button" onClick={fresh}>
            A fresh sheet
          </button>
        )}
      </aside>

      <main className="viewport">
        <div className="stage">
          <Paper ref={paperRef} {...PAPER} physics={physics} damage={rig.view}>
            <CanvasBridge getMesh={getMesh} onReady={onReady} />
            {/* At the canvas root, so the embers are in world space — which is
                what `surfacePoint` hands the emitter. */}
            <FxParticles pool={pool} />
            <FxPost quality={FX_TIER} field={field} locate={locate} />
            <FxFireFluid
              field={field}
              locate={locate}
              quality={FX_TIER}
              params={fireWind}
              resetKey={field}
              fallback={<FxFlames field={field} locate={locate} quality={FX_TIER} wind={pool.wind} />}
            />
            <FxFireLight field={field} locate={locate} />
            {/* The match itself: arming sparks, the strike, the held flame and
                the light it throws before anything has caught. */}
            <FxMatchFlame match={matchFlameRef} />
            {/* A thread of smoke from a bead left glowing after the flames. */}
            <FxWisps glow={glow} field={field} locate={locate} wind={pool.wind} />
            {/* The burn's own clock — see `<Fire>`. It runs whether or not a
                camera is on, which is what lets the match button work. */}
            <Fire rig={rig} />
          </Paper>
        </div>
        {sawLighter && (
          <div className="banner" role="status">
            <span className="dot" aria-hidden="true" />
            Fire detected — the paper is catching
          </div>
        )}
      </main>

      {/* How to use it, and what the page can see right now. */}
      <aside className="right">
        <div className="rail-body">
          <h2>How to light it</h2>
          <ol className="how-to">
            <li>Start the camera.</li>
            <li>Hold a real flame up to it — a lighter, a match. The sheet catches where the flame is.</li>
            <li>No lighter? Pinch and hold still in the air: that is a match. Touch it to the paper.</li>
            <li>
              Blow at the camera to put it out. Blow hard and the whole burn goes out, leaving the edge to
              smoulder.
            </li>
          </ol>

          <h2>What it sees</h2>
          <dl className="status-list">
            <dt>Camera</dt>
            <dd>{status === 'live' ? 'on' : status === 'starting' ? 'starting…' : 'off'}</dd>
            <dt>Flame</dt>
            <dd>{sawLighter ? 'detected' : 'none'}</dd>
            <dt>Blowing</dt>
            <dd>{status !== 'live' ? '—' : blowReady ? 'ready' : 'loading…'}</dd>
            <dt>Sheet</dt>
            <dd>{burnt ? 'burnt' : 'untouched'}</dd>
          </dl>
        </div>
      </aside>

      {/* The per-frame numbers, where the editor keeps its status line. */}
      <footer className="transport">
        <p ref={readoutRef} className="transport-hint readout" />
      </footer>

      <canvas
        ref={overlayRef}
        className="overlay"
        role="img"
        aria-label="What the camera sees: your hand while it is tracked, and any flame it has found"
      />
      <div ref={cursorRef} className="cursor" aria-hidden="true" />
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
