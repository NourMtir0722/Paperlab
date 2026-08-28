import * as THREE from 'three'
import { useEffect, useMemo } from 'react'
import { cssColorOr } from '../scene/color'

/**
 * The cyclorama: an inverted sphere graded from the source colour at the
 * horizon to near-dark overhead.
 *
 * A single bright plane at the end of the walk is enough for a shot pointed
 * down that walk, and nothing at all for one pointed across it — `wide`
 * framed the figure against an unlit void. A room has walls in every
 * direction, and grading them toward the light is what puts the haze and the
 * distance on the same side of the frame as the source.
 */

/**
 * Procedural, so the repo carries no binary and the grade stays editable.
 *
 * Three stops, not two. The grade used to run zenith → horizon and stop
 * there, which put the brightest colour in the room on the floor line and
 * below it — so the space had no bottom and the ground plane sat on a band
 * of light instead of in a room. Below the horizon it now falls to the
 * floor's own colour, and the picture gains a lower half.
 */
export function makeSkyTexture(sky: SkyColors): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 4
  canvas.height = 256
  const ctx = canvas.getContext('2d')!
  const grade = ctx.createLinearGradient(0, 0, 0, canvas.height)
  // These three are typed into text fields, so mid-keystroke they are not
  // colours yet — and `addColorStop` throws on what it cannot parse, from
  // inside a render. See `cssColorOr`.
  const zenith = cssColorOr(sky.zenith, '#241c17')
  const horizon = cssColorOr(sky.horizon, '#fff4e2')
  const ground = cssColorOr(sky.ground, '#141210')
  // Canvas row 0 is the top of the sphere. The grade has to travel most of
  // the way down: held flat until near the horizon it reads as a dark lid
  // over a bright slot, which is the black void this is here to remove.
  grade.addColorStop(0, zenith)
  grade.addColorStop(0.3, zenith)
  grade.addColorStop(0.62, horizon)
  grade.addColorStop(0.7, horizon)
  grade.addColorStop(1, ground)
  ctx.fillStyle = grade
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

/** Zenith, horizon and floor — the same three the studio light is built from. */
export interface SkyColors {
  zenith: string
  horizon: string
  ground: string
}

/**
 * The source itself: bright at the centre, falling to nothing at the edges.
 *
 * A flat rectangle of light has a BORDER, and the moment a shot is not
 * pointed straight down the walk that border draws a hard diagonal across
 * the sky. Fading it out is what lets a finite plane read as an opening
 * rather than as a panel hung in the room.
 */
export function makeGlowTexture(color: string): THREE.CanvasTexture {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  const glow = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  const c = new THREE.Color(color)
  // The falloff is carried by the COLOUR, on a texture that stays fully
  // opaque, and `Source` adds it to the room rather than mixing into it.
  //
  // It was an alpha ramp over a flat colour, which is the same picture in
  // theory and a drift of green dots across the far wall in Safari. A 2D
  // canvas stores its pixels premultiplied; uploading one as an
  // un-premultiplied texture makes the browser divide the colour back out,
  // and along this tail — where alpha reaches 3/255 — that division
  // multiplies an 8-bit rounding error by eighty. WebKit's rounding puts a
  // few of those texels off-hue, and this plane is the widest thing in
  // frame, so a handful of bad texels became speckle over the whole end of
  // the hall. Premultiplying the ramp here means there is nothing to divide
  // back out: what is drawn is what is uploaded.
  //
  // Adding is the more honest model anyway — a source puts light INTO the
  // room, it does not stand in front of it — and it is what stops the tail
  // from very slightly darkening everything it crosses.
  //
  // A held core and then a long tail. The core has to stay — it is the one
  // thing in frame brighter than the paper, and a falloff that starts at the
  // centre gives a soft warm haze with nothing to walk toward. The tail is
  // long for its own reason: dropping from full to nothing over the last 45%
  // put a visible RIM on the plane, a disc of light with an edge hanging in
  // the room like a moon, and light does not have an edge.
  for (const [stop, level] of [
    [0, 1],
    [0.5, 1],
    [0.62, 0.66],
    [0.74, 0.34],
    [0.86, 0.11],
    [0.94, 0.03],
    [1, 0],
  ] as const) {
    const scaled = `${(c.r * 255 * level) | 0}, ${(c.g * 255 * level) | 0}, ${(c.b * 255 * level) | 0}`
    glow.addColorStop(stop, `rgb(${scaled})`)
  }
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, size, size)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

/**
 * The source's default burn, in linear light.
 *
 * Chosen by matching: at 3.4 the tone-mapped source lands on the same read
 * as the un-mapped plane it replaces, so a stage that never mounts a
 * composer looks the way it always did, and one that does gets a source
 * that blooms instead of a rectangle that clips.
 */
export const SOURCE_INTENSITY = 3.4

export function Source({
  size,
  position,
  yaw,
  color,
  intensity = SOURCE_INTENSITY,
}: {
  size: number
  position: readonly [number, number, number]
  yaw: number
  color: string
  /**
   * How many times brighter than white the source burns, in linear light.
   *
   * This used to be `toneMapped: false` — the source wrote its colour
   * straight to the frame and no curve ever touched it. That is a workaround
   * for not having a post chain, and it stops working the moment there is
   * one: a composer tone-maps the whole framebuffer at the end, so a
   * material that opted out of the renderer's curve is not exempt from the
   * composer's, and the source came out crushed to a flat grey panel — the
   * one thing in the scene that must never look like a panel.
   *
   * Authoring it as a genuine HDR emitter is both the fix and the more
   * honest description: light IS brighter than white, that is what makes it
   * light, and a tone curve rolling off a value above 1.0 is exactly what
   * gives a source its falloff instead of an edge. It is also the only thing
   * bloom can key off, since a threshold near 1.0 means "brighter than
   * paper" and paper is the brightest thing here that is not the source.
   */
  intensity?: number
}) {
  const texture = useMemo(() => makeGlowTexture(color), [color])
  useEffect(() => () => texture.dispose(), [texture])
  return (
    <mesh position={position as unknown as THREE.Vector3} rotation={[0, yaw, 0]}>
      <planeGeometry args={[size * 2.4, size * 1.8]} />
      <meshBasicMaterial
        map={texture}
        transparent
        // The map is premultiplied and opaque — see `makeGlowTexture` — so
        // the falloff has to be applied by ADDING it, and adding is what a
        // light does to a room in any case.
        blending={THREE.AdditiveBlending}
        // `color` multiplies the map, and a THREE.Color is not clamped to 1,
        // so this is how a basic material carries HDR.
        color={new THREE.Color(intensity, intensity, intensity)}
        // It is light, not an object: it must not occlude or fog. It IS
        // tone-mapped now — see `intensity`.
        depthWrite={false}
        fog={false}
      />
    </mesh>
  )
}

export function Surround({ radius, sky }: { radius: number; sky: SkyColors }) {
  // Destructured so the memo depends on the three colours rather than on the
  // identity of the object carrying them — the rig is rebuilt whenever any
  // light slider moves, and repainting the dome for a change in exposure is
  // a canvas and a texture upload for nothing.
  const { zenith, horizon, ground } = sky
  const texture = useMemo(() => makeSkyTexture({ zenith, horizon, ground }), [zenith, horizon, ground])
  useEffect(() => () => texture.dispose(), [texture])

  return (
    <mesh>
      <sphereGeometry args={[radius, 32, 24]} />
      {/* Unlit and unfogged — it IS the distance, so haze must not stack on it. */}
      <meshBasicMaterial map={texture} side={THREE.BackSide} fog={false} />
    </mesh>
  )
}
