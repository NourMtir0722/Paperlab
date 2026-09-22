import * as THREE from 'three'
import { useEffect, useMemo, useRef, useState, type Ref } from 'react'
import { gsap } from 'gsap'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import CustomShaderMaterial from 'three-custom-shader-material'
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { surfaceSchema, type MountConfig, type MountStickerConfig } from '../config/schema'
import { getStock } from '../core/stock'
import { useContentTexture } from '../content/texture'
import { PaperMaterial } from '../surface/PaperMaterial'
import { createLemonGeometry } from './lemon'
import { MountSurface, weldedNormals } from './surface'
import { buildWrap } from './wrap'
import { SKIN_GLSL } from './skin'
import { MountRig } from './rig'
import { getDeformer } from '../deformers/registry'
import { STICKER_RELEASE_AT, stickerFront } from '../behaviors/sticker'

/** How finely the skin is pitted and how deep, for an object of this size. */
export interface SkinScale {
  scale: number
  depth: number
}

/** The object a sheet is mounted on, once it exists. */
export interface MountHost {
  surface: MountSurface
  /** The built lemon, drawn with the skin shader. */
  lemon: THREE.BufferGeometry | null
  /** A loaded model, already scaled and centred into host space. */
  model: THREE.Object3D | null
  /** The pore field, or null for a model — whose skin is its own material's. */
  skin: SkinScale | null
  /** Half the object's length along its own vertical, for the skin's ends. */
  halfLength: number
}

/**
 * Pores are fixed to the FRUIT, not the world: a bigger lemon has bigger
 * pits. At the default size a pit is about a hundredth of the length.
 */
export function skinScale(mount: Pick<MountConfig, 'size' | 'pores'>): SkinScale {
  return { scale: 150 / mount.size, depth: 0.0013 * mount.size * mount.pores }
}

/**
 * The object, built or loaded, and its surface for the sticker to be laid
 * on. The lemon is synchronous; a model arrives when it has loaded, and is
 * null until then — the sheet waits for it rather than floating in space
 * for a frame and snapping on.
 */
export function useMountHost(mount: MountConfig | undefined): MountHost | null {
  const object = mount?.object
  const model = mount?.model ?? ''
  const size = mount?.size ?? 1
  const pores = mount?.pores ?? 0
  // Keyed on these primitives and never on `mount` itself: the config is
  // parsed afresh on every edit, so the object is new every time, and a host
  // keyed on it re-laid every sticker on the object at every slider step.
  const hasMount = Boolean(mount)

  // A model that is missing or would not load falls back to the lemon, so a
  // sheet is never left stuck to nothing — invisible, waiting for an object
  // that is not coming.
  const [failed, setFailed] = useState('')
  const wantLemon = object === 'lemon' || (object === 'model' && (!model || failed === model))
  const lemon = useMemo(() => {
    if (!wantLemon) return null
    const geometry = createLemonGeometry({ girth: 0.68, nipple: 0.7, lumps: 0.18, seed: 3 })
    geometry.scale(size, size, size)
    geometry.computeBoundingBox()
    geometry.computeBoundingSphere()
    return { geometry, surface: new MountSurface(geometry) }
  }, [wantLemon, size])
  useEffect(() => () => lemon?.geometry.dispose(), [lemon])

  const [loaded, setLoaded] = useState<{ key: string; root: THREE.Object3D; surface: MountSurface } | null>(
    null,
  )
  useEffect(() => {
    if (object !== 'model' || !model) return
    let cancelled = false
    void import('three/examples/jsm/loaders/GLTFLoader.js').then(({ GLTFLoader }) => {
      new GLTFLoader().load(
        model,
        (gltf: GLTF) => {
          if (cancelled) return
          const { root, surface } = normaliseModel(gltf.scene, size)
          setLoaded({ key: `${model}|${size}`, root, surface })
        },
        undefined,
        (error) => {
          if (cancelled) return
          console.warn('[paperlab] mount.model did not load, so the sheet is on the lemon instead:', error)
          setFailed(model)
        },
      )
    })
    return () => {
      cancelled = true
    }
  }, [object, model, size])

  return useMemo<MountHost | null>(() => {
    if (!hasMount) return null
    if (lemon) {
      return {
        surface: lemon.surface,
        lemon: lemon.geometry,
        model: null,
        skin: skinScale({ size, pores }),
        halfLength: size / 2,
      }
    }
    if (loaded && loaded.key === `${model}|${size}`) {
      const box = loaded.surface.bounds
      return {
        surface: loaded.surface,
        lemon: null,
        model: loaded.root,
        skin: null,
        halfLength: (box.max.y - box.min.y) / 2,
      }
    }
    return null
  }, [hasMount, lemon, loaded, model, size, pores])
}

