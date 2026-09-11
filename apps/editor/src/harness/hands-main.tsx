import { createRoot } from 'react-dom/client'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { Paper, type PaperEdge, type PaperHandle, type StockName } from 'paperlab'
import { FaceLandmarker, FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'
import { HandPointer, toClient, type PointerState } from './handPointer'
import { GestureReader, NO_GESTURE, type GestureFrame } from './gestures'
import {
  INDEX_TIP,
  landmarkPoint,
  palmLength,
  palmRoll,
  palmsApart,
  pinchPoint,
  type Landmark,
} from './landmarks'
import {
  addCrease,
  continuesScore,
  creaseFromDrag,
  nearestCorner,
  nearestEdge,
  ripsApart,
  type PaperCorner,
  type UV,
} from './marks'
import { assignRoles, handFor, NO_ROLES, type HandRead, type Handedness, type Roles } from './roles'
import { FLICK_SPEED, FlickTracker, isFlick, washFromFlick, type Release } from './flick'
import { DIAL, dialIndex, dialStock, turnedBy } from './dial'
import { Breath } from './breath'
import { Span } from './span'
import { derive, sheetAt, type Squeeze } from './derive'
import { Session } from './session'
import { Match } from './match'
import { FLAME_RADIUS, flameHeat } from './flame'
import {
  DamageField,
  FireEmitter,
  FireSound,
  FxAudio,
  FxParticles,
  ParticlePool,
  createAudioContext,
  fxQualityFor,
} from 'paperlab/fx'

/**
 * Reach out and handle the paper.
 *
 * The camera drives a gesture vocabulary (`gestures.ts`) and a synthetic
 * pointer (`handPointer.ts`); `packages/paperlab` is untouched and unaware.
 * Everything here maps onto something the library could already do and nobody
 * had wired to a hand — which is the constraint worth keeping, because a
 * showcase is strongest when every gesture is an argument for a feature that
 * already ships:
 *
 *   pinch        take hold and pull        the cloth sim's own grab
 *   point        score a line              `memory.creases` — the sheet keeps it
 *   fist         fold along what you scored the `fold` deformer, over the sim
 *   fist         crush, with nothing scored the `crumple` behavior, over the sim
 *   open palm    put the paper back        release the fold or the crush
 *   turn a palm  change the stock          `stock`, swapped live under a held sheet
 *   flick        throw paint at it         `content.wash` — a real pigment model
 *   blow at it   the wind rises            `cloth.wind`, driven continuously
 *   yank an edge tear it                   `surface.deckle`
 *   pull apart   rip along the dotted line `surface.perforation`
 *   two palms    resize it                 `sheet.width/height`
 *   pinch a corner and lift  it peels      the `peel` behavior, over the sim
 *   flick while holding it   it flies off  the pins let go and the sim throws it
 *
 * The vocabulary ran out of POSES long before it ran out of things to do, and
 * the way out was to stop looking for new ones. A pinch aimed at a corner
 * does not mean what the same pinch aimed at the middle means; a fist on a
 * scored sheet does not mean what a fist on a blank one means; a snap with
 * the paper in your hand does not mean what the same snap in free air means.
 * Paper is indexed by WHERE you take hold of it and by what state it is in,
 * not by how many hand shapes you can remember — which is why there is no
 * peel gesture to learn, and why `marks.ts` is where most of this lives.
 *
 * The dividing line that decides how all of it feels: SURFACE and MEMORY
 * changes are free, and so is a STRUCTURAL one now. `surface.*`,
 * `memory.creases`, `stock` and the live cloth parameters update in place;
 * changing `pins`, the sheet's dimensions, or putting a behavior over the sim
 * rebuilds the mesh and the simulation, and `ClothSim.adopt` carries the
 * particles across the rebuild, so the paper stays where it was.
 *
 * That is why scoring, tearing, painting, blowing, changing the stock AND the
 * fist all feel right. It is worth being precise about, because this comment
 * said the opposite for a while and the claim outlived the code by a whole
 * commit: the schema does not make a simulation and a behavior exclusive —
 * only the STRIP is exclusive, because its rows are chain nodes rather than
 * the sheet's own grid. Cloth is not swapped out for `crumple`; it hosts it.
 * `PaperMesh` solves the particles and then runs the deformer stack over
 * them, which is why you crush the paper you are actually holding.
 *
 * Pinned by `physics/cloth-hosts-a-shape.test.ts` rather than by this
 * paragraph, since a paragraph is what was wrong last time. The browser
 * harness cannot pin it: it measures a live renderer on a wall clock and
 * reported this same sheet's drape as 0.460 → 0.780 on one run and
 * 1.117 → 0.170 on the next, with nothing changed in between.
 *
 * Still out of reach: punch and cut. The sheet is a fixed-topology grid, so a
 * hole in the middle or a split into two sheets needs real work in the
 * library — a torn EDGE is alpha on the existing mesh, which is why that one
 * is reachable and the other two are not.
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
 *
 * Resolved against the page's own URL rather than hard-coded, so the same
 * build works at `/hands/` in dev and on the site.
 */
const TRACKER_BASE = new URL('tracker/', document.baseURI).href

const HAND_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'
/** The face model, behind the blow gesture. Loaded second; the page works without it. */
const FACE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'

/** What to say when the setup step has not been run. */
const MISSING_ASSETS = 'the tracker’s wasm is not in apps/editor/.hands — run `pnpm hands:setup`'

/**
 * Whether the wasm is actually there, asked before anything tries to load it.
 * `FilesetResolver` reports a missing one as a stack trace out of a generated
 * glue file, which is a long way from "run the setup script".
 */
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
 * What a closed hand does to the paper.
 *
 * `none` is an open hand. `fold` needs a line to fold along, so a fist closes
 * along the last line you SCORED — the `fold` deformer takes the identical
 * `{ angle, offset }` that `creaseFromDrag` already produces, which is the
 * single tidiest join in this whole harness. With nothing scored there is no
 * line to close along, and a fist on unmarked paper crumples it.
 */
/**
 * Degrees of fold per published step.
 *
 * The fold angle is a deformer OPTION rather than a behavior's progress, so it
 * cannot be written imperatively through `ref.set()` and has to go through
 * React. Quantised for the usual reason: a prop written every frame re-renders
 * the tree that owns the canvas. Five degrees is finer than a hand is steady.
 */
const FOLD_STEP = 5

/**
 * How far back the camera stands.
 *
 * The library's camera is fixed and head-on by design — `<Paper>` sits at
 * (0, 0.35, 2.4) and nothing fits it to its content — and at that distance the
 * sheet already fills the frame top to bottom. Which is right for a sheet you
 * are grabbing and wrong the moment two hands can make it bigger: it grows
 * straight out of shot, and a resize you cannot see is not a gesture.
 *
 * So the harness stands the camera back once, at mount, and leaves it there.
 * Not tracking the size — a camera that pulls back as the sheet grows keeps
 * the sheet exactly the same size on screen, which is the one outcome this
 * gesture must not have.
 */
const CAMERA_Z = 3.95

/**
 * How far a grabbed edge has to be pulled before it tears, in palm lengths on
 * a sheet at its base size.
 *
 * Both of these used to be fractions of the CANVAS DIAGONAL, in pixels, and
 * that was wrong twice over.
 *
 * It was wrong about direction: a hand's travel is mapped onto the canvas
 * per-axis, so a fraction of the diagonal is a different physical pull
 * sideways than downward. On a 16:9 canvas the paper tore almost twice as
 * easily across as down, which is not a property paper has.
 *
 * And it was wrong about the paper: what tears a sheet is STRAIN, and strain
 * is how far you pulled measured against how big the sheet is. Two open palms
 * can make this one twice the size, and the pull it took to tear did not
 * change — so the bigger the sheet got, the more flimsy it became. Both are
 * now measured in the palm lengths everything else in this harness is
 * measured in, and scaled by the sheet.
 */
const TEAR_PULL = 2.2

/** How far a corner has to be lifted for a full peel, on the same terms. */
const PEEL_PULL = 1.6

/** Both slots, always read, so a hand that leaves resets its own reader. */
const SIDES: readonly Handedness[] = ['Left', 'Right']

/**
 * What the effects are allowed to cost here.
 *
 * Fixed rather than measured, for now: this page already runs a camera, a
 * hand tracker and a cloth simulation, and `auto` on top of that is a
 * measurement of the wrong thing. The simulation is not tiered at all — every
 * device burns the same fire — so this only sets how much of it is drawn.
 */
const FX_TIER = 'medium' as const

/** How fast the air in the room moves, per unit of `cloth.wind`. */
const SMOKE_WIND = 1.2

/** A fresh field, at the tier's edge detail. */
function newField(): DamageField {
  const field = new DamageField()
  field.detail = fxQualityFor(FX_TIER).detail
  return field
}

/** What a hand looks like coming out of the tracker — or out of the harness. */
export interface HandInput {
  landmarks: Landmark[]
  handedness: Handedness
}

/** Everything one hand is this frame. A superset of what `roles.ts` asks for. */
interface Read extends HandRead {
  landmarks: readonly Landmark[]
  /** The hand's own ruler, for anything measured between two hands. */
  palm: number | null
  /** Degrees of roll, fingers-up as zero. The stock dial reads this. */
  roll: number | null
}

interface StageApi {
  canvas: HTMLCanvasElement
  /** Where a client-space point lands on the sheet, or null if it missed. */
  hitUV(clientX: number, clientY: number): UV | null
}

interface DriveResult {
  /** The ACTING hand's gesture — the one whose pose is read as an action. */
  frame: GestureFrame
  pointer: PointerState | null
  /** What a closed hand is doing to the sheet right now. */
  squeeze: Squeeze
  /** Degrees the scored line is folded to, 0 when nothing is folding. */
  fold: number
  /** The crumple's progress, 0..1. */
  crush: number
  /** The corner being peeled back, if a pinch landed on one. */
  peel: PaperCorner | null
  /** Whether the sheet has been thrown off its pins. */
  thrown: boolean
  /** Whether the live grab actually landed on the paper. */
  holding: boolean
  creases: number
  /** Edges yanked off, as ragged `surface.deckle`. */
  torn: PaperEdge[]
  /** Edges ripped along their perforation, two-handed. */
  ripped: PaperEdge[]
  stock: StockName
  /** Live `cloth.wind`, which a blow drives. */
  wind: number
  /** The sheet's size, as a multiple of the one the preset ships. */
  scale: number
  /** How many washes have been flicked onto the sheet. */
  washes: number
  hands: number
  roles: Roles
  /** Where the pointer landed on the sheet, or null if it missed. */
  uv: UV | null
  /** The score in progress, for the harness to inspect. */
  pending: { from: UV | null; to: UV | null }
  /** The two-handed pull in progress, same reason. */
  pulling: { gap: number; edge: PaperEdge | null; now: number } | null
  /** The fire: the flame in hand, and what it has done to the sheet. */
  fire: {
    /** Whether a match is lit. */
    lit: boolean
    /** Fraction of the sheet's texels on the burn front. */
    front: number
    /** Fraction of the sheet still there. */
    remaining: number
    /** Particles in the air. */
    particles: number
  }
}

declare global {
  interface Window {
    /**
     * The camera, bypassed.
     *
     * `pnpm test:hands` drives this with scripted hands, because the claim
     * worth testing is not the tracking — it is that a hand-made
     * `PointerEvent` really does reach the cloth grab, capture and all, and
     * that each gesture lands on the library feature it claims. A webcam
     * cannot be automated and is not the part that can break. `face` stands
     * in for the blendshape a real mouth would produce, and `now` lets a
     * script own the clock — a flick is defined by how FAST it is, and a
     * timing gesture measured against wall time is a test that passes on a
     * laptop and fails on a loaded CI box.
     */
    __HANDS__?: {
      drive(
        hands: HandInput[] | null,
        aspect: number,
        face?: { pucker: number } | null,
        now?: number,
      ): DriveResult
      /** Live vertex positions of the sheet, for seeing whether it moved. */
      vertices(): number[] | null
    }
  }
}

/** Wind is noise when something is trying to measure a drag; `?wind=0` stills it. */
const windParam = Number(new URLSearchParams(window.location.search).get('wind'))
const WIND = Number.isFinite(windParam) ? windParam : 0.25

/**
 * A relaxed hand already reads about half curled, so the bottom half of the
 * range is spent before a crush should start. Squeezing past that drives it.
 */
function crushFromCurl(curl: number): number {
  return Math.min(1, Math.max(0, (curl - 0.5) * 2))
}

/** The same half-range, in degrees of fold. 180 is flat against itself. */
function foldFromCurl(curl: number): number {
  return Math.round((crushFromCurl(curl) * 180) / FOLD_STEP) * FOLD_STEP
}

const ndc = new THREE.Vector2()

/**
 * Hands the canvas and a raycaster up to the page.
 *
 * `<Paper>` owns its own `<Canvas>`, so the camera and the raycaster live
 * inside it. Scoring needs to know WHERE ON THE SHEET a fingertip is, which
 * is a raycast, which needs both — and a child inside the canvas can simply
 * ask for them rather than the page guessing.
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
        // it left behind. three tests the bounding sphere before any triangle,
        // so a stale one makes a draped sheet unhittable near its edges.
        mesh.geometry.computeBoundingSphere()
        const hit = raycaster.intersectObject(mesh, false)[0]
        return hit?.uv ? { u: hit.uv.x, v: hit.uv.y } : null
      },
    })
  }, [gl, camera, raycaster, getMesh, onReady])

  return null
}

function App() {
  const [status, setStatus] = useState<Status>('idle')
  const [message, setMessage] = useState('')
  const [blowReady, setBlowReady] = useState(false)

  /**
   * Everything about the sheet, in one mutable object the frame loop writes
   * directly and React subscribes to.
   *
   * The eleven `useState` pairs this replaces each had a shadow `useRef`,
   * because React state is far too slow to read per frame and a ref was the
   * available escape — so every value lived twice and every change had to
   * write both. Forty lines that had to agree, with nothing checking they
   * did, and both halves of the disagreement invisible until you looked at
   * the right frame. See `session.ts`.
   *
   * `useSyncExternalStore` over a version counter rather than a snapshot
   * object: the state is mutable by design, so there is nothing to compare
   * structurally, and a counter is exactly what "something a render reads has
   * changed" means.
   */
  const sessionRef = useRef<Session>(new Session({ stockIndex: DIAL.indexOf('printer'), wind: WIND }))
  const s = sessionRef.current
  useSyncExternalStore(s.subscribe, s.version)
  // `s` is the only dependency any callback below has on the session: it is
  // one object for the component's whole life and its fields are mutable by
  // design. Depending on a FIELD would rebuild the callback every time the
  // sheet changed, which is the per-frame churn the store exists to remove.

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const cursorRef = useRef<HTMLDivElement | null>(null)
  const otherRef = useRef<HTMLDivElement | null>(null)
  const trailRef = useRef<SVGLineElement | null>(null)
  const readoutRef = useRef<HTMLParagraphElement | null>(null)

  const paperRef = useRef<PaperHandle | null>(null)
  const stageRef = useRef<StageApi | null>(null)
  const landmarkerRef = useRef<HandLandmarker | null>(null)
  const faceRef = useRef<FaceLandmarker | null>(null)
  const pointerRef = useRef<HandPointer | null>(null)
  // One reader and one flick tracker PER HAND. Shared state between two hands
  // would let the left hand's pose debounce the right hand's.
  const readersRef = useRef<Record<Handedness, GestureReader>>({
    Left: new GestureReader(),
    Right: new GestureReader(),
  })
  const flicksRef = useRef<Record<Handedness, FlickTracker>>({
    Left: new FlickTracker(),
    Right: new FlickTracker(),
  })
  const breathRef = useRef<Breath>(new Breath(WIND))
  const spanRef = useRef<Span>(new Span())
  // ── Fire. The field is what has happened to the sheet; the pool and the
  //    emitter are what the burn throws into the air; the sound reads the
  //    same numbers the picture does.
  const fieldRef = useRef<DamageField | null>(null)
  const poolRef = useRef<ParticlePool | null>(null)
  const emitterRef = useRef<FireEmitter | null>(null)
  const audioRef = useRef<FxAudio | null>(null)
  const fireSoundRef = useRef<FireSound | null>(null)
  const matchRef = useRef<Match>(new Match())
  /** Scratch for `surfacePoint`, so reading it every frame allocates nothing. */
  const worldRef = useRef(new THREE.Vector3())
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef(0)
  // The frame loop's own copies: state reaches it a render late, and a mode
  // read a render late swaps twice.
  // A peel in progress: the corner it took hold of and where on screen.
  // Whether the driving hand was already pinching last frame — a peel is a
  // decision made when a pinch lands, not one revisited every frame.
  // Whether the grab that is live right now actually landed on the paper.
  // A snap of the fingers over empty space throws paint; the same snap with
  // the sheet in your hand throws the SHEET.
  // A score in progress: where the fingertip landed, and where it is now.
  /** Where the acting hand is on the canvas, for the score trail to follow. */
  // A grab in progress: the edge it started on, and where on screen.
  /** Whether this grab has already torn something — one edge per grab. */
  // A two-handed pull in progress: how far apart the hands were, and the edge.
  /** How far apart the two hands are right now — reported, not decided on. */
  // A dial in progress: the roll the palm went up at, and the stock it was on.

  /**
   * Where a point of the sheet is, for the emitters: the DRAWN surface this
   * frame, after the cloth and whatever shape is running over it.
   *
   * This is what `PaperHandle.surfacePoint` exists for. Ash has to leave the
   * paper from where the paper actually is, and a sheet that is draped, held
   * and half crushed is nowhere a UV alone could say.
   */
  const locate = useCallback(
    (u: number, v: number) => paperRef.current?.surfacePoint(u, v, worldRef.current) ?? null,
    [],
  )

  /**
   * The fire's three objects, made on first use and replaced together — a
   * fresh sheet has never been burnt.
   */
  const fireRefs = useCallback(() => {
    fieldRef.current ??= newField()
    poolRef.current ??= new ParticlePool(fxQualityFor(FX_TIER).particles)
    emitterRef.current ??= new FireEmitter(fieldRef.current, poolRef.current, locate)
    return { field: fieldRef.current, pool: poolRef.current, emitter: emitterRef.current }
  }, [locate])

  const getMesh = useCallback(() => paperRef.current?.mesh ?? null, [])
  const onReady = useCallback((api: StageApi) => {
    stageRef.current = api
  }, [])

  /**
   * The per-frame readout, written straight to the DOM.
   *
   * Thirty setState calls a second to move a dot would re-render the tree
   * that owns the canvas, which is the one thing a harness measuring feel
   * must not do. Same split the library uses everywhere: React owns
   * structure, the frame loop owns values.
   */
  const paint = useCallback(
    (
      frame: GestureFrame,
      pointer: PointerState | null,
      hands: number,
      otherAt: { x: number; y: number } | null,
      fire: DriveResult['fire'],
    ) => {
      const cursor = cursorRef.current
      if (cursor) {
        const held = pointer?.down ?? false
        cursor.style.transform = `translate(${pointer?.x ?? 0}px, ${pointer?.y ?? 0}px) scale(${held ? 0.6 : 1})`
        cursor.style.opacity = pointer?.tracked ? '1' : '0'
        cursor.dataset.down = String(held)
        cursor.dataset.gesture = frame.name
      }
      // The second hand gets a cursor of its own, dimmer: it is not the one
      // holding the paper, and two identical dots would be a puzzle.
      const other = otherRef.current
      if (other) {
        other.style.transform = `translate(${otherAt?.x ?? 0}px, ${otherAt?.y ?? 0}px)`
        other.style.opacity = otherAt ? '1' : '0'
      }
      // The line being scored, drawn while the finger is still moving. Without
      // it you are drawing blind and only find out where the crease went after
      // you lift, which is not a thing you can aim.
      const trail = trailRef.current
      const from = s.scoreFrom
      const to = s.scoreTo
      if (trail) {
        const drawing = frame.name === 'point' && from !== null && to !== null
        trail.style.opacity = drawing ? '1' : '0'
        if (drawing && from) {
          trail.setAttribute('x1', String(from.clientX))
          trail.setAttribute('y1', String(from.clientY))
          trail.setAttribute('x2', String(s.scoreAt?.x ?? from.clientX))
          trail.setAttribute('y2', String(s.scoreAt?.y ?? from.clientY))
        }
      }
      const readout = readoutRef.current
      if (readout) {
        const blow = breathRef.current.blow
        // The fire's numbers go here rather than into the HUD's React tree
        // for the reason everything per-frame does: a prop written sixty
        // times a second re-renders the tree that owns the canvas.
        const flame = fire.lit ? ' · flame lit' : ''
        const burnt = fire.remaining < 1 ? ` · paper ${Math.round(fire.remaining * 100)}%` : ''
        const air = fire.particles > 0 ? ` · ${fire.particles} in the air` : ''
        readout.textContent =
          frame.curl === null
            ? `no hand in frame${blow > 0.05 ? ` · blowing ${blow.toFixed(2)}` : ''}${flame}${burnt}${air}`
            : `${frame.name.padEnd(6)} ${hands} hand${hands === 1 ? '' : 's'} · aperture ${frame.aperture!.toFixed(2)} · curl ${frame.curl.toFixed(2)} · wind ${s.wind.toFixed(2)}${flame}${burnt}${air}`
      }
    },
    [s],
  )

  /** One frame of hands → gestures → paper. Shared by the camera and the harness hook. */
  const step = useCallback(
    (
      hands: HandInput[] | null,
      aspect: number,
      face?: { pucker: number } | null,
      at?: number,
    ): DriveResult => {
      const now = at ?? performance.now()
      /**
       * The effects' own clock, in seconds.
       *
       * The field, the emitters and the sound all advance by a real interval
       * rather than by a frame, so that the same burn takes the same time on
       * any machine — and because the harness owns `now`, a scripted test
       * owns that interval too. Capped, so a tab that was in the background
       * does not resume by burning a tenth of a second's worth of paper per
       * frame it missed.
       */
      const dt = s.frameAt === null ? 0 : Math.min(0.1, Math.max(0, (now - s.frameAt) / 1000))
      s.frameAt = now

      // ── Read every hand, whether or not one is there. ─────────────────────
      const reads: Read[] = []
      const releases: Partial<Record<Handedness, Release>> = {}
      for (const side of SIDES) {
        const found = hands?.find((hand) => hand.handedness === side) ?? null
        const landmarks = found?.landmarks ?? null
        const frame = readersRef.current[side].read(landmarks, aspect)
        // Where the gesture is aimed from. A pointing hand aims down its
        // fingertip; everything else holds at the midpoint of the pinch.
        const anchor = landmarks
          ? frame.name === 'point'
            ? landmarkPoint(landmarks, INDEX_TIP)
            : pinchPoint(landmarks)
          : null

        // The hand's own ruler, measured before anything uses it: a flick is
        // defined by speed, and a speed in fractions of the camera frame is a
        // gesture that fires because somebody leaned forward.
        const palm = landmarks ? palmLength(landmarks, aspect) : null

        // Every pinch opening is collected and none of them is judged here:
        // what a snap MEANS depends on whether the sheet was in that hand,
        // and this loop runs before the roles that answer it.
        const release = flicksRef.current[side].push(anchor, frame.name === 'pinch', now, aspect, palm)
        if (release) releases[side] = release

        if (landmarks) {
          reads.push({
            handedness: side,
            frame,
            anchor,
            landmarks,
            palm,
            roll: palmRoll(landmarks, aspect),
          })
        }
      }

      const roles = assignRoles(reads, s.roles)
      s.roles = roles
      const hold = handFor(reads, roles.hold)
      const act = handFor(reads, roles.act)
      const frame = act?.frame ?? NO_GESTURE

      // ── Blow. The one gesture that is not a hand at all. ──────────────────
      const nextWind = breathRef.current.push(face?.pucker ?? null)
      if (nextWind !== s.wind) {
        s.set('wind', nextWind)
      }

      // ── Resize. Two open hands, spread. ──────────────────────────────────
      // Two OPEN hands, because two pinches already mean gripping the paper
      // either side of a perforation — you do not grip a thing you are
      // sizing, you frame it. While a span is held it also takes the open
      // palm away from the dial and from the way out of a crush, which is the
      // one place this vocabulary is genuinely crowded.
      const spanning = reads.length === 2 && reads.every((hand) => hand.frame.name === 'palm')
      const gap =
        spanning && reads[0]!.anchor && reads[1]!.anchor && reads[0]!.palm
          ? palmsApart(reads[0]!.anchor, reads[1]!.anchor, reads[0]!.palm, aspect)
          : null
      const nextScale = spanRef.current.push(gap)
      if (nextScale !== s.scale) {
        // A crease is a signed world offset from the sheet's centre, so the
        // creases have to grow with the sheet or they slide off it.
        const ratio = nextScale / s.scale
        s.set('scale', nextScale)
        if (s.creases.length) {
          s.set(
            'creases',
            s.creases.map((crease) => ({ ...crease, offset: crease.offset * ratio })),
          )
        }
      }

      // ── Close your hand. On a scored sheet that folds it; otherwise it ───
      //    crushes it. No mode swap either way: the sheet stays cloth, stays
      //    grabbable, and keeps the drape it is hanging in, because the stack
      //    now runs OVER the simulation rather than instead of it.
      if (frame.name === 'fist' && s.squeeze === 'none') {
        s.set('squeeze', s.creases.length ? 'fold' : 'crush')
      } else if (frame.name === 'palm' && !spanning && s.squeeze !== 'none') {
        s.set('squeeze', 'none')
        s.set('fold', 0)
        s.crush = 0
      }

      if (frame.curl !== null && s.squeeze === 'crush') {
        // Imperatively, not through props: a behavior's progress is what
        // `ref.set` is for, and routing it through React every frame would
        // re-render the tree that owns the canvas.
        s.crush = Math.max(s.crush, crushFromCurl(frame.curl))
        paperRef.current?.set('progress', s.crush)
      } else if (frame.curl !== null && s.squeeze === 'fold') {
        // A fold angle is a deformer OPTION, and there is no imperative door
        // to one — so it goes through React, quantised, and only on a change.
        // Highest reached, not current: paper does not unfold because your
        // hand relaxed.
        const next = Math.max(s.fold, foldFromCurl(frame.curl))
        if (next !== s.fold) {
          s.set('fold', next)
        }
      }

      // ── What a snap of the fingers meant. ────────────────────────────────
      // The same gesture, twice over: with the sheet in your hand it throws
      // the SHEET — the pins let go and the sim carries the velocity your
      // hand gave it — and in free air it throws paint. Duration decides a
      // flick and says nothing about a throw: you can hold a sheet as long as
      // you like and still whip it away at the end.
      for (const [side, release] of Object.entries(releases) as [Handedness, Release][]) {
        const wasDriving = side === (roles.hold ?? roles.act)
        if (wasDriving && s.heldSheet && release.speed >= FLICK_SPEED) {
          s.heldSheet = false
          if (!s.thrown) {
            s.set('thrown', true)
          }
        } else if (isFlick(release)) {
          // The seed has to move or the wash paints the same picture twice —
          // it is a pure function of its options, so an identical seed reads
          // as nothing having happened.
          s.washSeed += 17
          s.washCount += 1
          s.set('wash', washFromFlick(release, s.washSeed))
        }
      }

      // ── The pointer. One hand owns it, because the sim has one grab. ──────
      // Whoever is holding drives it; with nobody holding it follows the hand
      // that is acting, so hovering and aiming still work with one hand up.
      const stage = stageRef.current
      if (stage) pointerRef.current ??= new HandPointer(stage.canvas)
      const driver = hold ?? (roles.hold === null ? act : null)
      // The sheet is always grabbable now — it never stops being cloth, so
      // there is never a moment with nothing to hold. That gate used to exist
      // because a crush swapped the simulation out from under the pointer.
      // Where the driving hand is on the canvas, and what is under it —
      // worked out BEFORE the pointer moves, because whether the pointer is
      // allowed to go down at all depends on where it landed.
      const rect = stage?.canvas.getBoundingClientRect() ?? null
      const driverAt = driver?.anchor && rect ? toClient(driver.anchor, rect) : null
      const uv = driverAt && stage ? stage.hitUV(driverAt.x, driverAt.y) : null
      const pinching = driver?.frame.name === 'pinch'

      // ── The match. A pinch held still in free air is a flame. ─────────────
      // See `match.ts` for why the dwell is the whole gesture: a flick is a
      // pinch too, and without it every snap of the fingers would light one.
      const flame = matchRef.current.push({
        pinching,
        onPaper: uv !== null,
        at: driver?.anchor ?? null,
        palm: driver?.palm ?? null,
        blow: breathRef.current.blow,
        now,
        aspect,
      })
      const lit = flame === 'lit'

      // Hold it against the paper and the paper lights. Keyed on where the
      // flame is in SCREEN space — the raycast that says which part of the
      // sheet it is over — and on how long it has been held there. Not on
      // depth: a palm's apparent size is the only depth cue one camera has,
      // and `landmarks.ts` records that it is far too coarse to key this on.
      if (lit && uv) {
        s.flameHeld += dt
        fieldRef.current?.ignite(uv.u, uv.v, FLAME_RADIUS, flameHeat(s.flameHeld, dt))
      } else {
        s.flameHeld = 0
      }

      // ── Peel. A pinch that lands on a CORNER curls it back. ───────────────
      // The same pose as a grab, and a different thing, because a corner is
      // not the middle of the sheet. The sim can pull a corner but it cannot
      // curl one — `peel` rolls it, which is the whole reason to reach for a
      // behavior rather than let the physics have it.
      if (!pinching || s.squeeze !== 'none') {
        if (s.peeling) {
          s.peeling = null
          s.set('peel', null)
        }
      } else if (!s.wasPinching && driver?.anchor && uv && s.squeeze === 'none' && !lit) {
        // Only on the frame the pinch CLOSES. A grab that turned into a peel
        // because the hand dragged the sheet's corner under itself would let
        // go of the paper half way through the pull — which is exactly what
        // tearing an edge is, so it took the tear with it.
        const corner = nearestCorner(uv)
        if (corner) {
          // Where the hand was, in the CAMERA's coordinates rather than the
          // canvas's — the lift is measured against the hand's own palm, and
          // a palm is not a thing the canvas knows about. See `TEAR_PULL`.
          s.peeling = { corner, from: driver.anchor }
          s.set('peel', corner)
        }
      }
      s.wasPinching = pinching

      // A peeling hand is not a grabbing hand: the pointer stays up, so the
      // sim never takes hold and the two do not fight over the same corner.
      // A hand holding a match is not holding the paper: the pointer stays up
      // while one is lit, so carrying a flame across the sheet cannot drag it.
      const pointer =
        pointerRef.current?.update(driver?.anchor ?? null, pinching && !s.peeling && !lit) ?? null

      if (s.peeling && driver?.anchor && driver.palm) {
        const lifted = palmsApart(driver.anchor, s.peeling.from, driver.palm, aspect)
        // Scaled by the sheet: lifting a corner of a sheet twice the size is
        // twice the gesture, the same way tearing one is.
        paperRef.current?.set('progress', Math.min(1, lifted / (PEEL_PULL * s.scale)))
      }

      // The acting hand may not be the one carrying the pointer, so it gets
      // its own raycast. `hitUV` needs no pointer event — which is exactly
      // what makes a second hand possible against a library with one grab.
      const actAt = act?.anchor && rect ? toClient(act.anchor, rect) : null
      const actUV = act === driver ? uv : actAt && stage ? stage.hitUV(actAt.x, actAt.y) : null
      s.scoreAt = actAt

      // ── Score. Draw with a fingertip; the sheet keeps the line. ───────────
      if (s.squeeze === 'none' && frame.name === 'point' && actAt) {
        if (!s.scoreFrom && actUV) {
          s.scoreFrom = { ...actUV, clientX: actAt.x, clientY: actAt.y }
        }
        // Only if the fingertip actually travelled there. The reader keeps
        // saying `point` for a few frames after the hand has stopped
        // pointing, and those frames would otherwise drag the line's end to
        // wherever the hand relaxed to.
        if (actUV && (!s.scoreTo || continuesScore(s.scoreTo, actUV))) {
          s.scoreTo = actUV
        }
      } else if (s.scoreFrom) {
        // The finger stopped pointing: commit whatever line it drew.
        const from = s.scoreFrom
        const to = s.scoreTo
        s.scoreFrom = null
        s.scoreTo = null
        const crease = to && creaseFromDrag(from, to, sheetAt(s.scale))
        if (crease) {
          s.set('creases', addCrease(s.creases, crease))
        }
      }

      // ── Turn the dial. An open palm, rolled, changes what the paper IS. ───
      // Free while the sheet hangs: `stock` feeds the material and the content
      // texture, never the tessellation, so the drape survives the swap.
      //
      // Measured from where the hand went up rather than from straight up,
      // because an open palm ALSO means "put the paper back" — an absolute
      // dial would change the material every time somebody came out of a
      // crush, at whatever angle their wrist happened to be.
      if (s.squeeze === 'none' && frame.name === 'palm' && !spanning && act?.roll != null) {
        s.dialFrom ??= { roll: act.roll, index: s.stockIndex }
        const origin = s.dialFrom
        const next = dialIndex(turnedBy(origin.roll, act.roll), origin.index, s.stockIndex)
        if (next !== s.stockIndex) {
          s.set('stockIndex', next)
        }
      } else {
        s.dialFrom = null
      }

      // ── Tear. Take an edge and pull until it gives. ───────────────────────
      if (pointer?.down && driver?.anchor) {
        if (!s.grabOrigin) {
          // In camera coordinates, like the peel: the pull is measured in the
          // hand's own palms, which the canvas has never heard of.
          s.grabOrigin = driver.anchor
          s.grabEdge = null
          s.grabTorn = false
          s.heldSheet = uv !== null
        }
        // The edge is the last one the hand was SEEN over, not whichever it
        // was over on the single frame the grab landed. A raycast against a
        // draped sheet misses now and then, and losing a tear to one of those
        // reads as tearing being unreliable — which is how it read.
        if (!s.grabTorn && !s.grabEdge && uv) {
          s.grabEdge = nearestEdge(uv)
        }
        const edge = s.grabEdge
        const origin = s.grabOrigin
        if (edge && driver.palm && !s.torn.includes(edge) && !s.ripped.includes(edge)) {
          const pulled = palmsApart(driver.anchor, origin, driver.palm, aspect)
          if (pulled > TEAR_PULL * s.scale) {
            s.set('torn', [...s.torn, edge])
            // One edge per grab: let go and take hold again to tear another.
            s.grabEdge = null
            s.grabTorn = true
          }
        }
      } else {
        s.grabOrigin = null
        s.grabEdge = null
        s.heldSheet = false
      }

      // ── Rip. Two hands, pulling apart, along the dotted line. ─────────────
      // The other tearing flavour, and the one that needs a second hand: a
      // perforation is torn by holding one side still and pulling the other
      // away, so the measurement is the GROWTH in the gap between the hands.
      const ripping =
        hold !== null && act !== null && hold !== act && act.frame.name === 'pinch' && hold.palm !== null
      if (ripping && hold.anchor && act.anchor && hold.palm !== null) {
        const gap = palmsApart(hold.anchor, act.anchor, hold.palm, aspect)
        s.ripGap = gap
        const edgeNow = (actUV && nearestEdge(actUV)) ?? s.grabEdge
        if (!s.rip) s.rip = { gap, edge: edgeNow }
        const started = s.rip
        // The edge is the last one the pulling hand was SEEN over, not
        // whatever it happened to be over on the one frame the pull armed. A
        // raycast against a draped sheet misses for a frame here and there,
        // and losing the whole gesture to one of those reads as the rip
        // simply not working.
        if (!started.edge && edgeNow) started.edge = edgeNow
        if (started.edge && ripsApart(started.gap, gap)) {
          const edge = started.edge
          if (!s.ripped.includes(edge) && !s.torn.includes(edge)) {
            s.set('ripped', [...s.ripped, edge])
          }
          s.rip = null
        }
      } else {
        s.rip = null
      }

      // ── Fire. The field burns on its own clock; the sheet reads it. ───────
      // Everything here is one direction: the field advances, the emitters
      // read what it just did, the sound reads the same numbers. The PHYSICS
      // of the burn is not here at all — `<Paper damage>` carries it, and the
      // coupling inside the library shortens, curls and breaks the paper.
      const { field, pool, emitter } = fireRefs()
      const stats = field.step(dt)
      // The same air that moves the sheet moves the smoke.
      const air = s.wind * SMOKE_WIND
      pool.wind[0] = air * 0.25
      pool.wind[2] = air
      emitter.update(dt)
      pool.step(dt)
      fireSoundRef.current?.update(dt, stats, locate(0.5, 0.5))
      const fire: DriveResult['fire'] = {
        lit,
        front: stats.front,
        remaining: stats.remaining,
        particles: pool.count,
      }

      paint(frame, pointer, reads.length, act === driver ? null : actAt, fire)
      return {
        frame,
        pointer,
        squeeze: s.squeeze,
        fold: s.fold,
        crush: s.crush,
        peel: s.peeling?.corner ?? null,
        thrown: s.thrown,
        holding: s.heldSheet,
        creases: s.creases.length,
        torn: s.torn,
        ripped: s.ripped,
        stock: dialStock(s.stockIndex),
        wind: s.wind,
        scale: s.scale,
        washes: s.washCount,
        hands: reads.length,
        roles,
        uv,
        pending: { from: s.scoreFrom, to: s.scoreTo },
        pulling: s.rip && { ...s.rip, now: s.ripGap },
        fire,
      }
    },
    [paint, s, fireRefs, locate],
  )

  const reset = useCallback(() => {
    s.reset()
    spanRef.current.reset()
    // A fresh sheet has never been burnt. The field is REPLACED rather than
    // emptied, because the sheet's damage texture is keyed on the source's
    // identity — and the coupling hands every cloth lever back when it
    // changes, so the new sheet is not carrying the old one's broken springs.
    fieldRef.current = newField()
    emitterRef.current = null
    poolRef.current?.clear()
    matchRef.current.reset()
    fireSoundRef.current?.stop()
  }, [s])

  // biome-ignore lint/correctness/useExhaustiveDependencies: as above — `s` is the stable store, its fields are not dependencies.
  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    pointerRef.current?.dispose()
    pointerRef.current = null
    for (const side of SIDES) {
      readersRef.current[side].reset()
      flicksRef.current[side].reset()
    }
    breathRef.current.reset()
    // The flame is in a hand, and the hand has gone. What has already burnt
    // stays burnt — that is the sheet's, like its creases.
    matchRef.current.reset()
    fireSoundRef.current?.stop()
    // Not `reset()`: the size two hands set is the sheet's, like its creases,
    // and stopping the camera is not a fresh sheet. Only the grip is dropped.
    spanRef.current.push(null)
    s.set('squeeze', 'none')
    s.roles = NO_ROLES
    landmarkerRef.current?.close()
    landmarkerRef.current = null
    faceRef.current?.close()
    faceRef.current = null
    setBlowReady(false)
    for (const track of streamRef.current?.getTracks() ?? []) track.stop()
    streamRef.current = null
    setStatus('idle')
  }, [])

  const start = useCallback(async () => {
    setStatus('starting')
    setMessage('asking for the camera…')
    // Sound can only start from inside a user gesture, and this click is the
    // one. It costs nothing to do here: nothing can be heard before the
    // camera is on anyway, and an `AudioContext` made on page load would put
    // an audio indicator in the tab of a page that has made no sound.
    try {
      audioRef.current ??= new FxAudio({ context: createAudioContext(), quality: FX_TIER })
      await audioRef.current.unlock()
      fireSoundRef.current ??= new FireSound(audioRef.current)
    } catch {
      // No Web Audio in this browser: everything but the sound still works.
    }
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
      // some drivers, and CPU at two hands is comfortably fast enough here.
      const options = {
        baseOptions: { modelAssetPath: HAND_MODEL_URL, delegate: 'GPU' as const },
        runningMode: 'VIDEO' as const,
        // Two, because the posture every physical thing you do to paper uses
        // is one hand steadying it while the other acts.
        numHands: 2,
      }
      landmarkerRef.current = await HandLandmarker.createFromOptions(fileset, options).catch(() =>
        HandLandmarker.createFromOptions(fileset, {
          ...options,
          baseOptions: { ...options.baseOptions, delegate: 'CPU' as const },
        }),
      )

      setStatus('live')
      setMessage('')

      // The face model is several megabytes and only one gesture needs it, so
      // it loads AFTER the hands are live rather than delaying them. If it
      // never arrives, everything except blowing still works.
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
        // stands in between. The smoothing in `Breath` was going to average
        // them anyway.
        const faceModel = faceRef.current
        if (faceModel && tick % 2 === 0) {
          const blendshapes = faceModel.detectForVideo(video, stamp).faceBlendshapes[0]
          pucker =
            blendshapes?.categories.find((category) => category.categoryName === 'mouthPucker')?.score ?? null
        }
        tick += 1

        step(
          readHands(result.landmarks, result.handedness),
          video.videoWidth / video.videoHeight,
          pucker === null ? null : { pucker },
        )
      }
      loop()
    } catch (error) {
      setStatus('error')
      setMessage(String(error instanceof Error ? error.message : error))
      stop()
    }
  }, [stop, step])

  useEffect(() => stop, [stop])

  // The scripted-hand hook. Same shape as the other harnesses' `__PERF__` and
  // `__PARITY__` globals, and dev-only for the same reason they are.
  useEffect(() => {
    window.__HANDS__ = {
      drive: (hands, aspect, face, now) => step(hands, aspect, face, now),
      vertices() {
        const position = paperRef.current?.mesh?.geometry.attributes.position
        return position ? Array.from(position.array as Float32Array) : null
      },
    }
    return () => {
      window.__HANDS__ = undefined
    }
  }, [step])

  /**
   * The last stage of the frame pipeline, and the only one that is a pure
   * function of the session: what the paper IS, turned into what `<Paper>` is
   * told. It used to be eighty lines of conditional JSX right here, which
   * meant the question you most want to ask of a gesture — given that the
   * sheet is in this state, what does the library get — could only be
   * answered by running a browser, a camera shim and a cloth simulation.
   */
  const paper = derive(s.sheet(dialStock(s.stockIndex)))
  // `damage` is a PROP and not part of `derive`, because it is live state
  // rather than config: it changes every frame of a burn and has no business
  // in a preset or a share link. See `DamageSource`.
  const { field, pool } = fireRefs()

  return (
    <>
      <div className="stage">
        <Paper ref={paperRef} {...paper} damage={field} interactive>
          <CanvasBridge getMesh={getMesh} onReady={onReady} />
          {/* At the canvas root, so the embers are in world space — which is
              what `surfacePoint` hands the emitter. */}
          <FxParticles pool={pool} />
        </Paper>
      </div>

      <svg className="trail" aria-hidden="true">
        <line ref={trailRef} />
      </svg>
      <div ref={cursorRef} className="cursor" aria-hidden="true" />
      <div ref={otherRef} className="cursor other" aria-hidden="true" />

      <div className="hud">
        <h1>Hands</h1>
        <p className="sub">
          A camera, a gesture, and the interactions the paper already had. Nothing in the library changed.
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
        <p ref={readoutRef} className="readout" />
        <dl className="legend">
          <dt>pinch</dt>
          <dd>take hold and pull — on a corner it peels instead</dd>
          <dt>flick it away</dt>
          <dd>a snap with the sheet in hand throws it off its pins</dd>
          <dt>point</dt>
          <dd>score a line — the sheet keeps it</dd>
          <dt>flick</dt>
          <dd>throw a watercolour at it</dd>
          <dt>hold a pinch in the air</dt>
          <dd>
            a match — hold the flame against the paper and it catches, and it burns where you held it. Blow it
            out{status === 'live' && !blowReady ? ' (model loading)' : ''}
          </dd>
          <dt>turn a palm</dt>
          <dd>change the stock under your hand</dd>
          <dt>blow</dt>
          <dd>pucker — the wind rises{status === 'live' && !blowReady ? ' (model loading)' : ''}</dd>
          <dt>fist</dt>
          <dd>
            fold along the line you scored — or crush it, with nothing scored. Squeeze harder for more of
            either
          </dd>
          <dt>open palm</dt>
          <dd>let go of the fold or the crush</dd>
          <dt>pull an edge</dt>
          <dd>tear it ragged</dd>
          <dt>pull apart</dt>
          <dd>two hands rip along the perforation</dd>
          <dt>two palms</dt>
          <dd>spread them — the sheet resizes</dd>
        </dl>
        <p className="mode">
          hand:{' '}
          <strong>
            {s.squeeze === 'fold'
              ? `folding ${s.fold}° along ${s.creases.length} scored ${s.creases.length === 1 ? 'line' : 'lines'}`
              : s.squeeze === 'crush'
                ? 'crushing'
                : s.peel
                  ? `peeling the ${s.peel} corner`
                  : 'open'}
          </strong>
          {s.thrown ? (
            <>
              <br />
              the sheet is off its pins
            </>
          ) : null}
          <br />
          stock: <strong>{paper.stock}</strong> · wind: <strong>{s.wind.toFixed(2)}</strong> · size:{' '}
          <strong>{s.scale.toFixed(2)}×</strong>
          <br />
          scored: <strong>{s.creases.length}</strong> · washed: <strong>{s.wash ? 'yes' : 'no'}</strong>
          <br />
          torn: <strong>{s.torn.join(', ') || 'nothing'}</strong> · ripped:{' '}
          <strong>{s.ripped.join(', ') || 'nothing'}</strong>
        </p>
        {s.creases.length ||
        s.torn.length ||
        s.ripped.length ||
        s.wash ||
        s.scale !== 1 ||
        s.squeeze !== 'none' ||
        s.thrown ? (
          <button type="button" className="ghost" onClick={reset}>
            fresh sheet
          </button>
        ) : null}
        <p className="privacy">
          The tracking models are downloaded from Google the first time you start the camera. After that
          everything runs in your browser: no video, and no measurement taken from it, ever leaves this device
          — there is no server to send it to.
        </p>
        {message ? <p className={status === 'error' ? 'error' : 'note'}>{message}</p> : null}
        {/* Mirrored to match the pointer mapping, so what you see is what you aim. */}
        <video ref={videoRef} className="feed" playsInline muted />
      </div>
    </>
  )
}

/**
 * The tracker's hands, labelled and de-duplicated.
 *
 * Handedness is used only as an IDENTITY here — which reader and which flick
 * tracker this hand belongs to — so the label being wrong costs nothing, but
 * the label being the SAME on both hands would cost everything: two hands in
 * one slot means one of them silently disappears. It happens, so the second
 * one takes the free slot.
 */
function readHands(
  landmarks: readonly Landmark[][],
  handedness: readonly { categoryName: string }[][],
): HandInput[] {
  const hands: HandInput[] = []
  for (const [index, hand] of landmarks.entries()) {
    const label: Handedness = handedness[index]?.[0]?.categoryName === 'Left' ? 'Left' : 'Right'
    const taken = hands.some((other) => other.handedness === label)
    hands.push({ landmarks: [...hand], handedness: taken ? (label === 'Left' ? 'Right' : 'Left') : label })
  }
  return hands.slice(0, 2)
}

createRoot(document.getElementById('root')!).render(<App />)
