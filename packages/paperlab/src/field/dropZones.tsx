import * as THREE from 'three'
import { createContext, useContext, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import type { PaperConfig } from '../config/schema'

// ── Drop zones ─────────────────────────────────────────────────────────────

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

export interface ZoneEntry extends DropZoneConfig {
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

export const DropZoneContext = createContext<DropZoneRegistry | null>(null)

// Compiled accept-globs, cached — zoneAccepts runs every frame in the carry
// loop, and a fresh RegExp per glob per frame is pure GC churn.
const globCache = new Map<string, RegExp>()
const globRegExp = (glob: string): RegExp => {
  let re = globCache.get(glob)
  if (!re) {
    re = new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`, 'i')
    globCache.set(glob, re)
  }
  return re
}

/** True when `name` matches the zone's accept globs (all zones accept by default). */
export function zoneAccepts(zone: Pick<DropZoneConfig, 'accept'>, name: string): boolean {
  if (!zone.accept || zone.accept.length === 0) return true
  return zone.accept.some((glob) => globRegExp(glob).test(name))
}

export const zoneContains = (zone: ZoneEntry, x: number, y: number): boolean =>
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

  // `onPlace` is a notification, not a dependency. The natural way to pass
  // one is an inline arrow, which is a new function on every render of the
  // page above — naming it here re-registered the zone on every one of those
  // renders, bumping the registry version and re-rendering every
  // `DropZoneVisual` in the field. Held in a ref, the registration depends on
  // what the zone IS, and the callback is read at the moment it fires.
  const place = useRef(onPlace)
  useEffect(() => {
    place.current = onPlace
  }, [onPlace])

  // biome-ignore lint/correctness/useExhaustiveDependencies: Serialized deps — re-registering on object identity would thrash the registry.
  useEffect(() => {
    if (!registry) return
    return registry.register({
      id,
      accept,
      bounds,
      highlight,
      onPlace: (paper, zone) => place.current?.(paper, zone),
    })
  }, [registry, id, JSON.stringify(accept ?? null), JSON.stringify(bounds), highlight])
  if (!registry) return null
  return <DropZoneVisual registry={registry} config={{ id, accept, bounds, highlight }} />
}

/** The translucent target — brightens when the carried paper is over it. */
export function DropZoneVisual({ registry, config }: { registry: DropZoneRegistry; config: DropZoneConfig }) {
  useSyncExternalStore(registry.subscribe, registry.getVersion, registry.getVersion)
  const hovered = registry.hovered === config.id
  const style = config.highlight ?? 'glow'
  const [w, h] = config.bounds.size
  // Memoized: an inline `new THREE.PlaneGeometry` in args would rebuild (and
  // leak) the edges every render — and this re-renders on every hover change.
  const edges = useMemo(() => {
    const plane = new THREE.PlaneGeometry(w, h)
    const geo = new THREE.EdgesGeometry(plane)
    plane.dispose()
    return geo
  }, [w, h])
  useEffect(() => () => edges.dispose(), [edges])
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
      <lineSegments geometry={edges}>
        <lineBasicMaterial color={hovered ? '#aebfff' : '#6b7da8'} />
      </lineSegments>
    </group>
  )
}