/**
 * Scale a loaded scene so its longest side is `size`, centre it on the
 * origin, and collect every mesh into one surface for the sticker.
 *
 * Every vertex is read where it is DRAWN, through its skin and morph
 * targets (`getVertexPosition`), not where it sits in the buffer: a rigged
 * model's buffer holds its bind pose, which can be scaled, turned or simply
 * elsewhere, and a sticker laid on the bind pose floats beside the model the
 * viewer sees.
 */
function normaliseModel(
  scene: THREE.Object3D,
  size: number,
): { root: THREE.Object3D; surface: MountSurface } {
  scene.updateMatrixWorld(true)
  // Precise: a skinned mesh's own bounds are its bind pose's.
  const box = new THREE.Box3().setFromObject(scene, true)
  const extent = box.getSize(new THREE.Vector3())
  const scale = size / Math.max(extent.x, extent.y, extent.z, 1e-6)
  const centre = box.getCenter(new THREE.Vector3())
  const root = new THREE.Group()
  scene.position.sub(centre)
  root.add(scene)
  root.scale.setScalar(scale)
  root.updateMatrixWorld(true)

  const positions: number[] = []
  const indices: number[] = []
  const v = new THREE.Vector3()
  root.traverse((node) => {
    const mesh = node as THREE.Mesh
    if (!mesh.isMesh || !mesh.visible) return
    mesh.castShadow = true
    mesh.receiveShadow = true
    const geometry = mesh.geometry as THREE.BufferGeometry
    const pos = geometry.attributes.position as THREE.BufferAttribute | undefined
    if (!pos) return
    const base = positions.length / 3
    for (let i = 0; i < pos.count; i++) {
      mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld)
      positions.push(v.x, v.y, v.z)
    }
    if (geometry.index) {
      for (let i = 0; i < geometry.index.count; i++) indices.push(base + geometry.index.getX(i))
    } else {
      for (let i = 0; i < pos.count; i++) indices.push(base + i)
    }
  })
  const merged = new THREE.BufferGeometry()
  const flat = new Float32Array(positions)
  const index = new Uint32Array(indices)
  merged.setAttribute('position', new THREE.BufferAttribute(flat, 3))
  merged.setAttribute('normal', new THREE.BufferAttribute(weldedNormals(flat, index, size), 3))
  merged.setIndex(new THREE.BufferAttribute(index, 1))
  const surface = new MountSurface(merged)
  merged.dispose()
  return { root, surface }
}

const SKIN_VERTEX = /* glsl */ `
varying vec3 vSkinPos;
void main() {
  vSkinPos = position;
}
`

const SKIN_FRAGMENT = /* glsl */ `
uniform vec3 uSkinColor;
uniform float uPoreScale;
uniform float uPoreDepth;
uniform float uHalfLength;
varying vec3 vSkinPos;
${SKIN_GLSL}
void main() {
  float pores = plSkinPores(vSkinPos * uPoreScale);
  float height = uPoreDepth * (-pores + (plSkinValue(vSkinPos * uPoreScale * 0.18) - 0.5) * 0.35);
  float axial = clamp(vSkinPos.y / uHalfLength, -1.0, 1.0);
  csm_DiffuseColor = vec4(plSkinAlbedo(vSkinPos, uSkinColor, pores, axial), 1.0);
  // The skin between the pits is waxy; the pits are matte.
  csm_Roughness = mix(0.4, 0.66, pores);
  csm_FragNormal = plSkinPerturb(csm_FragNormal, height, -vViewPosition);
}
`

