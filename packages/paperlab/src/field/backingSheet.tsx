import * as THREE from 'three'
import { useEffect, useMemo } from 'react'
import { drawBacking } from '../content/backing'
import { sheetBackingSize, type SheetLayoutOptions } from './sheetGrid'

/** Warmer than printer stock — the classic gummed backing paper. */
const BACKING_TINT = '#f3ecdd'

/**
 * The shared sheet behind a stamp grid: one extra paper sized to the grid
 * bounds + margin, non-interactive, excluded from `papers` indices. Its
 * content is a generated canvas of ghost silhouettes, redrawn on state
 * change (never per-frame).
 */
export function BackingSheet({
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
