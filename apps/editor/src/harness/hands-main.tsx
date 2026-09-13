import { createRoot } from 'react-dom/client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { FaceLandmarker, FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'
import { Paper, type PaperHandle } from 'paperlab'
import {
  Afterglow,
  DamageField,
  FireEmitter,
  FireSound,
  FxAudio,
  FxFireFluid,
  FxFireLight,
  FxFlames,
  FxMatchFlame,
  FxParticles,
  FxPost,
  FxWisps,
  ParticlePool,
  createAudioContext,
  fxQualityFor,
  type FieldStats,
  type MatchFlameState,
} from 'paperlab/fx'
import { Breath } from './breath'
import { FLAME_RADIUS, coolFromBlow, flameHeat } from './flame'
import { GestureReader, type GestureFrame } from './gestures'
import { pinchPoint, palmLength, toClient, type Landmark } from './landmarks'
import { LighterWatch } from './lighter'
import { Match, type MatchState } from './match'

/**
 * **Set fire to a sheet of paper with your hands.**
 *
 * One effect, and it is the fire the lab tunes (`/fx-lab`): the same field,
 * the same simulator, the same look, the same sound. Nothing is configured
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
 * Where the panel's struck match is held, and for how long — the way in on a
 * machine with no camera. Below the middle, because paper burns upward.
 *
 * In seconds of the BURN's clock, not the page's: a burn advances a fifteenth
 * of a second per frame however long the frame took, so a match measured in
 * wall time is a shorter match on a slow machine.
 */
const STRIKE_AT = { u: 0.5, v: 0.32 }
const STRIKE_SECONDS = 0.9

/** How often the camera frame is searched for a flame — every third frame is ten a second. */
const LIGHTER_EVERY = 3

