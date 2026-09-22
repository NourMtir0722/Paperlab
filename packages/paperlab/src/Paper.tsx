import { Canvas } from '@react-three/fiber'
import { forwardRef, useMemo } from 'react'
import { PaperMesh, useResolvedConfig, type PaperHandle, type PaperMeshProps } from './PaperMesh'
import { PaperFallback, PaperMirror, supportsWebGL } from './a11y'
import { PaperLighting } from './scene/PaperLighting'
import { PaperBackdrop } from './scene/backdrop'
import { ReleaseContextOnUnmount } from './scene/release'
import { CANVAS_SHADOWS } from './scene/shadows'

export interface PaperProps extends PaperMeshProps {
  /** Extra children rendered inside the canvas (lights are provided). */
  children?: React.ReactNode
  className?: string
  style?: React.CSSProperties
}

/**
 * `<Paper />` owns its own `<Canvas>` and fills its parent container —
 * the parent must have a height. Use `<PaperMesh />` inside an existing
 * R3F scene instead.
 *
 * Ships with its accessibility layer: a hidden DOM mirror of the content,
 * `prefers-reduced-motion` support, and a flat DOM fallback when WebGL is
 * unavailable.
 */
export const Paper = forwardRef<PaperHandle, PaperProps>(function Paper(
  { children, className, style, ...meshProps },
  ref,
) {
  // Keyed on every prop resolveConfig reads — a content/stock/behavior change
  // must refresh the fallback, mirror, and lighting, not just the mesh.
  const config = useResolvedConfig(meshProps)
  const webgl = useMemo(() => (typeof window === 'undefined' ? true : supportsWebGL()), [])

  return (
    <div className={className} style={{ width: '100%', height: '100%', ...style }}>
      {webgl ? (
        <Canvas shadows={CANVAS_SHADOWS} camera={{ position: [0, 0.35, 2.4], fov: 40 }} dpr={[1, 2]}>
          <PaperBackdrop backdrop={config.scene.backdrop} />
          <PaperLighting
            preset={config.scene.lighting}
            // The overrides, which this component was resolving without: a
            // preset whose scene said "studio, but dimmer" rendered as plain
            // studio here while the editor showed the dimmer one.
            light={config.scene.light}
            // One floor height, shared: the ground the shadow falls on is the
            // ground a sheet lands on.
            floor={config.scene.floor.enabled ? config.scene.floor.y : -1.05}
            scale={8}
            reducedMotion={meshProps.reducedMotion}
            // A burn bright enough to light the room says so on its source.
            damage={meshProps.damage}
          />
          {config.scene.floor.enabled && (
            // Dark, matte and large enough to leave no edge in frame: what the
            // fire's light pools on, and what the paper it cuts loose lands on.
            <mesh rotation-x={-Math.PI / 2} position={[0, config.scene.floor.y, 0]} receiveShadow>
              <planeGeometry args={[40, 40]} />
              {config.scene.floor.roughness >= 1 ? (
                // Chalk: all the way matte, no highlight at all. A standard material,
                // even at full roughness, turns into a mirror of the key at a grazing
                // angle, which drew a bright band across a black set.
                <meshLambertMaterial color={config.scene.floor.color} />
              ) : (
                <meshStandardMaterial
                  color={config.scene.floor.color}
                  roughness={config.scene.floor.roughness}
                />
              )}
            </mesh>
          )}
          <PaperMesh ref={ref} {...meshProps} />
          {children}
          <ReleaseContextOnUnmount />
        </Canvas>
      ) : (
        <PaperFallback config={config} />
      )}
      <PaperMirror config={config} />
    </div>
  )
})
