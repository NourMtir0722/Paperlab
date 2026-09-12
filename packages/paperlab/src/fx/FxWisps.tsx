import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import type { Afterglow } from './afterglow'
import { FIELD_SIZE, HEAT, PRESENCE, type DamageField } from './field'
import type { SurfaceLocator } from './fire'

export interface FxWispsProps {
  /** What the sheet draws: where the smouldering beads are. */
  glow: Afterglow
  /** The field under it — a wisp rises where the glow outlives the heat. */
  field: DamageField
  locate: SurfaceLocator
  /** The air, read every frame — pass the pool's `wind`. */
  wind?: readonly [number, number, number]
}

/** At most this many threads at once (spec §8.2: one or two). */
const WISPS = 2
/** Points along one thread. */
const POINTS = 64
/** How long a point of smoke lives before it has thinned to nothing, in seconds. */
const LIFE = 3.4
/** How fast the thread climbs, world units a second — a few centimetres. */
const RISE = 0.075
/** How far apart two threads' beads must be, in cells (~3 cm). */
const APART = 9

/**
 * The smoulder wisp: the shot people screenshot (`Stage_5__cold.png`).
 *
 * Not smoke sprites. A thin, pale thread — a trail of connected points drawn
 * as a ribbon — rising from a glowing bead once the flames are gone, curving
 * in a slow S as it climbs, and lingering a few seconds after the last bead
 * has gone out. One or two at a time.
 *
 * Every point's position is a pure function of where and when it left its
 * bead, on the afterglow's clock, so a scripted burn draws the same wisp
 * every time and nothing here integrates anything that could drift.
 */
export function FxWisps({ glow, field, locate, wind }: FxWispsProps) {
  const state = useRef(
    Array.from({ length: WISPS }, (_, w) => ({
      cell: -1,
      phase: w * 3.1 + 0.7,
      // Ring buffer of births: root position and birth time.
      root: new Float32Array(POINTS * 3),
      born: new Float32Array(POINTS).fill(-1e9),
      next: 0,
      owed: 0,
    })),
  )
  const last = useRef(-1)

  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry()
    const vertices = WISPS * POINTS * 2
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertices * 3), 3))
    g.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(vertices), 1))
    const index: number[] = []
    for (let w = 0; w < WISPS; w++) {
      for (let i = 0; i < POINTS - 1; i++) {
        const a = (w * POINTS + i) * 2
        index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
      }
    }
    g.setIndex(index)
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity)
    return g
  }, [])
  useEffect(() => () => geometry.dispose(), [geometry])
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: /* glsl */ `
          attribute float aAlpha;
          varying float vAlpha;
          void main() {
            vAlpha = aAlpha;
            gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          varying float vAlpha;
          void main() {
            // Pale grey smoke, thin enough that only its accumulation reads.
            gl_FragColor = vec4(vec3(0.62, 0.61, 0.6), vAlpha);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }
        `,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    [],
  )
  useEffect(() => () => material.dispose(), [material])

  useFrame(({ camera }) => {
    const now = glow.time
    const dt = last.current < 0 ? 0 : Math.min(0.1, Math.max(0, now - last.current))
    last.current = now
    const beads = smoulderingBeads(glow, field, WISPS)
    const [wx, , wz] = wind ?? [0, 0, 0]
    const positions = geometry.getAttribute('position') as THREE.BufferAttribute
    const alphas = geometry.getAttribute('aAlpha') as THREE.BufferAttribute
    const p = new THREE.Vector3()
    const q = new THREE.Vector3()
    const toCamera = new THREE.Vector3()
    const side = new THREE.Vector3()
    const path = new Float32Array(POINTS * 3)
    const age = new Float32Array(POINTS)

    for (let w = 0; w < WISPS; w++) {
      const s = state.current[w]!
      // Keep a bead while it glows; take a new one when it goes out — and
      // START THE THREAD OVER when it does.
      //
      // The ring buffer holds where each point was BORN, and those roots
      // belong to the bead it was rising from. Left in place when the wisp
      // moved to another bead, the thread's newest points sat over the new
      // one while its older points were still alive over the old one, and the
      // ribbon joining them is a straight line across the sheet at full
      // alpha. During the smoulder the beads go out one by one, so the wisp
      // re-targets again and again and lays down one line per move: the
      // "random lines" that appear late in a burn, fanning across the burnt
      // area from bead to bead. They only showed while PLAYING, because a
      // seek rebuilds the page and never changes bead twice.
      if (!beads.includes(s.cell)) {
        const taken = beads.find((c) => !state.current.some((o) => o !== s && o.cell === c)) ?? -1
        if (taken !== s.cell) {
          s.born.fill(-1e9)
          s.next = 0
          s.owed = 0
        }
        s.cell = taken
      }
      if (s.cell >= 0 && dt > 0) {
        s.owed += dt
        const every = LIFE / POINTS
        while (s.owed >= every) {
          s.owed -= every
          const at = locate(
            (s.cell % FIELD_SIZE) / (FIELD_SIZE - 1),
            ((s.cell / FIELD_SIZE) | 0) / (FIELD_SIZE - 1),
          )
          if (!at) break
          const k = s.next
          s.root[k * 3] = at.x
          s.root[k * 3 + 1] = at.y
          s.root[k * 3 + 2] = at.z + 0.004
          s.born[k] = now
          s.next = (k + 1) % POINTS
        }
      }
      // Points in age order, newest (at the bead) first.
      for (let i = 0; i < POINTS; i++) {
        const k = (s.next - 1 - i + POINTS * 2) % POINTS
        const a = now - s.born[k]!
        age[i] = a
        const bx = s.root[k * 3]!
        const by = s.root[k * 3 + 1]!
        const bz = s.root[k * 3 + 2]!
        // A slow S: value noise in the point's age, drifting with its birth
        // time so the whole thread sways rather than holding one shape.
        const sway = (noise1(a * 0.8 + s.born[k]! * 0.3 + s.phase) - 0.5) * 0.07 * a
        const lean = (noise1(a * 0.5 + s.phase * 2.3) - 0.5) * 0.02 * a
        path[i * 3] = bx + sway + wx * a * a * 0.25
        path[i * 3 + 1] = by + RISE * a * (1 + 0.18 * a)
        path[i * 3 + 2] = bz + lean + wz * a * a * 0.25
      }
      // A point that is not alive — never born, or already gone — is pulled
      // onto the youngest living one, so the ribbon has no area there. Left
      // where its formula put it, an unborn point is a BILLION seconds old
      // and ~10^16 units away; a strip joining it to a live one covered the
      // frame, and the HDR frame's bloom turned that into a black picture.
      let anchor = -1
      for (let i = 0; i < POINTS; i++) {
        if (age[i]! >= 0 && age[i]! < LIFE) {
          anchor = i
          break
        }
      }
      for (let i = 0; i < POINTS; i++) {
        const a = age[i]!
        if (!(a >= 0 && a < LIFE)) {
          // Onto the nearest living point, so the ribbon has no area here.
          // With NOTHING alive there is no such point, and the fallback used
          // to be the world ORIGIN — the middle of the sheet — so an entire
          // dead thread became a zero-alpha ribbon sitting in the scene
          // rather than nowhere. Collapse it onto its own first point
          // instead: wherever that is, every vertex shares it, so the strip
          // has no area at all.
          const k = anchor >= 0 ? anchor : 0
          path[i * 3] = path[k * 3]!
          path[i * 3 + 1] = path[k * 3 + 1]!
          path[i * 3 + 2] = path[k * 3 + 2]!
        } else {
          anchor = i
        }
      }
      for (let i = 0; i < POINTS; i++) {
        const a = age[i]!
        p.set(path[i * 3]!, path[i * 3 + 1]!, path[i * 3 + 2]!)
        const j = Math.min(POINTS - 1, i + 1)
        const h = Math.max(0, i - 1)
        q.set(
          path[j * 3]! - path[h * 3]!,
          path[j * 3 + 1]! - path[h * 3 + 1]!,
          path[j * 3 + 2]! - path[h * 3 + 2]!,
        )
        toCamera.copy(camera.position).sub(p)
        side.crossVectors(q, toCamera)
        // A degenerate segment has no side; give it one rather than a NaN.
        if (side.lengthSq() < 1e-20) side.set(1, 0, 0)
        side.normalize()
        // A thread at the bead, widening a little as it climbs and thins.
        const half = 0.0011 + 0.0022 * Math.min(1, a / LIFE)
        const v = (w * POINTS + i) * 2
        positions.setXYZ(v, p.x - side.x * half, p.y - side.y * half, p.z - side.z * half)
        positions.setXYZ(v + 1, p.x + side.x * half, p.y + side.y * half, p.z + side.z * half)
        const alive = a >= 0 && a < LIFE ? 1 : 0
        const alpha = alive * Math.min(1, a / 0.25) * (1 - a / LIFE) ** 1.6 * 0.42
        alphas.setX(v, alpha)
        alphas.setX(v + 1, alpha)
      }
    }
    positions.needsUpdate = true
    alphas.needsUpdate = true
  })

  return <mesh geometry={geometry} material={material} frustumCulled={false} renderOrder={1} />
}