/** How big a frame the flame is looked for in. Small on purpose: it is a blob, not a face. */
const LIGHTER_WIDTH = 160
const LIGHTER_HEIGHT = 120

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
  sound: React.RefObject<FireSound | null>
  /** Where a flame is on the sheet, in UV, or null. The camera loop writes it. */
  flame: React.RefObject<{ u: number; v: number } | null>
  /** How much of the panel's struck match is left, in seconds of the burn's clock. */
  strikeLeft: React.RefObject<number>
  matchFlame: React.RefObject<MatchFlameState>
  stats: React.RefObject<FieldStats>
  wind(): number
  /** How hard the viewer is blowing, 0..1 — a real one cools the fire. */
  blow(): number
  locate(u: number, v: number): { x: number; y: number; z: number } | null
  onBurnt(): void
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
  /** Whether the sheet was burning last frame — a blow-out plays on the change. */
  const burning = useRef(false)
  useFrame((_, delta) => {
    const dt = Math.min(0.1, Math.max(0, delta))
    const { field, pool, emitter } = rig
    const struck = rig.strikeLeft.current > 0
    const at = rig.flame.current ?? (struck ? STRIKE_AT : null)
    if (at) {
      held.current += dt
      field.ignite(at.u, at.v, FLAME_RADIUS, flameHeat(held.current, dt))
    } else {
      held.current = 0
    }
    if (struck) rig.strikeLeft.current = Math.max(0, rig.strikeLeft.current - dt)
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
    const pops = Math.min(3, pool.takePops())
    for (let i = 0; i < pops; i++) rig.sound.current?.pop()
    if (burning.current && stats.front === 0 && rig.blow() > 0.3) rig.sound.current?.puff()
    burning.current = stats.front > 0
    rig.sound.current?.update(dt, stats, rig.locate(0.5, 0.5))
    if (stats.charred > 0 || stats.remaining < 1) rig.onBurnt()
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
  //    emitter are what the burn throws into the air; the sound reads the
  //    same numbers the picture does.
  const fieldRef = useRef<DamageField | null>(null)
  const glowRef = useRef<Afterglow | null>(null)
  const poolRef = useRef<ParticlePool | null>(null)
  const emitterRef = useRef<FireEmitter | null>(null)
  const audioRef = useRef<FxAudio | null>(null)
  const fireSoundRef = useRef<FireSound | null>(null)
  const lastMatchRef = useRef<MatchState>('none')
  const flameRef = useRef<{ u: number; v: number } | null>(null)
  const matchFlameRef = useRef<MatchFlameState>({ position: null, state: 'none', blow: 0, touching: false })
  const strikeRef = useRef(0)
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

  /** Latched once: see `burnt`. */
  const markBurnt = useCallback(() => {
    if (burntRef.current) return
    burntRef.current = true
    setBurnt(true)
  }, [])

  const unlockAudio = useCallback(async () => {
    try {
      audioRef.current ??= new FxAudio({ context: createAudioContext(), quality: FX_TIER })
      await audioRef.current.unlock()
      fireSoundRef.current ??= new FireSound(audioRef.current)
    } catch {
      // No Web Audio in this browser: everything but the sound still works.
    }
  }, [])

  /** Strike a match, without a hand. The way in for anyone with no camera. */
  const strike = useCallback(() => {
    void unlockAudio()
    strikeRef.current = STRIKE_SECONDS
    fireSoundRef.current?.strike()
  }, [unlockAudio])

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
      const onPaper = uv !== null
      const match = matchRef.current.push({
        pinching: gesture.name === 'pinch',
        onPaper,
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

      if (match === 'lit' && lastMatchRef.current !== 'lit') fireSoundRef.current?.strike()
      if (match !== 'lit' && lastMatchRef.current === 'lit' && blow > 0.3) fireSoundRef.current?.puff()
      lastMatchRef.current = match

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
    [paint],
  )

  /**
   * A flame the camera can see, wherever it is in the frame.
   *
   * The paper catches where the flame IS: the frame's coordinates are mapped
   * the same way a hand's are, so holding a lighter up to the top left of the
   * sheet burns the top left of the sheet.
   */
  const sees = useCallback((pixels: Uint8Array, width: number, height: number) => {
    const stage = stageRef.current
    const seen = watchRef.current.see(pixels, width, height)
    setSawLighter(seen !== null)
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
    return true
  }, [])

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    readerRef.current.reset()
    matchRef.current.reset()
    breathRef.current.reset()
    watchRef.current.reset()
    flameRef.current = null
    matchFlameRef.current.state = 'none'
    matchFlameRef.current.position = null
    fireSoundRef.current?.stop()
    landmarkerRef.current?.close()
    landmarkerRef.current = null
    faceRef.current?.close()
    faceRef.current = null
    setBlowReady(false)
    setSawLighter(false)
    for (const track of streamRef.current?.getTracks() ?? []) track.stop()
    streamRef.current = null
    setStatus('idle')
  }, [])

  const start = useCallback(async () => {
    setStatus('starting')
    setMessage('asking for the camera…')
    // Sound can only start from inside a user gesture, and this click is one.
    await unlockAudio()
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
          result.landmarks.map((landmarks) => ({ landmarks: [...landmarks] })),
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
  }, [sees, step, stop, unlockAudio])

  useEffect(() => stop, [stop])

  // The audio context outlives the camera on purpose — stopping the camera is
  // not a fresh sheet, and unlocking one costs a gesture. Unmounting is
  // different: nothing is coming back, so close it and let the graph go.
  useEffect(
    () => () => {
      fireSoundRef.current?.stop()
      void audioRef.current?.dispose()
      fireSoundRef.current = null
      audioRef.current = null
    },
    [],
  )

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
    }
    return () => {
      window.__HANDS__ = undefined
    }
  }, [sees, step])

  /** A fresh sheet: a new field, and a new fire. What has burnt cannot unburn. */
  const fresh = useCallback(() => {
    fieldRef.current = newField()
    glowRef.current = new Afterglow(fieldRef.current)
    poolRef.current = new ParticlePool(fxQualityFor(FX_TIER).particles)
    emitterRef.current = new FireEmitter(fieldRef.current, poolRef.current, locate, {
      caps: fxQualityFor(FX_TIER).caps,
    })
    statsRef.current = NO_STATS
    flameRef.current = null
    strikeRef.current = 0
    watchRef.current.reset()
    burntRef.current = false
    setBurnt(false)
  }, [locate])

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
    sound: fireSoundRef,
    flame: flameRef,
    strikeLeft: strikeRef,
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

  return (
    <>
      <div className="stage">
        <Paper ref={paperRef} {...PAPER} physics={physics} damage={glow}>
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

      <div ref={cursorRef} className="cursor" aria-hidden="true" />

      <div className="hud">
        <h1>Hands</h1>
        <p className="sub">
          Set fire to the paper. Hold a real flame up to the camera — a lighter, a match — and the sheet
          catches where the flame is. With no lighter, pinch and hold still in the air: that is a match.
        </p>
        {status === 'live' ? (
          <button type="button" onClick={stop}>
            stop the camera
          </button>
        ) : (
          <button type="button" onClick={start} disabled={status === 'starting'}>
            {status === 'starting' ? 'starting…' : 'start the camera'}
          </button>
        )}
        <button type="button" className="ghost" onClick={strike}>
          strike a match
        </button>
        {burnt && (
          <button type="button" className="ghost" onClick={fresh}>
            a fresh sheet
          </button>
        )}
        <p className="note">
          {status === 'live'
            ? sawLighter
              ? 'a flame in the frame — hold it to the paper'
              : blowReady
                ? 'blow to put it out'
                : 'loading the face model, for blowing it out…'
            : message || 'the camera stays on this machine; one request is made to Google for the model.'}
        </p>
        <p ref={readoutRef} className="readout" />
      </div>

      {/* The camera's own picture, small: it is how you aim a flame you are
          holding, and without it nobody can tell what the tracker sees. */}
      <video ref={videoRef} className="camera" playsInline muted />
    </>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