/** The lemon, in its skin. */
function Lemon({ host, color }: { host: MountHost; color: string }) {
  // Built once; the values are written below on every render, which moves
  // them without recompiling anything.
  const uniforms = useMemo(
    () => ({
      uSkinColor: { value: new THREE.Color() },
      uPoreScale: { value: 60 },
      uPoreDepth: { value: 0 },
      uHalfLength: { value: 1 },
    }),
    [],
  )
  uniforms.uSkinColor.value.set(color)
  uniforms.uPoreScale.value = host.skin?.scale ?? 60
  uniforms.uPoreDepth.value = host.skin?.depth ?? 0
  uniforms.uHalfLength.value = host.halfLength
  if (!host.lemon) return null
  return (
    <mesh geometry={host.lemon} castShadow receiveShadow>
      <CustomShaderMaterial
        baseMaterial={THREE.MeshPhysicalMaterial}
        vertexShader={SKIN_VERTEX}
        fragmentShader={SKIN_FRAGMENT}
        uniforms={uniforms}
        roughness={0.45}
        clearcoat={0.55}
        clearcoatRoughness={0.28}
        metalness={0}
      />
    </mesh>
  )
}

const REVEAL_VERTEX = /* glsl */ `
varying vec3 vSkinPos;
varying vec2 vStickerUv;
void main() {
  vSkinPos = position;
  vStickerUv = uv;
}
`

const REVEAL_FRAGMENT = /* glsl */ `
uniform vec3 uSkinColor;
uniform float uPoreScale;
uniform float uPoreDepth;
uniform float uHalfLength;
uniform float uSkin;
uniform float uReveal;
uniform vec2 uDir;
uniform float uFront;
uniform float uRelease;
uniform vec2 uSheet;
uniform sampler2D uCut;
uniform float uHasCut;
varying vec3 vSkinPos;
varying vec2 vStickerUv;
${SKIN_GLSL}
void main() {
  // Only where the sheet has come off, and only inside its outline.
  vec2 local = (vStickerUv - 0.5) * uSheet;
  float gone = uRelease > 0.0 ? 1.0 : smoothstep(-0.0015, 0.0015, uFront - dot(local, uDir));
  float cut = uHasCut > 0.5 ? smoothstep(0.35, 0.65, texture2D(uCut, vStickerUv).a) : 1.0;
  float mask = gone * cut * uReveal;
  if (mask <= 0.002) discard;

  // A trace of adhesive: faint, milky, and thickest toward the outline where
  // the glue was pressed hardest at the cut.
  float edge = uHasCut > 0.5 ? 1.0 - smoothstep(0.55, 0.98, texture2D(uCut, vStickerUv).a) : 0.0;
  float residue = (plSkinValue(vSkinPos * 60.0) * 0.6 + plSkinValue(vSkinPos * 190.0) * 0.4);
  residue = smoothstep(0.45, 0.85, residue) * 0.5 + edge * 0.5;

  if (uSkin > 0.5) {
    // The skin that was under it: protected from the air and pressed flat,
    // so paler, glossier, and with its pits half filled.
    float pores = plSkinPores(vSkinPos * uPoreScale);
    float height = uPoreDepth * 0.45 * (-pores + (plSkinValue(vSkinPos * uPoreScale * 0.18) - 0.5) * 0.35);
    float axial = clamp(vSkinPos.y / uHalfLength, -1.0, 1.0);
    vec3 skin = plSkinAlbedo(vSkinPos, uSkinColor, pores * 0.5, axial);
    // Paler and a touch greener: out of the light, and the oil wiped off.
    float lum = dot(skin, vec3(0.299, 0.587, 0.114));
    skin = mix(skin, vec3(lum), 0.12);
    skin = mix(skin, vec3(1.0, 0.98, 0.84), 0.08) * vec3(0.99, 1.01, 0.96);
    skin = mix(skin, vec3(0.9, 0.88, 0.8), residue * 0.1);
    csm_DiffuseColor = vec4(skin, mask);
    csm_Roughness = mix(0.1, 0.3, residue);
    csm_FragNormal = plSkinPerturb(csm_FragNormal, height, -vViewPosition);
  } else {
    // Someone else's material underneath: say it with gloss and a haze.
    csm_DiffuseColor = vec4(vec3(0.92, 0.91, 0.87), mask * (0.08 + residue * 0.18));
    csm_Roughness = 0.14;
  }
}
`

