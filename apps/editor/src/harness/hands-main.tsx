import { createRoot } from 'react-dom/client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { Paper, type PaperEdge, type PaperHandle, type StockName, type WashConfig } from 'paperlab'
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
  foldAlong,
  nearestCorner,
  nearestEdge,
  ripsApart,
  type Crease,
  type PaperCorner,
  type UV,
} from './marks'
import { assignRoles, handFor, NO_ROLES, type HandRead, type Handedness, type Roles } from './roles'
import { FLICK_SPEED, FlickTracker, isFlick, washFromFlick, type Release } from './flick'
import { DIAL, dialIndex, dialStock, turnedBy } from './dial'
import { Breath } from './breath'
import { Span } from './span'

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
 * changes are free, STRUCTURAL changes reset the sheet. `surface.*`,
 * `memory.creases`, `stock` and the live cloth parameters update in place;
 * changing `pins`, the sheet's dimensions, or swapping physics for a behavior
 * rebuilds the sim and snaps the paper flat.
 *
 * That is why scoring, tearing, painting, blowing and changing the stock all
 * feel right, and why the fist does not. The schema makes a simulation and a
 * behavior EXCLUSIVE — "the sim owns the vertices" — so a fist swaps cloth out
 * for `crumple`, which throws away the drape the sim had built and starts the
 * crush from a flat sheet. In real life you crush the paper you are holding;
 * here it snaps first. That is the library's exclusivity rule showing through,
 * not a bug in this file, and it is the one change that would turn the other
 * eleven behaviors into gesture material at a stroke.
 *
 * Still out of reach: punch and cut. The sheet is a fixed-topology grid, so a
 * hole in the middle or a split into two sheets needs real work in the
 * library — a torn EDGE is alpha on the existing mesh, which is why that one
 * is reachable and the other two are not.
 */

/**
 * Served by this page, from this origin. `pnpm hands:setup` puts them there.
 *
 * They used to be fetched from third-party CDNs at runtime, which was fine
 * for a spike and is not fine for anything else: a demo that dies when a CDN
 * does is not a demo, and — the part that actually matters — nothing else in
 * this repo pulls EXECUTABLE code from a third-party origin at runtime.
 * A wasm binary is executable code, and whoever serves that URL can run
 * whatever they like inside the page.
 *
 * Not committed either. `tools/hands-assets.mjs` copies the wasm out of
 * `node_modules` (it is already a declared dependency, so those are the same
 * bytes at the same version) and fetches the two models once, pinned by
 * digest — 35 MB of weights is not something a library repo should make
 * everyone clone.
 */
const WASM_BASE = '/hands'
const HAND_MODEL_URL = '/hands/hand_landmarker.task'
/** The face model. Loaded second, and the page works without it. */
const FACE_MODEL_URL = '/hands/face_landmarker.task'

/** What to say when the setup step has not been run. */
const MISSING_ASSETS =
  'the tracker’s wasm and models are not in apps/editor/public/hands — run `pnpm hands:setup`'

/**
 * Whether the assets are actually there, asked before anything tries to load
 * them. `FilesetResolver` reports a missing wasm as a stack trace out of a
 * generated glue file, which is a long way from "run the setup script".
 */
