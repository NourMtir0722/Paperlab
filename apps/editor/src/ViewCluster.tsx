import * as THREE from 'three'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { usePrefersReducedMotion } from 'paperlab'
import { isTypingTarget } from './keys'

/**
 * The camera, made visible.
 *
 * Orbiting a sheet was always possible and nothing on screen said so, which
 * meant the only way to find out the camera existed was to try dragging and
 * see what happened. Worse, the one view that sells this library — looking
 * down the sheet's own plane, where thickness and curl are the whole picture
 * — was reachable only by orbiting almost exactly ninety degrees by hand.
 *
 * So: four named positions, a key each, drawn at the foot of the canvas.
 *
 * ## Why this is the app's only glass
 *
 * It floats over the viewport, so what it blurs is the paper. Every other
 * surface in the editor is docked to an edge and has nothing behind it but
 * the page, which is why they are all opaque plate — see `docs/design.md`,
 * amendment 1. The rule is worth the fuss because a library whose claim is
 * "real geometry, not a CSS fake" cannot afford chrome made of fake glass.
 *
 * ## Why the cluster holds camera verbs only
 *
 * A Blender-style transform gizmo would have nothing to transform: the sheet
 * IS the scene. The gestures worth adding next are the deformer's own —
 * a handle per signature param, and dragging the key light — and both need
 * library work first. A button that toggles nothing is worse than an absent
 * one, so they are in `docs/roadmap.md` rather than greyed out here.
 */

export type SnapView = 'front' | 'three-quarter' | 'edge' | 'back'
type Request = SnapView | 'frame'

/**
 * Unit directions, scaled by the mode's framing distance. `edge` is the one
 * that matters: a sheet lies in the XY plane, so a camera sitting almost
 * exactly on X looks along its face and sees only its thickness and its
 * curve.
 */
const DIRECTION: Record<SnapView, THREE.Vector3> = {
  front: new THREE.Vector3(0, 0.1, 1).normalize(),
  'three-quarter': new THREE.Vector3(0.52, 0.32, 0.79).normalize(),
  edge: new THREE.Vector3(0.998, 0.05, 0.04).normalize(),
  back: new THREE.Vector3(0, 0.1, -1).normalize(),
}

/** The DOM half and the canvas half talk through this, not through React. */
const listeners = new Set<(r: Request) => void>()
const subscribe = (fn: (r: Request) => void) => {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
const request = (r: Request) => {
  for (const fn of listeners) fn(r)
}

/**
 * Canvas-side. Lerps the camera to whatever was last asked for and stops
 * when it arrives — a spring would overshoot, and the style's motion rule is
 * that nothing overshoots.
 */
export function CameraRig({ home, radius }: { home: [number, number, number]; radius: number }) {
  const camera = useThree((s) => s.camera)
  // `makeDefault` on <OrbitControls> is what puts it here.
  const controls = useThree((s) => s.controls) as { update?: () => void } | null
  const goal = useRef<THREE.Vector3 | null>(null)
  // The camera travel is the one thing in this app that moves on its own, so
  // it is the one thing that has to ask. The library exports this hook and
  // the docs teach visitors to honour it; the editor does not get an
  // exemption for its own chrome.
  const still = usePrefersReducedMotion()

  useEffect(
    () =>
      subscribe((r) => {
        goal.current =
          r === 'frame' ? new THREE.Vector3(...home) : DIRECTION[r].clone().multiplyScalar(radius)
      }),
    [home, radius],
  )

  useFrame((_, dt) => {
    const target = goal.current
    if (!target) return
    if (still) {
      // Cut, don't travel. The view still changes — it just arrives.
      camera.position.copy(target)
      goal.current = null
    } else {
      // Frame-rate independent ease-out: the same fraction of the remaining
      // distance per second however fast the machine is drawing.
      camera.position.lerp(target, 1 - 0.0015 ** Math.min(dt, 0.1))
      if (camera.position.distanceTo(target) < 0.004) {
        camera.position.copy(target)
        goal.current = null
      }
    }
    camera.lookAt(0, 0, 0)
    controls?.update?.()
  })

  return null
}

/**
 * The icons are drawn here rather than imported because the verbs are paper
 * verbs: no icon set has a mark for "edge-on", and that is the one this app
 * most needs to name. One grid, one stroke weight, so the row reads as a set.
 */
const ICON = {
  width: 19,
  height: 19,
  viewBox: '0 0 20 20',
  focusable: false,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.25,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const

const VIEWS: { id: SnapView; label: string; key: string; icon: ReactNode }[] = [
  {
    id: 'front',
    label: 'Front',
    key: '1',
    icon: (
      <svg {...ICON} aria-hidden="true">
        <rect x="5.5" y="3.5" width="9" height="13" rx="1" />
      </svg>
    ),
  },
  {
    id: 'three-quarter',
    label: 'Three-quarter',
    key: '2',
    icon: (
      <svg {...ICON} aria-hidden="true">
        <path d="M7.2 4.2 14 2.9v14.2L7.2 15.8V4.2Z" />
        <path d="M7.2 4.2 4 6v8l3.2 1.8" />
      </svg>
    ),
  },
  {
    id: 'edge',
    label: 'Edge-on',
    key: '3',
    icon: (
      <svg {...ICON} aria-hidden="true">
        <path d="M8.6 3.5v13M11.4 3.5v13M8.6 3.5h2.8M8.6 16.5h2.8" />
        <path d="M4.5 10h2.3M13.2 10h2.3" strokeDasharray="1.5 1.5" />
      </svg>
    ),
  },
  {
    id: 'back',
    label: 'Back',
    key: '4',
    icon: (
      <svg {...ICON} aria-hidden="true">
        <rect x="5.5" y="3.5" width="9" height="13" rx="1" strokeDasharray="2 1.6" />
        <path d="M11.6 8.2 8.4 10l3.2 1.8" />
      </svg>
    ),
  },
]

/** DOM-side: the cluster itself. */
export function ViewCluster() {
  const [view, setView] = useState<SnapView | null>(null)

  const go = useCallback((r: Request) => {
    request(r)
    setView(r === 'frame' ? null : r)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return
      const hit = VIEWS.find((v) => v.key === e.key)
      if (hit) {
        go(hit.id)
        return
      }
      if (e.key === 'f' || e.key === 'F') go('frame')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go])

  return (
    <div className="view-cluster" role="toolbar" aria-label="Camera">
      {VIEWS.map((v) => (
        <span className="cluster-slot" key={v.id}>
          <button
            type="button"
            className={view === v.id ? 'on' : undefined}
            aria-label={v.label}
            aria-pressed={view === v.id}
            onClick={() => go(v.id)}
          >
            {v.icon}
          </button>
          <span className="cluster-tip">
            {v.label}
            <kbd>{v.key}</kbd>
          </span>
        </span>
      ))}

      <span className="cluster-rule" />

      <span className="cluster-slot">
        <button type="button" aria-label="Frame the paper" onClick={() => go('frame')}>
          <svg {...ICON} aria-hidden="true">
            <path d="M3 7V4.5a1 1 0 0 1 1-1h2.5M13.5 3.5H16a1 1 0 0 1 1 1V7M17 13v2.5a1 1 0 0 1-1 1h-2.5M6.5 16.5H4a1 1 0 0 1-1-1V13" />
            <rect x="7.5" y="7.5" width="5" height="5" rx=".5" />
          </svg>
        </button>
        <span className="cluster-tip">
          Frame<kbd>F</kbd>
        </span>
      </span>
    </div>
  )
}