/** The skin the sheet has come off: cleaner, glossier, and a trace of glue. */
function RevealPatch({
  rig,
  host,
  mount,
  cut,
  meshRef,
}: {
  rig: MountRig
  host: MountHost
  mount: MountConfig
  cut: THREE.Texture | null
  meshRef?: Ref<THREE.Mesh>
}) {
  const uniforms = useMemo(
    () => ({
      ...rig.revealUniforms,
      uSkinColor: { value: new THREE.Color() },
      uPoreScale: { value: 60 },
      uPoreDepth: { value: 0 },
      uHalfLength: { value: 1 },
      uSkin: { value: 1 },
      uReveal: { value: 1 },
      uCut: { value: null as THREE.Texture | null },
      uHasCut: { value: 0 },
    }),
    [rig],
  )
  uniforms.uSkinColor.value.set(mount.color)
  uniforms.uPoreScale.value = host.skin?.scale ?? 60
  uniforms.uPoreDepth.value = host.skin?.depth ?? 0
  uniforms.uHalfLength.value = host.halfLength
  uniforms.uSkin.value = host.lemon ? 1 : 0
  uniforms.uReveal.value = mount.reveal
  uniforms.uCut.value = cut
  uniforms.uHasCut.value = cut ? 1 : 0
  return (
    <mesh ref={meshRef} geometry={rig.reveal} receiveShadow renderOrder={1}>
      <CustomShaderMaterial
        baseMaterial={THREE.MeshPhysicalMaterial}
        vertexShader={REVEAL_VERTEX}
        fragmentShader={REVEAL_FRAGMENT}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        polygonOffset
        polygonOffsetFactor={-1}
        polygonOffsetUnits={-2}
        clearcoat={1}
        clearcoatRoughness={0.12}
        metalness={0}
      />
    </mesh>
  )
}

const STRAND_VERTEX = /* glsl */ `
attribute vec3 aStrand;
attribute vec2 aStickerUv;
varying vec3 vStrand;
varying vec2 vStickerUv;
void main() {
  vStrand = aStrand;
  vStickerUv = aStickerUv;
}
`