async function assetsPresent(): Promise<boolean> {
  try {
    const response = await fetch(HAND_MODEL_URL, { method: 'HEAD' })
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
type Squeeze = 'none' | 'fold' | 'crush'

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
 * The sheet the `pinned-sheet` preset defines, at rest.
 *
 * Not a constant any more: two hands can resize it, and a crease is a signed
 * WORLD offset, so a crease measured against yesterday's dimensions lands in
 * the wrong place on a sheet that has since grown.
 */
const BASE_SHEET = { width: 1.2, height: 1.5 }

function sheetAt(scale: number): { width: number; height: number } {
  return { width: BASE_SHEET.width * scale, height: BASE_SHEET.height * scale }
}

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
 * The ground, in proportion to the sheet.
 *
 * A fixed floor is a floor at a fixed height, so a sheet twice the size hangs
 * through it and piles up on it. Scaling it with the sheet keeps the drop
 * proportional, which is what makes a big sheet read as a big sheet rather
 * than as a sheet in a smaller room. It is a live cloth parameter, so this
 * costs no rebuild.
 */
const BASE_FLOOR = -1.4

/** How far a grabbed edge has to be pulled, as a fraction of the canvas, before it tears. */
const TEAR_PULL = 0.32

/** How far a corner has to be lifted, as a fraction of the canvas, for a full peel. */
const PEEL_PULL = 0.3

/** Both slots, always read, so a hand that leaves resets its own reader. */
const SIDES: readonly Handedness[] = ['Left', 'Right']

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
  const [squeeze, setSqueeze] = useState<Squeeze>('none')
  const [fold, setFold] = useState(0)
  const [peel, setPeel] = useState<PaperCorner | null>(null)
  const [thrown, setThrown] = useState(false)
  const [creases, setCreases] = useState<Crease[]>([])
  const [torn, setTorn] = useState<PaperEdge[]>([])
  const [ripped, setRipped] = useState<PaperEdge[]>([])
  const [stockIndex, setStockIndex] = useState(DIAL.indexOf('printer'))
  const [wash, setWash] = useState<WashConfig | null>(null)
  const [wind, setWind] = useState(WIND)
  const [scale, setScale] = useState(1)
  const [blowReady, setBlowReady] = useState(false)

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
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef(0)
  // The frame loop's own copies: state reaches it a render late, and a mode
  // read a render late swaps twice.
  const squeezeRef = useRef<Squeeze>('none')
  const foldRef = useRef(0)
  const crushRef = useRef(0)
  // A peel in progress: the corner it took hold of and where on screen.
  const peelRef = useRef<{ corner: PaperCorner; from: { x: number; y: number } } | null>(null)
  const thrownRef = useRef(false)
  // Whether the driving hand was already pinching last frame — a peel is a
  // decision made when a pinch lands, not one revisited every frame.
  const wasPinchingRef = useRef(false)
  // Whether the grab that is live right now actually landed on the paper.
  // A snap of the fingers over empty space throws paint; the same snap with
  // the sheet in your hand throws the SHEET.
  const heldSheetRef = useRef(false)
  const creasesRef = useRef<Crease[]>([])
  const tornRef = useRef<PaperEdge[]>([])
  const rippedRef = useRef<PaperEdge[]>([])
  const stockRef = useRef(stockIndex)
  const windRef = useRef(WIND)
  const scaleRef = useRef(1)
  const rolesRef = useRef<Roles>(NO_ROLES)
  const washSeedRef = useRef(0)
  const washCountRef = useRef(0)
  // A score in progress: where the fingertip landed, and where it is now.
  const scoreFromRef = useRef<(UV & { clientX: number; clientY: number }) | null>(null)
  const scoreToRef = useRef<UV | null>(null)
  /** Where the acting hand is on the canvas, for the score trail to follow. */
  const scoreAtRef = useRef<{ x: number; y: number } | null>(null)
  // A grab in progress: the edge it started on, and where on screen.
  const grabEdgeRef = useRef<PaperEdge | null>(null)
  const grabOriginRef = useRef<{ x: number; y: number } | null>(null)
  /** Whether this grab has already torn something — one edge per grab. */
  const grabTornRef = useRef(false)
  // A two-handed pull in progress: how far apart the hands were, and the edge.
  const ripRef = useRef<{ gap: number; edge: PaperEdge | null } | null>(null)
  /** How far apart the two hands are right now — reported, not decided on. */
  const ripGapRef = useRef(0)
  // A dial in progress: the roll the palm went up at, and the stock it was on.
  const dialFromRef = useRef<{ roll: number; index: number } | null>(null)

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
      const from = scoreFromRef.current
      const to = scoreToRef.current
      if (trail) {
        const drawing = frame.name === 'point' && from !== null && to !== null
        trail.style.opacity = drawing ? '1' : '0'
        if (drawing && from) {
          trail.setAttribute('x1', String(from.clientX))
          trail.setAttribute('y1', String(from.clientY))
          trail.setAttribute('x2', String(scoreAtRef.current?.x ?? from.clientX))
          trail.setAttribute('y2', String(scoreAtRef.current?.y ?? from.clientY))
        }
      }
      const readout = readoutRef.current
      if (readout) {
        const blow = breathRef.current.blow
        readout.textContent =
          frame.curl === null
            ? `no hand in frame${blow > 0.05 ? ` · blowing ${blow.toFixed(2)}` : ''}`
            : `${frame.name.padEnd(6)} ${hands} hand${hands === 1 ? '' : 's'} · aperture ${frame.aperture!.toFixed(2)} · curl ${frame.curl.toFixed(2)} · wind ${windRef.current.toFixed(2)}`
      }
    },
    [],
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

        // Every pinch opening is collected and none of them is judged here:
        // what a snap MEANS depends on whether the sheet was in that hand,
        // and this loop runs before the roles that answer it.
        const release = flicksRef.current[side].push(anchor, frame.name === 'pinch', now)
        if (release) releases[side] = release

        if (landmarks) {
          reads.push({
            handedness: side,
            frame,
            anchor,
            landmarks,
            palm: palmLength(landmarks, aspect),
            roll: palmRoll(landmarks, aspect),
          })
        }
      }

      const roles = assignRoles(reads, rolesRef.current)
      rolesRef.current = roles
      const hold = handFor(reads, roles.hold)
      const act = handFor(reads, roles.act)
      const frame = act?.frame ?? NO_GESTURE

      // ── Blow. The one gesture that is not a hand at all. ──────────────────
      const nextWind = breathRef.current.push(face?.pucker ?? null)
      if (nextWind !== windRef.current) {
        windRef.current = nextWind
        setWind(nextWind)
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
      if (nextScale !== scaleRef.current) {
        // A crease is a signed world offset from the sheet's centre, so the
        // creases have to grow with the sheet or they slide off it.
        const ratio = nextScale / scaleRef.current
        scaleRef.current = nextScale
        setScale(nextScale)
        if (creasesRef.current.length) {
          creasesRef.current = creasesRef.current.map((crease) => ({
            ...crease,
            offset: crease.offset * ratio,
          }))
          setCreases(creasesRef.current)
        }
      }

      // ── Close your hand. On a scored sheet that folds it; otherwise it ───
      //    crushes it. No mode swap either way: the sheet stays cloth, stays
      //    grabbable, and keeps the drape it is hanging in, because the stack
      //    now runs OVER the simulation rather than instead of it.
      if (frame.name === 'fist' && squeezeRef.current === 'none') {
        squeezeRef.current = creasesRef.current.length ? 'fold' : 'crush'
        setSqueeze(squeezeRef.current)
      } else if (frame.name === 'palm' && !spanning && squeezeRef.current !== 'none') {
        squeezeRef.current = 'none'
        foldRef.current = 0
        crushRef.current = 0
        setSqueeze('none')
        setFold(0)
      }

      if (frame.curl !== null && squeezeRef.current === 'crush') {
        // Imperatively, not through props: a behavior's progress is what
        // `ref.set` is for, and routing it through React every frame would
        // re-render the tree that owns the canvas.
        crushRef.current = Math.max(crushRef.current, crushFromCurl(frame.curl))
        paperRef.current?.set('progress', crushRef.current)
      } else if (frame.curl !== null && squeezeRef.current === 'fold') {
        // A fold angle is a deformer OPTION, and there is no imperative door
        // to one — so it goes through React, quantised, and only on a change.
        // Highest reached, not current: paper does not unfold because your
        // hand relaxed.
        const next = Math.max(foldRef.current, foldFromCurl(frame.curl))
        if (next !== foldRef.current) {
          foldRef.current = next
          setFold(next)
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
        if (wasDriving && heldSheetRef.current && release.speed >= FLICK_SPEED) {
          heldSheetRef.current = false
          if (!thrownRef.current) {
            thrownRef.current = true
            setThrown(true)
          }
        } else if (isFlick(release)) {
          // The seed has to move or the wash paints the same picture twice —
          // it is a pure function of its options, so an identical seed reads
          // as nothing having happened.
          washSeedRef.current += 17
          washCountRef.current += 1
          setWash(washFromFlick(release, washSeedRef.current))
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

      // ── Peel. A pinch that lands on a CORNER curls it back. ───────────────
      // The same pose as a grab, and a different thing, because a corner is
      // not the middle of the sheet. The sim can pull a corner but it cannot
      // curl one — `peel` rolls it, which is the whole reason to reach for a
      // behavior rather than let the physics have it.
      if (!pinching || squeezeRef.current !== 'none') {
        if (peelRef.current) {
          peelRef.current = null
          setPeel(null)
        }
      } else if (!wasPinchingRef.current && driverAt && uv && squeezeRef.current === 'none') {
        // Only on the frame the pinch CLOSES. A grab that turned into a peel
        // because the hand dragged the sheet's corner under itself would let
        // go of the paper half way through the pull — which is exactly what
        // tearing an edge is, so it took the tear with it.
        const corner = nearestCorner(uv)
        if (corner) {
          peelRef.current = { corner, from: driverAt }
          setPeel(corner)
        }
      }
      wasPinchingRef.current = pinching

      // A peeling hand is not a grabbing hand: the pointer stays up, so the
      // sim never takes hold and the two do not fight over the same corner.
      const pointer = pointerRef.current?.update(driver?.anchor ?? null, pinching && !peelRef.current) ?? null

      if (peelRef.current && driverAt && rect) {
        const lifted = Math.hypot(driverAt.x - peelRef.current.from.x, driverAt.y - peelRef.current.from.y)
        const reach = Math.hypot(rect.width, rect.height) * PEEL_PULL
        paperRef.current?.set('progress', Math.min(1, lifted / reach))
      }

      // The acting hand may not be the one carrying the pointer, so it gets
      // its own raycast. `hitUV` needs no pointer event — which is exactly
      // what makes a second hand possible against a library with one grab.
      const actAt = act?.anchor && rect ? toClient(act.anchor, rect) : null
      const actUV = act === driver ? uv : actAt && stage ? stage.hitUV(actAt.x, actAt.y) : null
      scoreAtRef.current = actAt

      // ── Score. Draw with a fingertip; the sheet keeps the line. ───────────
      if (squeezeRef.current === 'none' && frame.name === 'point' && actAt) {
        if (!scoreFromRef.current && actUV) {
          scoreFromRef.current = { ...actUV, clientX: actAt.x, clientY: actAt.y }
        }
        // Only if the fingertip actually travelled there. The reader keeps
        // saying `point` for a few frames after the hand has stopped
        // pointing, and those frames would otherwise drag the line's end to
        // wherever the hand relaxed to.
        if (actUV && (!scoreToRef.current || continuesScore(scoreToRef.current, actUV))) {
          scoreToRef.current = actUV
        }
      } else if (scoreFromRef.current) {
        // The finger stopped pointing: commit whatever line it drew.
        const from = scoreFromRef.current
        const to = scoreToRef.current
        scoreFromRef.current = null
        scoreToRef.current = null
        const crease = to && creaseFromDrag(from, to, sheetAt(scaleRef.current))
        if (crease) {
          creasesRef.current = addCrease(creasesRef.current, crease)
          setCreases(creasesRef.current)
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
      if (squeezeRef.current === 'none' && frame.name === 'palm' && !spanning && act?.roll != null) {
        dialFromRef.current ??= { roll: act.roll, index: stockRef.current }
        const origin = dialFromRef.current
        const next = dialIndex(turnedBy(origin.roll, act.roll), origin.index, stockRef.current)
        if (next !== stockRef.current) {
          stockRef.current = next
          setStockIndex(next)
        }
      } else {
        dialFromRef.current = null
      }

      // ── Tear. Take an edge and pull until it gives. ───────────────────────
      if (pointer?.down) {
        if (!grabOriginRef.current) {
          grabOriginRef.current = { x: pointer.x, y: pointer.y }
          grabEdgeRef.current = null
          grabTornRef.current = false
          heldSheetRef.current = uv !== null
        }
        // The edge is the last one the hand was SEEN over, not whichever it
        // was over on the single frame the grab landed. A raycast against a
        // draped sheet misses now and then, and losing a tear to one of those
        // reads as tearing being unreliable — which is how it read.
        if (!grabTornRef.current && !grabEdgeRef.current && uv) {
          grabEdgeRef.current = nearestEdge(uv)
        }
        const edge = grabEdgeRef.current
        const origin = grabOriginRef.current
        if (edge && stage && !tornRef.current.includes(edge) && !rippedRef.current.includes(edge)) {
          const canvas = stage.canvas.getBoundingClientRect()
          const pulled = Math.hypot(pointer.x - origin.x, pointer.y - origin.y)
          if (pulled > Math.hypot(canvas.width, canvas.height) * TEAR_PULL) {
            tornRef.current = [...tornRef.current, edge]
            setTorn(tornRef.current)
            // One edge per grab: let go and take hold again to tear another.
            grabEdgeRef.current = null
            grabTornRef.current = true
          }
        }
      } else {
        grabOriginRef.current = null
        grabEdgeRef.current = null
        heldSheetRef.current = false
      }

      // ── Rip. Two hands, pulling apart, along the dotted line. ─────────────
      // The other tearing flavour, and the one that needs a second hand: a
      // perforation is torn by holding one side still and pulling the other
      // away, so the measurement is the GROWTH in the gap between the hands.
      const ripping =
        hold !== null && act !== null && hold !== act && act.frame.name === 'pinch' && hold.palm !== null
      if (ripping && hold.anchor && act.anchor && hold.palm !== null) {
        const gap = palmsApart(hold.anchor, act.anchor, hold.palm, aspect)
        ripGapRef.current = gap
        const edgeNow = (actUV && nearestEdge(actUV)) ?? grabEdgeRef.current
        if (!ripRef.current) ripRef.current = { gap, edge: edgeNow }
        const started = ripRef.current
        // The edge is the last one the pulling hand was SEEN over, not
        // whatever it happened to be over on the one frame the pull armed. A
        // raycast against a draped sheet misses for a frame here and there,
        // and losing the whole gesture to one of those reads as the rip
        // simply not working.
        if (!started.edge && edgeNow) started.edge = edgeNow
        if (started.edge && ripsApart(started.gap, gap)) {
          const edge = started.edge
          if (!rippedRef.current.includes(edge) && !tornRef.current.includes(edge)) {
            rippedRef.current = [...rippedRef.current, edge]
            setRipped(rippedRef.current)
          }
          ripRef.current = null
        }
      } else {
        ripRef.current = null
      }

      paint(frame, pointer, reads.length, act === driver ? null : actAt)
      return {
        frame,
        pointer,
        squeeze: squeezeRef.current,
        fold: foldRef.current,
        crush: crushRef.current,
        peel: peelRef.current?.corner ?? null,
        thrown: thrownRef.current,
        holding: heldSheetRef.current,
        creases: creasesRef.current.length,
        torn: tornRef.current,
        ripped: rippedRef.current,
        stock: dialStock(stockRef.current),
        wind: windRef.current,
        scale: scaleRef.current,
        washes: washCountRef.current,
        hands: reads.length,
        roles,
        uv,
        pending: { from: scoreFromRef.current, to: scoreToRef.current },
        pulling: ripRef.current && { ...ripRef.current, now: ripGapRef.current },
      }
    },
    [paint],
  )

  const reset = useCallback(() => {
    thrownRef.current = false
    peelRef.current = null
    heldSheetRef.current = false
    setThrown(false)
    setPeel(null)
    squeezeRef.current = 'none'
    foldRef.current = 0
    crushRef.current = 0
    setSqueeze('none')
    setFold(0)
    spanRef.current.reset()
    scaleRef.current = 1
    setScale(1)
    creasesRef.current = []
    tornRef.current = []
    rippedRef.current = []
    washCountRef.current = 0
    setCreases([])
    setTorn([])
    setRipped([])
    setWash(null)
  }, [])

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    pointerRef.current?.dispose()
    pointerRef.current = null
    for (const side of SIDES) {
      readersRef.current[side].reset()
      flicksRef.current[side].reset()
    }
    breathRef.current.reset()
    // Not `reset()`: the size two hands set is the sheet's, like its creases,
    // and stopping the camera is not a fresh sheet. Only the grip is dropped.
    spanRef.current.push(null)
    squeezeRef.current = 'none'
    setSqueeze('none')
    rolesRef.current = NO_ROLES
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
      const fileset = await FilesetResolver.forVisionTasks(WASM_BASE)
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

  const stock = dialStock(stockIndex)
  const perforated: Partial<Record<PaperEdge, 'torn'>> = {}
  for (const edge of ripped) perforated[edge] = 'torn'

  return (
    <>
      <div className="stage">
        <Paper
          ref={paperRef}
          preset="pinned-sheet"
          // Two hands set this. A rebuild is invisible on a shape — a deformer
          // is a pure function of its options — and on cloth the drape now
          // survives it, because `ClothSim.adopt` carries the particles over.
          sheet={sheetAt(scale)}
          stock={stock}
          content={{
            type: 'text',
            text: 'Pinch to hold.\nPoint to score.\nFlick to paint.',
            size: 40,
            ...(wash ? { wash } : {}),
          }}
          // Creases and surface effects live BESIDE the vertices rather than
          // owning them, so unlike a behavior they compose with the sim.
          memory={{ creases }}
          surface={{
            ...(torn.length ? { deckle: { edges: torn, roughness: 0.6 } } : {}),
            // Perforated from the start, because a dotted line you cannot see
            // is not an affordance. The defaults are tuned to a postage
            // stamp, and at this sheet's size they scallop the edges like one
            // — fine holes read as a tear line, coarse ones read as a stamp.
            perforation: {
              edges: 'all',
              holeRadius: 0.007,
              spacing: 0.026,
              state: perforated,
            },
          }}
          // Cloth, always — it is never swapped out for a shape now, it
          // HOSTS one. The sheet stays grabbable through a fold and a crush.
          //
          // `pins` is the one thing a gesture takes AWAY: flick the sheet
          // while you are holding it and it lets go of the wall. The rebuild
          // that costs is free of consequence now — `ClothSim.adopt` carries
          // the drape and the velocity across it, so the sheet leaves at the
          // speed your hand gave it instead of dropping from a standstill.
          physics={{
            type: 'cloth',
            pins: thrown ? 'none' : 'top-corners',
            wind,
            stiffness: 0.75,
            floor: BASE_FLOOR * scale,
          }}
          // The shape running over the simulation. Folds are raw deformers
          // because they are aimed at lines the SHEET is carrying —
          // `creaseFromDrag` produced each `{ angle, offset }` when a
          // fingertip scored it, and `fold` takes the identical pair.
          {...(squeeze === 'fold' && creases.length
            ? {
                deformers: creases.map((crease, index) => ({
                  type: 'fold' as const,
                  options: {
                    // Named so each flap is the smaller side — see `foldAlong`.
                    ...foldAlong(crease),
                    // Alternating, so two scored lines concertina instead of
                    // rolling the same way twice — which is what a hand does
                    // to paper and what makes a second fold legible as one.
                    // Negative first because the flap should fold AWAY from
                    // the camera: swung forward it comes at the lens and shows
                    // you its back.
                    foldAngle: index % 2 === 0 ? -fold : fold,
                    radius: 0.05,
                  },
                })),
              }
            : squeeze === 'crush'
              ? { behavior: { type: 'crumple' as const, progress: 0 } }
              : peel
                ? { behavior: { type: 'peel' as const, corner: peel, progress: 0, radius: 0.2 } }
                : {})}
          interactive
        >
          <CanvasBridge getMesh={getMesh} onReady={onReady} />
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
            {squeeze === 'fold'
              ? `folding ${fold}° along ${creases.length} scored ${creases.length === 1 ? 'line' : 'lines'}`
              : squeeze === 'crush'
                ? 'crushing'
                : peel
                  ? `peeling the ${peel} corner`
                  : 'open'}
          </strong>
          {thrown ? (
            <>
              <br />
              the sheet is off its pins
            </>
          ) : null}
          <br />
          stock: <strong>{stock}</strong> · wind: <strong>{wind.toFixed(2)}</strong> · size:{' '}
          <strong>{scale.toFixed(2)}×</strong>
          <br />
          scored: <strong>{creases.length}</strong> · washed: <strong>{wash ? 'yes' : 'no'}</strong>
          <br />
          torn: <strong>{torn.join(', ') || 'nothing'}</strong> · ripped:{' '}
          <strong>{ripped.join(', ') || 'nothing'}</strong>
        </p>
        {creases.length ||
        torn.length ||
        ripped.length ||
        wash ||
        scale !== 1 ||
        squeeze !== 'none' ||
        thrown ? (
          <button type="button" className="ghost" onClick={reset}>
            fresh sheet
          </button>
        ) : null}
        <p className="privacy">
          Tracking runs entirely in your browser. No video leaves this device, and there is no server.
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
