import { Canvas } from '@react-three/fiber'
import { ContactShadows } from '@react-three/drei'
import { forwardRef } from 'react'
import { PaperMesh, type PaperHandle, type PaperMeshProps } from './PaperMesh'

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
 */
export const Paper = forwardRef<PaperHandle, PaperProps>(function Paper(
  { children, className, style, ...meshProps },
  ref,
) {
  return (
    <div className={className} style={{ width: '100%', height: '100%', ...style }}>
      <Canvas shadows camera={{ position: [0, 0.35, 2.4], fov: 40 }} dpr={[1, 2]}>
        <ambientLight intensity={0.65} />
        <directionalLight
          position={[2.5, 4, 3]}
          intensity={1.6}
          castShadow
          shadow-mapSize={[1024, 1024]}
        />
        <PaperMesh ref={ref} {...meshProps} />
        <ContactShadows position={[0, -1.05, 0]} opacity={0.35} scale={8} blur={2.4} far={3} />
        {children}
      </Canvas>
    </div>
  )
})
