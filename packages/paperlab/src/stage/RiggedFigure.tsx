import { useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { Component, type ReactNode, type RefObject, useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { clipTimeFor, type FigureOptions, isRunning, pickClip } from './gait'

/**
 * The figure as somebody else's rig, when `figure.model` names one.
 *
 * The asset is never part of the library — it is a URL the app hosts, and
 * nothing about it ships in the npm tarball. What the library contributes is
 * the part that is actually hard: **the clip is scrubbed by distance walked,
 * not played on a clock.** A mixer running on its own time skates the feet
 * the instant the figure's pace disagrees with the animator's, and a
 * scroll-driven walk makes them disagree constantly. See `clipTimeFor`.
 *
 * Two deliberate choices worth knowing before supplying a detailed model:
 *
 * - **It is drawn as a silhouette, like the capsules.** The nave is lit from
 *   behind; a shaded character standing in it dissolves into the haze it has
 *   to read against, and the figure is there to give the banners a scale
 *   reference rather than to be looked at. Seeing the model itself means a
 *   different lighting preset, which is a different feature.
 * - **It is scaled to `figure.height`,** measured off its own bounding box,
 *   so an asset authored in centimetres and one authored in metres both come
 *   out the right size against the paper.
 */

/** Falls back to the capsules rather than emptying the stage. */
class ModelBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: unknown) {
    // A missing or malformed model is the app's to fix, and silence would
    // leave it looking like `figure.model` had simply done nothing.
    console.warn('[paperlab] figure.model failed to load — using the capsule figure.', error)
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

export interface RiggedFigureProps {
  url: string
  options: FigureOptions
  /**
   * Ground covered, world units, shared by reference with the parent rather
   * than passed as a prop — it changes every frame, and re-rendering a loaded
   * skeleton sixty times a second to tell it a number is not worth it.
   */
  distance: RefObject<number>
  frozen: boolean
}

function Rigged({ url, options, distance, frozen }: RiggedFigureProps) {
  const gltf = useGLTF(url)

  // Clone through SkeletonUtils, not Object3D.clone: a plain clone of a
  // skinned mesh keeps pointing at the ORIGINAL skeleton, so two figures on
  // one URL would drive each other. useGLTF caches per URL, which is exactly
  // the case that would hit it.
  const scene = useMemo(() => cloneSkeleton(gltf.scene), [gltf.scene])

  const material = useMemo(
    () => new THREE.MeshBasicMaterial({ color: options.color, toneMapped: false }),
    [options.color],
  )
  useEffect(() => () => material.dispose(), [material])

  // Silhouette the whole rig, and size it off its own bounds so the asset's
  // authored units stop mattering.
  const scale = useMemo(() => {
    scene.traverse((child: THREE.Object3D) => {
      const mesh = child as THREE.Mesh
      if (mesh.isMesh) {
        mesh.material = material
        mesh.castShadow = true
        mesh.receiveShadow = false
      }
    })
    const box = new THREE.Box3().setFromObject(scene)
    const height = box.max.y - box.min.y
    return height > 0 ? options.height / height : 1
  }, [scene, material, options.height])

  const mixer = useMemo(() => new THREE.AnimationMixer(scene), [scene])

  const clip = useMemo(() => {
    const wanted = pickClip(
      gltf.animations.map((a) => a.name),
      isRunning(options),
    )
    return gltf.animations.find((a) => a.name === wanted) ?? gltf.animations[0]
  }, [gltf.animations, options])

  useEffect(() => {
    if (!clip) return
    mixer.clipAction(clip).play()
    return () => {
      mixer.stopAllAction()
      mixer.uncacheClip(clip)
    }
  }, [mixer, clip])

  useFrame(() => {
    if (!clip) return
    // setTime rather than update(delta): the playhead is a pure function of
    // ground covered, so the same distance gives the same pose however the
    // frame rate wobbled on the way there.
    mixer.setTime(frozen ? 0 : clipTimeFor(distance.current, options, clip.duration))
  })

  return <primitive object={scene} scale={scale} />
}

/**
 * The rig, with the capsules standing by for every way a URL can let you
 * down: a 404, a file that is not a glTF, a rig with no clips.
 */
export function RiggedFigure({ fallback, ...props }: RiggedFigureProps & { fallback: ReactNode }) {
  return (
    <ModelBoundary fallback={fallback}>
      <Rigged {...props} />
    </ModelBoundary>
  )
}
