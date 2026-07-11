import { Canvas } from '@react-three/fiber'
import { ContactShadows } from '@react-three/drei'
import { forwardRef, useMemo } from 'react'
import { PaperMesh, resolveConfig, type PaperHandle, type PaperMeshProps } from './PaperMesh'
import { PaperFallback, PaperMirror, supportsWebGL } from './a11y'

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
  const config = useMemo(() => resolveConfig(meshProps), [JSON.stringify(meshProps.preset ?? {})])
  const webgl = useMemo(() => (typeof window === 'undefined' ? true : supportsWebGL()), [])

  return (
    <div className={className} style={{ width: '100%', height: '100%', ...style }}>
      {webgl ? (
        <Canvas shadows camera={{ position: [0, 0.35, 2.4], fov: 40 }} dpr={[1, 2]}>
          <ambientLight intensity={0.65} />
          <directionalLight
            position={[2.5, 4, 3]}
            intensity={1.6}
            castShadow
            shadow-mapSize={[1024, 1024]}
            shadow-normalBias={0.05}
          />
          <PaperMesh ref={ref} {...meshProps} />
          <ContactShadows position={[0, -1.05, 0]} opacity={0.35} scale={8} blur={2.4} far={3} />
          {children}
        </Canvas>
      ) : (
        <PaperFallback config={config} />
      )}
      <PaperMirror config={config} />
    </div>
  )
})