const STRAND_FRAGMENT = /* glsl */ `
uniform float uTension;
uniform sampler2D uCut;
uniform float uHasCut;
varying vec3 vStrand;
varying vec2 vStickerUv;
float plStrandHash(float n) { return fract(sin(n * 91.3458) * 47453.5453); }
void main() {
  if (uTension <= 0.0) discard;
  if (vStickerUv.x < 0.0 || vStickerUv.x > 1.0 || vStickerUv.y < 0.0 || vStickerUv.y > 1.0) discard;
  float inside = uHasCut > 0.5 ? smoothstep(0.4, 0.7, texture2D(uCut, vStickerUv).a) : 1.0;
  // Strands: a few hundred across the front, each its own width, most of
  // them already snapped further back from the front.
  float cells = 260.0 - vStrand.z * 70.0;
  float cell = floor(vStrand.x * cells);
  float h = plStrandHash(cell + vStrand.z * 17.0);
  float alive = step(0.35 + vStrand.z * 0.2, h);
  float across = abs(fract(vStrand.x * cells) - 0.5) * 2.0;
  // A strand necks in the middle as it is drawn out.
  float neck = mix(0.9, 0.35, sin(vStrand.y * 3.14159));
  float body = 1.0 - smoothstep(neck * 0.6, neck, across);
  float fade = smoothstep(0.0, 0.1, vStrand.y) * smoothstep(1.0, 0.85, vStrand.y);
  float a = uTension * inside * alive * body * mix(0.85, 0.5, vStrand.z);
  a *= 0.55 + 0.45 * fade;
  if (a < 0.02) discard;
  csm_DiffuseColor = vec4(vec3(0.94, 0.93, 0.88), a);
}
`

/** The glue, stretched across the gap at the peel front while it holds. */
function GlueStrands({
  rig,
  cut,
  meshRef,
}: {
  rig: MountRig
  cut: THREE.Texture | null
  meshRef?: Ref<THREE.Mesh>
}) {
  const uniforms = useMemo(
    () => ({ ...rig.strandUniforms, uCut: { value: null as THREE.Texture | null }, uHasCut: { value: 0 } }),
    [rig],
  )
  uniforms.uCut.value = cut
  uniforms.uHasCut.value = cut ? 1 : 0
  return (
    <mesh ref={meshRef} geometry={rig.strands} frustumCulled={false} renderOrder={2}>
      <CustomShaderMaterial
        baseMaterial={THREE.MeshPhysicalMaterial}
        vertexShader={STRAND_VERTEX}
        fragmentShader={STRAND_FRAGMENT}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        side={THREE.DoubleSide}
        roughness={0.2}
        clearcoat={1}
        metalness={0}
      />
    </mesh>
  )
}

/** The resolution a sticker on the object is painted at, as a fraction of a sheet's. */
const STICKER_TEXTURE_SCALE = 0.5

/** How tightly a hand-peeled sticker bends back, and how far it is pulled up. */
const PEEL_RADIUS = 0.028
const PEEL_FLAP = 150
/** Past this the release plays on its own clock — the same snap the `sticker` behavior commits to. */
const PEEL_COMMIT = STICKER_RELEASE_AT * 0.985

const dragPlane = new THREE.Plane()
const dragHit = new THREE.Vector3()
const dragNormal = new THREE.Vector3()
const dragOrigin = new THREE.Vector3()

/**
 * One of the stickers on the object, and every one of them can be peeled.
 *
 * Take hold of it anywhere and pull: the direction you pull is the direction
 * the peel runs, the distance is how far it has got, and the glue fights on
 * the way exactly as the `sticker` behavior does (`stickerFront` is shared, so
 * a hand-peeled sticker and a scrubbed one catch in the same places). Push
 * back and it goes back down. Pull it past the last edge and it lets go on
 * its own.
 *
 * Its peel is the viewer's, not the config's: it lives here and nowhere
 * else, the way a handle drag does, so peeling a sticker to look under it
 * does not rewrite the preset. The config says where the stickers ARE.
 */
