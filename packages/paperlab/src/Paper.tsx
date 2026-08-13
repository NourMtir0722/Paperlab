import { Canvas } from '@react-three/fiber'
import { forwardRef, useMemo } from 'react'
import {
  PaperMesh,
  resolveConfig,
  resolveConfigKey,
  type PaperHandle,
  type PaperMeshProps,
} from './PaperMesh'
import { PaperFallback, PaperMirror, supportsWebGL } from './a11y'
import { PaperLighting } from './scene/PaperLighting'

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
  // biome-ignore lint/correctness/useExhaustiveDependencies: resolveConfigKey serializes every prop resolveConfig reads — the props object itself is new each render.
  const config = useMemo(() => resolveConfig(meshProps), [resolveConfigKey(meshProps)])
  const webgl = useMemo(() => (typeof window === 'undefined' ? true : supportsWebGL()), [])

  return (
    <div className={className} style={{ width: '100%', height: '100%', ...style }}>
      {webgl ? (
        <Canvas shadows camera={{ position: [0, 0.35, 2.4], fov: 40 }} dpr={[1, 2]}>
          <PaperLighting
            preset={config.scene.lighting}
            floor={-1.05}
            scale={8}
            reducedMotion={meshProps.reducedMotion}
          />
          <PaperMesh ref={ref} {...meshProps} />
          {children}
        </Canvas>
      ) : (
        <PaperFallback config={config} />
      )}
      <PaperMirror config={config} />
    </div>
  )
})