/**
 * The beads a wisp may rise from: rim cells where the sheet still glows and
 * the field is cold — smouldering, not burning. Brightest first, and spread
 * `APART` from each other. Deterministic: ties go to the lower cell.
 */
function smoulderingBeads(glow: Afterglow, field: DamageField, max: number): number[] {
  const size = FIELD_SIZE
  const shown = glow.pixels
  const heat = field.pixels
  const found: { cell: number; g: number }[] = []
  for (let y = 1; y < size - 1; y++) {
    for (let x = 1; x < size - 1; x++) {
      const c = y * size + x
      const g = shown[c * 4 + HEAT]!
      if (g < 10 || heat[c * 4 + HEAT]! > 4 || shown[c * 4 + PRESENCE]! < 128) continue
      const rim =
        shown[(c - 1) * 4 + PRESENCE]! < 128 ||
        shown[(c + 1) * 4 + PRESENCE]! < 128 ||
        shown[(c - size) * 4 + PRESENCE]! < 128 ||
        shown[(c + size) * 4 + PRESENCE]! < 128
      if (rim) found.push({ cell: c, g })
    }
  }
  found.sort((a, b) => b.g - a.g || a.cell - b.cell)
  const picked: number[] = []
  for (const f of found) {
    if (picked.length >= max) break
    const fx = f.cell % size
    const fy = (f.cell / size) | 0
    if (picked.every((p) => Math.hypot((p % size) - fx, ((p / size) | 0) - fy) >= APART)) picked.push(f.cell)
  }
  return picked
}

function hash1(n: number): number {
  const s = Math.sin(n) * 43758.5453
  return s - Math.floor(s)
}

function noise1(x: number): number {
  const i = Math.floor(x)
  let f = x - i
  f = f * f * (3 - 2 * f)
  return hash1(i) + (hash1(i + 1) - hash1(i)) * f
}