function PeelableSticker({
  sticker,
  host,
  mount,
  press,
  gap,
  interactive,
  recall,
  seed,
}: {
  sticker: MountStickerConfig
  host: MountHost
  mount: MountConfig
  press: { amount: number; scale: number; depth: number } | null
  gap: number
  interactive: boolean
  /** Bumped when the object is clicked: a sticker that has flown away comes back. */
  recall: number
  /** Which way it turns and flutters on the air, so a handful of them do not fly in step. */
  seed: number
}) {
  const sheet = useMemo(
    () => ({
      width: sticker.width,
      height: sticker.height,
      thickness: 0.05,
      segments: 40 as const,
      cornerRadius: 0,
    }),
    [sticker.width, sticker.height],
  )
  const surface = useMemo(() => surfaceSchema.parse({ dieCut: { margin: sticker.margin } }), [sticker.margin])
  const content = useMemo(
    () => ({ type: 'image' as const, src: sticker.src, fit: 'contain' as const }),
    [sticker.src],
  )
  const stock = getStock('sticker')
  // Half resolution: a sticker on the object is a few hundred pixels across
  // at most, and a full canvas for each of a dozen of them is a quarter of a
  // gigabyte of textures nobody can see the difference in.
  const texture = useContentTexture(content, sheet, stock, surface.dieCut, STICKER_TEXTURE_SCALE)
  const controls = useThree((s) => s.controls) as { enabled?: boolean } | null

  const { width, height, azimuth, elevation, roll } = sticker
  // Keyed on the fields that shape the lay-up, not on `sticker`, which is a
  // new object after every config parse.
  const built = useMemo(() => {
    const reach = Math.max(width, height) * 1.25
    const wrap = buildWrap(
      host.surface,
      { azimuth, elevation, roll },
      width / 2 + reach,
      height / 2 + reach,
      41,
      [width / 2, height / 2],
    )
    const rig = new MountRig(wrap, { width, height })
    const geometry = new THREE.PlaneGeometry(width, height, 40, 40)
    const count = geometry.attributes.position!.count
    geometry.setAttribute('aAttach', new THREE.BufferAttribute(new Float32Array(count).fill(1), 1))
    const base = Float32Array.from(geometry.attributes.position!.array as Float32Array)
    return { rig, geometry, base }
  }, [host.surface, width, height, azimuth, elevation, roll])
  useEffect(
    () => () => {
      built.geometry.dispose()
      built.rig.dispose()
    },
    [built],
  )

  // The peel, held outside React: it changes every pointer move.
  const peel = useRef({
    progress: 0,
    angle: 0,
    dirty: true,
    grab: null as null | { x: number; y: number; from: number; started: boolean },
  })
  const tween = useRef<gsap.core.Tween | null>(null)
  // A rebuilt lay-up (the sticker moved or resized) has to be drawn again.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `built` is the trigger; the body only flags the ref.
  useEffect(() => {
    peel.current.dirty = true
  }, [built])
  useEffect(() => () => void tween.current?.kill(), [])
  // Gone on the air: clicking the object brings it back the way it went,
  // and it sticks down where it was.
  useEffect(() => {
    const state = peel.current
    if (recall === 0 || state.progress < 0.999) return
    tween.current?.kill()
    const back = { p: state.progress }
    tween.current = gsap.to(back, {
      p: 0,
      duration: 1.8,
      ease: 'power1.inOut',
      onUpdate: () => {
        state.progress = back.p
        state.dirty = true
      },
    })
  }, [recall])

  const liftOptions = useMemo(
    () => ({ angle: 0, front: 0, radius: PEEL_RADIUS, flap: PEEL_FLAP, tension: 0, release: 0 }),
    [],
  )
  const stack = useMemo(
    () => [{ type: 'lift', options: liftOptions as Record<string, unknown> }],
    [liftOptions],
  )
  const scratch = useMemo(() => new THREE.Vector3(), [])
  const uvScratch = useMemo(() => new THREE.Vector2(), [])

  const meshRef = useRef<THREE.Mesh>(null)
  const revealRef = useRef<THREE.Mesh>(null)
  const strandsRef = useRef<THREE.Mesh>(null)
  useFrame(() => {
    const state = peel.current
    if (!state.dirty) return
    state.dirty = false
    const { front, tension, release, fly } = stickerFront(state.progress, mount.tack)
    liftOptions.angle = state.angle
    liftOptions.front = front
    liftOptions.tension = tension
    liftOptions.release = release
    const { geometry, base, rig } = built
    const position = geometry.attributes.position as THREE.BufferAttribute
    const attach = geometry.attributes.aAttach as THREE.BufferAttribute
    const out = position.array as Float32Array
    const ctx = { t: 0, sheet: { width: sticker.width, height: sticker.height } }
    const deformer = getDeformer('lift')
    for (let v = 0; v < position.count; v++) {
      const i3 = v * 3
      scratch.set(base[i3]!, base[i3 + 1]!, 0)
      if (state.progress > 0) deformer.displace(scratch, uvScratch, liftOptions, ctx)
      out[i3] = scratch.x
      out[i3 + 1] = scratch.y
      out[i3 + 2] = scratch.z
    }
    rig.update(state.progress > 0 ? stack : null, ctx)
    rig.shell(out, base, attach.array as Float32Array, position.count, gap)
    const mesh = meshRef.current
    const parent = mesh?.parent
    if (fly > 0 && parent) {
      parent.updateWorldMatrix(true, false)
      rig.fly(out, position.count, 41, fly, parent.matrixWorld, seed)
    }
    if (mesh) hide(mesh, fly >= 0.999)
    position.needsUpdate = true
    attach.needsUpdate = true
    geometry.computeVertexNormals()
    geometry.computeBoundingSphere()
    // A sticker still stuck down has no patch to show and no glue to pull,
    // and with a dozen on the object that is two dozen transparent draws a
    // frame spent discarding every fragment.
    if (revealRef.current) revealRef.current.visible = state.progress > 0
    if (strandsRef.current) strandsRef.current.visible = tension > 0
  })

  /** The pointer, in the sticker's own flat space: on the tangent plane where it is stuck. */
  const flatPoint = (e: ThreeEvent<PointerEvent>): { x: number; y: number } | null => {
    const parent = e.object.parent
    if (!parent) return null
    const wrap = built.rig.wrap
    parent.updateWorldMatrix(true, false)
    dragNormal.copy(wrap.normal).transformDirection(parent.matrixWorld)
    dragOrigin.copy(wrap.origin).applyMatrix4(parent.matrixWorld)
    dragPlane.setFromNormalAndCoplanarPoint(dragNormal, dragOrigin)
    if (!e.ray.intersectPlane(dragPlane, dragHit)) return null
    parent.worldToLocal(dragHit).sub(wrap.origin)
    return { x: dragHit.dot(wrap.axisX), y: dragHit.dot(wrap.axisY) }
  }

  const release = (e: ThreeEvent<PointerEvent>) => {
    const state = peel.current
    if (!state.grab) return
    state.grab = null
    if (controls) controls.enabled = true
    ;(e.target as Element).releasePointerCapture?.(e.pointerId)
  }

  const handlers = interactive
    ? {
        onPointerOver: (e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation()
          document.body.style.cursor = 'grab'
        },
        onPointerOut: () => {
          document.body.style.cursor = ''
        },
        onPointerDown: (e: ThreeEvent<PointerEvent>) => {
          const at = flatPoint(e)
          if (!at) return
          e.stopPropagation()
          tween.current?.kill()
          const state = peel.current
          state.grab = { x: at.x, y: at.y, from: state.progress, started: state.progress > 0 }
          if (controls) controls.enabled = false
          document.body.style.cursor = 'grabbing'
          ;(e.target as Element).setPointerCapture?.(e.pointerId)
        },
        onPointerMove: (e: ThreeEvent<PointerEvent>) => {
          const state = peel.current
          const grab = state.grab
          if (!grab) return
          const at = flatPoint(e)
          if (!at) return
          const vx = at.x - grab.x
          const vy = at.y - grab.y
          // The first real pull decides which way this peel runs.
          if (!grab.started) {
            if (Math.hypot(vx, vy) < 0.012) return
            state.angle = (Math.atan2(vy, vx) * 180) / Math.PI
            grab.started = true
          }
          const a = (state.angle * Math.PI) / 180
          const dx = Math.cos(a)
          const dy = Math.sin(a)
          const half = (Math.abs(dx) * sticker.width + Math.abs(dy) * sticker.height) / 2
          const along = vx * dx + vy * dy
          // The tip travels twice as far as the front, as on the behavior's handle.
          const next = Math.min(1, Math.max(0, grab.from + (along / (4 * half)) * STICKER_RELEASE_AT))
          state.progress = next
          state.dirty = true
          if (next >= PEEL_COMMIT && grab.from < PEEL_COMMIT) {
            release(e)
            const snap = { p: next }
            tween.current = gsap.to(snap, {
              p: 1,
              // The snap, then the flight away.
              duration: 3,
              ease: 'none',
              onUpdate: () => {
                state.progress = snap.p
                state.dirty = true
              },
            })
          }
        },
        onPointerUp: release,
        onPointerCancel: release,
      }
    : {}

  if (!sticker.src) return null
  return (
    <>
      <mesh
        ref={meshRef}
        geometry={built.geometry}
        receiveShadow
        castShadow
        frustumCulled={false}
        {...handlers}
      >
        <PaperMaterial
          stock={stock}
          texture={texture}
          surface={surface}
          thickness={0.05}
          sheet={sheet}
          press={press}
        />
      </mesh>
      <RevealPatch rig={built.rig} host={host} mount={mount} cut={texture} meshRef={revealRef} />
      <GlueStrands rig={built.rig} cut={texture} meshRef={strandsRef} />
    </>
  )
}

