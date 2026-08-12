import * as THREE from 'three'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { z } from 'zod'
import { usePrefersReducedMotion } from '../a11y'
import type { ContentConfig, PaperConfigInput } from '../config/schema'
import { PaperFieldMesh } from '../PaperField'
import { resolveConfig } from '../PaperMesh'
import type { FieldPaperSlot } from '../field/slots'
import { getLayout } from '../field/layouts'
import { PaperLighting } from '../scene/PaperLighting'
import { getWalkPath } from './path'
import { stageCamera, walkPoint } from './camera'
import { Figure } from './Figure'
import { Source, Surround } from './Surround'
import { stageSchema, type StageConfig, type StageConfigInput } from './schema'
import {
  FIRST_WINDOW,
  INITIAL_TIER,
  SETTLE_FRAMES,
  STEADY_WINDOW,
  qualityFor,
  qualityTiers,
  tierDown,
  tierUp,
  type QualityName,
  type QualityTier,
} from './quality'

/**
 * Stage mode: paper as architecture, with a figure walking through it.
 *
 * The one guarantee worth stating — every part of the scene reads the SAME
 * walk. The layout arranges along it, the figure follows it, the camera is
 * stationed on it, and the source stands at the end of it. Handing those
 * four their own copies of a path is the failure this component exists to
 * prevent: a colonnade whose aisle the figure does not walk down is not a
 * near-miss, it is a completely different picture.
 */

/** A banner: tall, translucent, with folds running the length of its drop. */
const BANNER: PaperConfigInput = {
  sheet: { width: 1.5, height: 8.5, segments: 'auto' },
  stock: 'vellum',
  surface: { grain: 0.22 },
  deformers: [{ type: 'drape', options: { amplitude: 0.16, folds: 3, falloff: 1.7, gather: 0.28 } }],
}

export interface PaperStageSceneProps {
  /** Walk, shot, figure, lighting — see `stageSchema`. */
  stage?: StageConfigInput
  /** Any layout, but `colonnade` is the one built to arrange along a walk. */
  layout?: string
  layoutOptions?: Record<string, unknown>
  /** Per-banner slots, exactly as in field mode. */
  papers?: FieldPaperSlot[]
  images?: string[]
  /**
   * Words on the banners. A string is split across them a line at a time; an
   * array is used as given. This is the whole point of the mode — a space
   * built out of something the viewer wrote.
   */
  text?: string | string[]
  /** Shared preset behind every banner. */
  preset?: string | PaperConfigInput
  /** How many banners, when none of `papers` / `images` / `text` says. */
  count?: number
  /**
   * How far along the walk the figure is, 0..1. Bind it to scroll and the
   * page scrolls the walk. Omit and it walks on the clock at its own speed.
   */
  progress?: number
  reducedMotion?: boolean
  /**
   * How much the render is allowed to cost. `auto` (the default) starts in
   * the middle and adapts to whatever the machine turns out to manage — this
   * scene runs on hardware nobody developing it owns. Not part of the stage
   * config: quality describes the DEVICE, not the artwork, so it must never
   * travel in a preset or a shared link.
   */
  quality?: QualityName
  /**
   * Fires when `auto` moves the tier. Useful for showing the viewer what
   * they are getting, and for measuring what real machines settle on.
   */
  onQualityChange?(tier: QualityTier): void
}

export interface PaperStageProps extends PaperStageSceneProps {
  children?: React.ReactNode
  className?: string
  style?: React.CSSProperties
}

/**
 * Split a paragraph across banners, and stack each banner's share DOWN its
 * drop rather than across its width.
 *
 * A banner is roughly six times taller than it is wide, so a line of prose
 * set across it wraps to nothing and leaves the other 90% of the paper
 * blank. Every reference image runs its text as a vertical column, which is
 * both what the shape wants and what makes the paper read as printed rather
 * than as a rectangle with a caption.
 */
export function splitAcrossBanners(text: string, banners: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length === 0 || banners <= 0) return []
  const per = Math.ceil(words.length / banners)
  const out: string[] = []
  for (let i = 0; i < words.length; i += per) out.push(words.slice(i, i + per).join('\n'))
  return out
}

/**
 * Type size for a banner carrying `lines` stacked lines — chosen to FILL the
 * drop, because a column of type that stops a third of the way down reads as
 * a mistake rather than as a design.
 *
 * The banner's texture is 1024px on its long edge and the column is set at
 * 1.25 line-height inside a 6% margin, so `lines × size × 1.25 ≈ 900` is the
 * size that lands the last line at the bottom of the paper. Clamped at both
 * ends: two words on an eight-metre drop should be enormous, but not so
 * enormous they crop, and a dense column still has to stay legible.
 */
