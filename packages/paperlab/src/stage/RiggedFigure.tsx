import { useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { Component, type ReactNode, type RefObject, useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { clipTimeFor, type FigureOptions, isRunning, pickClip, pickStillClip } from './gait'

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
 * - **`figure.finish` decides whether you see it.** At `silhouette` the whole
 *   rig is one flat unlit colour, which is what this mode was built around:
 *   the figure gives the banners a scale reference and never competes with
 *   them. At `shaded` it keeps its own materials and takes the scene's light
 *   — in a backlit hall that means a rim down one edge and the studio light
 *   filling the other, which is the only setting where bringing a good model
 *   buys anything.
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

  const silhouette = options.finish === 'silhouette'
  const material = useMemo(
    () => (silhouette ? new THREE.MeshBasicMaterial({ color: options.color, toneMapped: false }) : null),
    [silhouette, options.color],
  )
  useEffect(() => () => material?.dispose(), [material])

  // Silhouette the whole rig — or leave its own materials on it — and size it
  // off its own bounds so the asset's authored units stop mattering.
  const scale = useMemo(() => {
    scene.traverse((child: THREE.Object3D) => {
      const mesh = child as THREE.Mesh
      if (!mesh.isMesh) return
      // Stashed on the way past, because switching back to `shaded` has to
      // put the asset's own materials back and by then we have overwritten
      // the only reference to them this clone had.
      mesh.userData.plAuthored ??= mesh.material
      mesh.material = material ?? (mesh.userData.plAuthored as THREE.Material)
      mesh.castShadow = true
      // A shaded figure standing on the floor of a lit hall catches the
      // banners' shadows; a flat silhouette has nothing to catch them with.
      mesh.receiveShadow = !silhouette
    })
    // updateMatrixWorld first, and it is load-bearing: a freshly cloned scene
    // has stale world matrices, so Box3 measures the root's untransformed
    // geometry, reports a model far smaller than it is, and the scale that
    // falls out of it is correspondingly enormous.
    scene.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(scene)
    const height = box.max.y - box.min.y
    return height > 0 ? options.height / height : 1
  }, [scene, material, silhouette, options.height])

  const mixer = useMemo(() => new THREE.AnimationMixer(scene), [scene])

  // A figure that is not walking should be STANDING, not holding frame 0 of
  // a stride — see `pickStillClip`.
  const clip = useMemo(() => {
    const names = gltf.animations.map((a) => a.name)
    const wanted = frozen ? pickStillClip(names) : pickClip(names, isRunning(options))
    return gltf.animations.find((a) => a.name === wanted) ?? gltf.animations[0]
  }, [gltf.animations, options, frozen])

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