/**
 * Stop drawing a mesh, and stop it being hit: three raycasts an invisible
 * mesh as readily as a visible one, and a sticker that has flown out of the
 * shot must not go on taking the clicks meant for what is behind it.
 */
export function hide(mesh: THREE.Mesh, hidden: boolean): void {
  if (mesh.visible === !hidden) return
  mesh.visible = !hidden
  if (hidden) mesh.raycast = () => {}
  else delete (mesh as { raycast?: unknown }).raycast
}

/**
 * Everything on the object that is not the sheet: the object itself, the
 * collection already stuck to it, and — when there is a rig — the skin the
 * sheet leaves and the glue it pulls.
 *
 * A sticker peeled off flies away and is gone; click the object and every
 * one that has gone comes back.
 */
export function MountScene({
  mount,
  host,
  rig,
  cut,
  press,
  interactive = false,
}: {
  mount: MountConfig
  host: MountHost
  rig: MountRig | null
  /** Whether the stickers on it can be taken hold of and peeled. */
  interactive?: boolean
  /** The sheet's die-cut face, whose alpha is its outline. Null when it is not cut. */
  cut: THREE.Texture | null
  press: { amount: number; scale: number; depth: number } | null
}) {
  const [recall, setRecall] = useState(0)
  // A click, not the end of an orbit that happened to start on the object.
  const onObjectClick = interactive
    ? (e: ThreeEvent<MouseEvent>) => {
        if (e.delta > 6) return
        e.stopPropagation()
        setRecall((n) => n + 1)
      }
    : undefined
  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: An R3F <group> is a three.js object, not a DOM node. Recalling the stickers is a viewer's convenience; Space and the timeline replay the main one from the keyboard. */}
      <group onClick={onObjectClick}>
        {host.lemon ? <Lemon host={host} color={mount.color} /> : null}
        {host.model ? <primitive object={host.model} /> : null}
      </group>
      {mount.stickers.map((sticker, i) => (
        <PeelableSticker
          // biome-ignore lint/suspicious/noArrayIndexKey: the list has no ids, and order is its identity.
          key={i}
          sticker={sticker}
          host={host}
          mount={mount}
          press={press}
          gap={0.0012 + i * 0.0003}
          interactive={interactive}
          recall={recall}
          seed={i + 1}
        />
      ))}
      {rig ? <RevealPatch rig={rig} host={host} mount={mount} cut={cut} /> : null}
      {rig ? <GlueStrands rig={rig} cut={cut} /> : null}
    </>
  )
}