export function bannerTextSize(lines: number): number {
  return Math.round(Math.min(150, Math.max(26, 720 / Math.max(lines, 1))))
}

/** The walk drives the camera; nothing else is allowed to move it. */
function ShotRig({
  stage,
  paperHeight,
  progress,
  still,
}: {
  stage: StageConfig
  paperHeight: number
  progress?: number
  still: boolean
}) {
  const camera = useThree((s) => s.camera)
  const path = useMemo(() => getWalkPath(stage.path), [stage.path])
  const scale = useMemo(
    () => ({ figure: stage.figure.height, paper: paperHeight }),
    [stage.figure.height, paperHeight],
  )

  useFrame((state) => {
    const walked = stageWalked(path.length, stage, progress, still ? 0 : state.clock.elapsedTime)
    const { position, target } = stageCamera(path, walked, scale, stage.shot)
    camera.position.set(position[0], position[1], position[2])
    camera.lookAt(target[0], target[1], target[2])
  })
  return null
}

/**
 * Distance walked, from whichever driver is in charge. Shared by the camera
 * and the figure so they cannot drift apart by a frame or a formula.
 */
function stageWalked(
  length: number,
  stage: StageConfig,
  progress: number | undefined,
  elapsed: number,
): number {
  if (progress !== undefined) return progress * length
  return elapsed * stage.figure.speed
}

/** Below this, step down. Above the upper one, step up. */
const FLOOR_FPS = 26
const CEILING_FPS = 55

/**
 * Watches the real frame rate and moves the tier.
 *
 * Deliberately hysteretic and slow: the two thresholds are far apart and
 * there is a settling period after every change, because a monitor that
 * reacts fast oscillates — dropping quality raises the frame rate, which
 * immediately argues for raising quality again, and the scene visibly
 * pumps. A machine that cannot hold the floor should sink once and stay.
 */
function QualityWatch({ tier, onChange }: { tier: QualityTier; onChange: (tier: QualityTier) => void }) {
  const samples = useRef<number[]>([])
  const settle = useRef(SETTLE_FRAMES)
  // The first verdict comes quickly; later ones are measured carefully.
  const window = useRef(FIRST_WINDOW)

  const settled = useCallback((next: QualityTier) => {
    samples.current = []
    settle.current = SETTLE_FRAMES
    window.current = STEADY_WINDOW
    return next
  }, [])

  useFrame((_, delta) => {
    if (settle.current > 0) {
      settle.current -= 1
      return
    }
    // A tab returning from the background delivers one enormous delta;
    // it says nothing about the hardware.
    if (delta > 0.5) return
    samples.current.push(delta)
    if (samples.current.length < window.current) return

    const sorted = [...samples.current].sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)]!
    const fps = 1 / median
    samples.current = []
    // Even if the tier does not move, stop judging on the short window.
    window.current = STEADY_WINDOW

    if (fps < FLOOR_FPS) {
      const next = tierDown(tier)
      if (next !== tier) onChange(settled(next))
    } else if (fps > CEILING_FPS) {
      const next = tierUp(tier)
      if (next !== tier) onChange(settled(next))
    }
  })
  return null
}

export function PaperStageScene({
  stage: stageInput,
  quality = 'auto',
  onQualityChange,
  layout = 'colonnade',
  layoutOptions,
  papers,
  images,
  text,
  preset,
  count = 22,
  progress,
  reducedMotion,
}: PaperStageSceneProps) {
  const still = usePrefersReducedMotion(reducedMotion)
  // `auto` starts mid and is stepped by the frame-rate watcher below.
  const [tier, setTier] = useState<QualityTier>(quality === 'auto' ? INITIAL_TIER : (quality as QualityTier))
  useEffect(() => {
    if (quality !== 'auto') setTier(quality as QualityTier)
  }, [quality])
  useEffect(() => {
    onQualityChange?.(tier)
  }, [tier, onQualityChange])
  const settings = quality === 'auto' ? qualityTiers[tier] : qualityFor(quality)

  const stage = useMemo(() => stageSchema.parse(stageInput ?? {}), [stageInput])
  const path = useMemo(() => getWalkPath(stage.path), [stage.path])
  // The shot frames the ARCHITECTURE, so it has to know how tall the paper
  // is — read from the preset in play rather than assumed.
  const paperHeight = useMemo(() => resolveConfig({ preset: preset ?? BANNER }).sheet.height, [preset])

  // Subdivision is the biggest single cost and the easiest to scale: every
  // sheet is a grid, so halving it quarters the vertex work.
  const paper = useMemo(() => {
    const base = (preset ?? BANNER) as Record<string, unknown>
    if (typeof base !== 'object') return preset ?? BANNER
    const sheet = (base.sheet ?? {}) as Record<string, unknown>
    return { ...base, sheet: { ...sheet, segments: settings.segments } } as typeof BANNER
  }, [preset, settings.segments])

  // The walk reaches the layout too. A layout that arranges along a path and
  // a figure that walks a different one is the one bug this whole component
  // is arranged to make impossible, so the stage's path always wins.
  const resolvedLayoutOptions = useMemo(() => {
    const schema = getLayout(layout).optionsSchema
    const takesPath = schema instanceof z.ZodObject && 'path' in schema.shape
    return takesPath ? { ...layoutOptions, path: stage.path } : layoutOptions
  }, [layout, layoutOptions, stage.path])

  const slots = useMemo<FieldPaperSlot[] | undefined>(() => {
    if (papers) return papers
    if (images) return undefined
    if (text !== undefined) {
      const columns = Array.isArray(text) ? text : splitAcrossBanners(text, count)
      const longest = columns.reduce((n, c) => Math.max(n, c.split('\n').length), 1)
      const size = bannerTextSize(longest)
      return columns.map((column) => ({
        content: {
          type: 'text',
          text: column,
          size,
          align: 'center',
          color: '#241f1a',
          lineHeight: 1.25,
          font: 'Georgia, "Times New Roman", serif',
          weight: 400,
          padding: 0.06,
        } satisfies ContentConfig,
      }))
    }
    return Array.from({ length: count }, () => ({}))
  }, [papers, images, text, count])

  const figureDistance = progress !== undefined ? progress * path.length : undefined

  // One radius for the room: the sky, the floor and the far clip all measure
  // from it, and they have to agree or the horizon tears.
  const surroundRadius = useMemo(
    () => Math.max(path.length * 1.6, paperHeight * 9),
    [path.length, paperHeight],
  )

  // The source stands past the end of the walk, facing back down it.
  const source = useMemo(() => {
    const [x, z] = walkPoint(path, path.length + stage.source.beyond)
    const [tx, tz] = path.tangentAt(1)
    const size = paperHeight * stage.source.spread
    return { position: [x, size * 0.35, z] as const, yaw: Math.atan2(-tx, -tz), size }
  }, [path, stage.source.beyond, stage.source.spread, paperHeight])

  return (
    <>
      <ShotRig stage={stage} paperHeight={paperHeight} progress={progress} still={still} />
      <PaperLighting
        preset={stage.lighting}
        floor={0}
        scale={60}
        reducedMotion={reducedMotion}
        shadowMapSize={settings.shadowMapSize}
        contactShadow={settings.contactShadow}
      />
      {quality === 'auto' && <QualityWatch tier={tier} onChange={setTier} />}

      {stage.source.surround && settings.surround && (
        <Surround radius={surroundRadius} horizon={stage.source.color} zenith={stage.source.zenith} />
      )}

      {stage.source.enabled && (
        <Source size={source.size} position={source.position} yaw={source.yaw} color={stage.source.color} />
      )}

      {stage.ground.enabled && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          {/* A square of side s has corners at s·0.707 — keep them inside the
              surround, or the floor punches out through the sky. */}
          <planeGeometry args={[surroundRadius * 1.3, surroundRadius * 1.3]} />
          <meshStandardMaterial color={stage.ground.color} roughness={1} />
        </mesh>
      )}

      <PaperFieldMesh
        preset={paper}
        papers={slots}
        images={images}
        layout={layout}
        layoutOptions={resolvedLayoutOptions}
        motion={{ driver: 'none' }}
        entrance={{ type: 'none' }}
        reducedMotion={reducedMotion}
      />

      {stage.showFigure && (
        <Figure path={stage.path} figure={stage.figure} distance={figureDistance} frozen={reducedMotion} />
      )}
    </>
  )
}

/** `<PaperStage />` owns its Canvas; `<PaperStageScene />` drops into an existing one. */
export function PaperStage({ children, className, style, ...sceneProps }: PaperStageProps) {
  // Fragment cost scales with the SQUARE of pixel ratio, and this scene is
  // fragment-heavy. The canvas is created once, so the cap is taken from the
  // tier the scene starts at rather than followed live.
  const dpr = qualityFor(sceneProps.quality ?? 'auto').dpr
  return (
    <div className={className} style={{ width: '100%', height: '100%', ...style }}>
      <Canvas
        shadows
        dpr={[1, dpr]}
        camera={{ fov: 38, near: 0.05, far: 400 }}
        onCreated={({ gl, scene }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping
          scene.background = new THREE.Color('#0c0a0b')
        }}
      >
        <PaperStageScene {...sceneProps} />
        {children}
      </Canvas>
    </div>
  )
}
