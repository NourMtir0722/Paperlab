import * as THREE from 'three'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { z } from 'zod'
import { usePrefersReducedMotion } from '../a11y'
import type { ContentConfigInput, PaperConfigInput } from '../config/schema'
import { PaperFieldMesh } from '../PaperField'
import { resolveConfig } from '../PaperMesh'
import type { FieldPaperSlot } from '../field/slots'
import { getLayout } from '../field/layouts'
import { PaperLighting } from '../scene/PaperLighting'
import { resolveLighting } from '../scene/lighting'
import { LightRig } from '../scene/rig'
import { getWalkPath } from './path'
import { stageCamera, walkPoint } from './camera'
import { Figure } from './Figure'
import { Source, Surround } from './Surround'
import { Ceiling, Columns, Doorway, Floor } from './Room'
import { Suspension } from './Suspension'
import { Grade } from './Grade'
import { stageSchema, type StageConfig, type StageConfigInput } from './schema'
import { stageMotionSchema, type StageMotionInput } from './navigate'
import { useWalk } from './useWalk'
import {
  FIRST_WINDOW,
  INITIAL_TIER,
  SETTLE_FRAMES,
  STEADY_WINDOW,
  qualityFor,
  qualityTiers,
  settleTier,
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
   * page scrolls the walk. Omit and `motion` decides who drives.
   *
   * Supplying it makes the stage a CONTROLLED component and outranks
   * `motion` entirely — a driver and a page both writing the same number is
   * a fight, not a feature.
   */
  progress?: number
  /**
   * Who drives the walk when `progress` does not: `drag` hands it to the
   * viewer (pointer, wheel, arrow keys, clicking a paper), `autoplay` to the
   * clock, `none` to nobody. Same contract as a field's `motion`.
   */
  motion?: StageMotionInput
  /** Fires when the viewer moves to a paper — by clicking it, or by stepping onto it. */
  onVisit?(paper: number): void
  /**
   * The live position on the walk, 0..1, every frame it changes — whoever is
   * driving. Mirror it into an uncontrolled input to show a scrubber that
   * follows the walk without re-rendering the scene sixty times a second;
   * `<PaperMesh>`'s `onProgress` is the same affordance for a behavior.
   */
  onProgress?(walk: number): void
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
  // Deal the words out rather than slicing at a fixed stride. `ceil` and a
  // stride left the remainder on the floor: twenty words across twelve
  // banners chunked by two produced TEN columns, and the last two banners
  // hung blank in a stage that had asked for twelve. Dealing gives every
  // banner a share and puts the odd words at the front, where a column one
  // word longer than its neighbour reads as prose rather than as a mistake.
  const each = Math.floor(words.length / banners)
  const extra = words.length % banners
  const out: string[] = []
  let at = 0
  for (let i = 0; i < banners && at < words.length; i++) {
    const take = each + (i < extra ? 1 : 0)
    if (take === 0) break
    out.push(words.slice(at, at + take).join('\n'))
    at += take
  }
  return out
}

/**
 * Set a single word down the drop, one letter to a line.
 *
 * This is what the reference installations do, and it is what the stage was
 * accidentally almost doing. Every built-in stage has FEWER words than
 * banners — a nave of eighteen carries fifteen — so nearly every column is
 * one word, and a one-word column asked for 150px type that no banner is
 * wide enough to hold. `wrapLines` then broke it wherever the measure ran
 * out, which turned "carried" into `ca / rr / ie / d`: vertical, full-drop,
 * and unreadable as a word, because the break points were an accident of
 * arithmetic rather than a decision.
 *
 * Breaking on purpose fixes both halves. One letter a line is legible as
 * vertical setting, and it is the line COUNT that then sizes the type, so a
 * long word gets small letters and a short word gets big ones — which is
 * what makes a rank of banners look set rather than scaled.
 */
export function letterColumn(word: string): string {
  return [...word].join('\n')
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
 *
 * **The drop is only half the constraint, and leaving the other half out was
 * a real bug.** A banner is also NARROW, and the width was never consulted.
 * On the ribbon stage — a 1.05 × 9 strip, so about 105px of measure once the
 * margins are off — a two-word column asked for 150px type, every word came
 * out wider than the sheet, `wrapLines` broke each one to a letter a line,
 * and the column then overran the drop and was silently clipped. The frame
 * showed one enormous letter per strip. So `measure` caps the size at
 * something the longest word can actually sit on.
 *
 * The character estimate is exactly that — an estimate. Real advance widths
 * need a canvas, which is not available where this is decided, so 0.62em is
 * used as a deliberately generous average for a mixed-case serif: erring
 * high makes the type a little small, and erring low brings back the letter
 * a line. `wrapLines` is still the backstop for a word no size can fit.
 */
export function bannerTextSize(lines: number, longestWord = 0, measure = Number.POSITIVE_INFINITY): number {
  const byDrop = 720 / Math.max(lines, 1)
  const byMeasure = longestWord > 0 ? measure / (longestWord * 0.62) : Number.POSITIVE_INFINITY
  // Floor, not round: rounding UP is how a size that was computed to fit
  // stops fitting, and half a pixel of type is worth nobody's attention.
  return Math.floor(Math.min(150, Math.max(26, Math.min(byDrop, byMeasure))))
}

/** The inset the banner column is set inside, on both the sizer and the painter. */
const PADDING = 0.06

/**
 * The usable width of a banner's texture, in the units `content.size` is in.
 *
 * Both numbers here are facts about how content is painted, not choices:
 * the canvas is `LONG_EDGE` on its long side, and `paintText` insets by
 * `padding` of the SHORT side. Stated once so the type sizer and the painter
 * cannot drift apart about how much room there is.
 */
export function bannerMeasure(sheet: { width: number; height: number }, padding = PADDING): number {
  const long = Math.max(sheet.width, sheet.height)
  if (!(long > 0)) return Number.POSITIVE_INFINITY
  return (sheet.width / long) * 1024 * (1 - padding * 2)
}

/**
 * The walk drives the camera; nothing else is allowed to move it.
 *
 * Including the viewer. Dragging moves you ALONG the walk — it does not orbit
 * and it does not look around, because a camera the viewer can aim is a
 * camera that can be aimed at the back of the room, and this mode is a
 * composed shot rather than a scene you inspect.
 */
function ShotRig({
  stage,
  paperHeight,
  walk,
}: {
  stage: StageConfig
  paperHeight: number
  /** Normalized position on the walk, live — the scene's one clock. */
  walk: React.RefObject<number>
}) {
  const camera = useThree((s) => s.camera)
  const path = useMemo(() => getWalkPath(stage.path), [stage.path])
  const scale = useMemo(
    () => ({ figure: stage.figure.height, paper: paperHeight }),
    [stage.figure.height, paperHeight],
  )

  useFrame(() => {
    const { position, target } = stageCamera(path, walk.current * path.length, scale, stage.shot)
    camera.position.set(position[0], position[1], position[2])
    camera.lookAt(target[0], target[1], target[2])
  })
  return null
}

/**
 * Watches the real frame rate and moves the tier.
 *
 * Deliberately hysteretic and slow: the two thresholds are far apart and
 * there is a settling period after every change, because a monitor that
 * reacts fast oscillates — dropping quality raises the frame rate, which
 * immediately argues for raising quality again, and the scene visibly
 * pumps. A machine that cannot hold the floor should sink once and stay.
 *
 * "And stay" is now enforced rather than hoped for. **A tier that has
 * already failed is never offered again**, because the thresholds alone
 * cannot prevent the pump: promotion needs 55 fps and demotion needs 26, so
 * any machine where the next tier up costs more than about 2.1× the current
 * one can satisfy both forever, rising until it stalls and sinking until it
 * is comfortable. That ratio is not hypothetical — `high` runs 2.1× the cost
 * of `medium` on a software rasterizer, which is exactly the machine this
 * watcher exists for. One latch, and the ladder can only ever settle.
 */
function QualityWatch({ tier, onChange }: { tier: QualityTier; onChange: (tier: QualityTier) => void }) {
  const samples = useRef<number[]>([])
  const settle = useRef(SETTLE_FRAMES)
  // The first verdict comes quickly; later ones are measured carefully.
  const window = useRef(FIRST_WINDOW)
  /** The lowest tier that has already proved too expensive here. */
  const failed = useRef<QualityTier | null>(null)

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

    const verdict = settleTier(tier, fps, failed.current)
    failed.current = verdict.failed
    if (verdict.tier !== tier) onChange(settled(verdict.tier))
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
  motion,
  onVisit,
  onProgress,
  reducedMotion,
}: PaperStageSceneProps) {
  const still = usePrefersReducedMotion(reducedMotion)
  // `auto` starts mid and is stepped by the frame-rate watcher below.
  const [tier, setTier] = useState<QualityTier>(quality === 'auto' ? INITIAL_TIER : (quality as QualityTier))
  useEffect(() => {
    if (quality !== 'auto') setTier(quality as QualityTier)
  }, [quality])
  /**
   * Report the tier when the TIER moves — never because the consumer
   * re-rendered.
   *
   * Held in a ref rather than named as a dependency, because the natural way
   * to write this prop is an inline arrow, and an inline arrow is a new
   * function on every render of the page above. Depending on it turned a
   * notification into a pump: report → consumer stores the tier → consumer
   * re-renders → new callback identity → report again, forever. The editor
   * spent every frame in stage mode servicing that loop, which is what made
   * the whole app feel frozen the moment you touched anything.
   */
  const reportQuality = useRef(onQualityChange)
  useEffect(() => {
    reportQuality.current = onQualityChange
  })
  useEffect(() => {
    reportQuality.current?.(tier)
  }, [tier])
  const settings = quality === 'auto' ? qualityTiers[tier] : qualityFor(quality)

  const stage = useMemo(() => stageSchema.parse(stageInput ?? {}), [stageInput])
  const path = useMemo(() => getWalkPath(stage.path), [stage.path])

  /**
   * The rig, resolved ONCE and handed to everything that has to agree with
   * it — the lamps, the environment, the cyclorama, and the transmission
   * through every banner. The room's own colours override the preset's,
   * because in this mode the sky is not a backdrop the light happens to sit
   * in front of: it IS the light, so a stage whose source is warm cannot
   * have a cold room.
   */
  const rig = useMemo(() => {
    const resolved = resolveLighting(stage.lighting, stage.light)
    return {
      ...resolved,
      sky: { zenith: stage.source.zenith, horizon: stage.source.color, ground: stage.ground.color },
    }
  }, [stage.lighting, stage.light, stage.source.zenith, stage.source.color, stage.ground.color])
  // The shot frames the ARCHITECTURE, so it has to know how tall the paper
  // is — read from the preset in play rather than assumed.
  // Both dimensions, resolved once. The suspension needs the width to size a
  // clip off the sheet rather than in world units — a clip that is 4cm
  // whatever it is clipped to looks like a clip on exactly one sheet size.
  const sheetDims = useMemo(() => {
    const { width, height } = resolveConfig({ preset: preset ?? BANNER }).sheet
    return { width, height }
  }, [preset])
  const paperHeight = sheetDims.height
  const paperWidth = sheetDims.width

  const paper = preset ?? BANNER

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
      const split = Array.isArray(text) ? text : splitAcrossBanners(text, count)
      // A whole-rank decision, not a per-banner one: if there is at most one
      // word for every banner, the stage is set vertically. Mixing the two
      // would put one banner's letters next to another's words at a single
      // shared size, and one of the two would always be wrong.
      const vertical = split.every((c) => !c.includes('\n'))
      const columns = vertical ? split.map(letterColumn) : split
      const longest = columns.reduce((n, c) => Math.max(n, c.split('\n').length), 1)
      // The longest WORD, not the longest line: lines are already one word
      // each, and it is the word that has to fit across the strip.
      const longestWord = columns.reduce(
        (n, c) => c.split('\n').reduce((m, w) => Math.max(m, w.length), n),
        1,
      )
      const size = bannerTextSize(longest, longestWord, bannerMeasure(sheetDims, PADDING))
      return columns.map((column) => ({
        content: {
          type: 'text',
          text: column,
          size,
          align: 'center',
          // Centred down the drop as well as across it. One size is shared
          // by the whole rank — that is what makes it read as set rather
          // than scaled — so a short word necessarily leaves slack, and the
          // slack belongs at both ends. Hung from the top instead, "the"
          // reads as a caption that ran out while "remembers" fills its
          // banner, and the rank looks broken rather than composed.
          valign: 'center',
          color: '#241f1a',
          lineHeight: 1.25,
          font: 'Georgia, "Times New Roman", serif',
          weight: 400,
          padding: PADDING,
        } satisfies ContentConfigInput,
      }))
    }
    return Array.from({ length: count }, () => ({}))
    // `sheetDims` belongs here: the type size is capped by how wide the
    // banner is, so a preset that changes the sheet has to re-set the type.
  }, [papers, images, text, count, sheetDims])

  const drive = stageMotionSchema.parse(motion ?? {})

  /**
   * Where the papers stand along the walk, so stepping lands ON them.
   *
   * Only a layout that arranges along a path can answer; anything else gets
   * an even spread, which is still somewhere to stop and is better than an
   * arrow key that does nothing.
   */
  const slotCount = slots?.length ?? images?.length ?? count
  const stops = useMemo(() => {
    const spec = getLayout(layout)
    // Parsed, not passed raw: `walkStops` reads options the caller may never
    // have named, and an undefined margin puts every stop at NaN.
    const placed = spec.walkStops?.(slotCount, spec.optionsSchema.parse(resolvedLayoutOptions ?? {}))
    if (placed && placed.length > 0) return placed
    return Array.from({ length: slotCount }, (_, i) => (slotCount > 1 ? i / (slotCount - 1) : 0.5))
  }, [layout, resolvedLayoutOptions, slotCount])

  const walk = useWalk({
    path,
    motion: drive,
    progress,
    figureSpeed: stage.figure.speed,
    stops,
    reduced: still,
    onProgress,
  })

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
    <LightRig rig={rig}>
      <ShotRig stage={stage} paperHeight={paperHeight} walk={walk.walk} />
      <PaperLighting
        rig={rig}
        floor={0}
        scale={60}
        reducedMotion={reducedMotion}
        shadowMapSize={settings.shadowMapSize}
        contactShadow={settings.contactShadow}
        environment={settings.environment}
      />
      {quality === 'auto' && <QualityWatch tier={tier} onChange={setTier} />}

      {stage.source.surround && settings.surround && <Surround radius={surroundRadius} sky={rig.sky} />}

      {stage.source.enabled && (
        <Source size={source.size} position={source.position} yaw={source.yaw} color={rig.sky.horizon} />
      )}

      {/* A square of side s has corners at s·0.707 — keep them inside the
          surround, or the floor punches out through the sky. */}
      {stage.ground.enabled && (
        <Floor size={surroundRadius * 1.3} color={stage.ground.color} slab={stage.ground.slab} />
      )}

      {/* The wall the source shines through. Before the floor's own draw is
          irrelevant, but before the banners matters: it is the far surface
          they are seen against. */}
      {stage.room.enabled && stage.room.doorway.enabled && stage.source.enabled && (
        <Doorway
          position={source.position}
          yaw={source.yaw}
          size={source.size}
          opening={stage.room.doorway.opening}
          color={stage.room.doorway.color}
          extent={surroundRadius * 0.9}
        />
      )}

      {/* Columns. The scale cue that is not a person — see stageColumnsSchema. */}
      {stage.room.enabled && stage.room.columns.enabled && (
        <Columns
          path={path}
          ceiling={paperHeight * stage.room.height}
          spacing={stage.room.columns.spacing}
          width={stage.room.columns.width}
          offset={stage.room.columns.offset}
          color={stage.room.columns.color}
        />
      )}

      {/* Hardware. Drawn before the lid so it is inside the room, and it
          anchors at the ceiling whether or not the ceiling is drawn — a
          thread that stops in mid-air is worse than no thread. */}
      {stage.suspension.type !== 'none' && (
        <Suspension
          layout={layout}
          layoutOptions={resolvedLayoutOptions ?? {}}
          // The slot list IS the population — same number the field draws, so
          // threads and banners cannot disagree about how many there are.
          count={slots?.length ?? count}
          sheet={{ width: paperWidth, height: paperHeight }}
          paperHeight={paperHeight}
          ceiling={paperHeight * stage.room.height}
          color={stage.suspension.color}
          type={stage.suspension.type}
          hardware={stage.suspension.hardware}
        />
      )}

      {/* The lid. It gives the haze a far surface to settle on — fog against
          an open sky has none, which is why the top of frame used to grade to
          nothing — and it puts a plane above the walk for the source to spill
          onto, which is how every reference installation reads as interior. */}
      {stage.room.enabled && (
        <Ceiling
          size={surroundRadius * 1.3}
          height={paperHeight * stage.room.height}
          color={stage.room.color}
        />
      )}

      <PaperFieldMesh
        preset={paper}
        // Subdivision is the biggest single cost in this scene and the tier's
        // one geometry lever. It is a CEILING on what `'auto'` may ask for,
        // not a replacement for it — overwriting `segments` with a number was
        // this component's own bug: a number applies to BOTH axes, and a
        // deformer's floor then raised it straight back, so every tier drew
        // the identical 48 × 48 banner and the knob did nothing at all.
        segmentCeiling={settings.segments}
        papers={slots}
        images={images}
        layout={layout}
        layoutOptions={resolvedLayoutOptions}
        // The field never drives itself here: the WALK is the motion, and a
        // field turning under a camera that is also travelling is two
        // animations of the same thing disagreeing.
        motion={{ driver: 'none' }}
        entrance={{ type: 'none' }}
        reducedMotion={reducedMotion}
        onSelect={
          drive.driver === 'drag' && progress === undefined
            ? (paperIndex) => {
                // A drag that happens to end over a banner is not a click on it.
                if (walk.dragged.current) return
                walk.travelTo(stops[paperIndex] ?? 0)
                onVisit?.(paperIndex)
              }
            : undefined
        }
      />

      {stage.showFigure && (
        <Figure
          path={stage.path}
          figure={stage.figure}
          // The same ref the camera reads. The figure and the shot are the
          // two things that must never disagree about where along the walk
          // we are, so they are given one number rather than two formulas.
          distanceRef={walk.walk}
          walkLength={path.length}
          frozen={reducedMotion}
        />
      )}

      {/*
        Last, and outside everything else, because it is not part of the
        scene — it is what happens to the frame after the scene is drawn.
        `settings.grade` is the tier's switch: the bottom tier skips the
        whole composer rather than running it cheaply.
      */}
      {settings.grade && <Grade grade={stage.grade} film={rig.film} />}
    </LightRig>
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
        onCreated={({ scene }) => {
          // Tone mapping is NOT set here. It is part of the lighting rig —
          // `light.film`, resolved with everything else — so that a stage
          // and a lone <Paper> under the same preset are printed on the same
          // film. Pinning it on the canvas meant stage mode silently
          // overrode whatever the rig asked for.
          scene.background = new THREE.Color('#0c0a0b')
        }}
      >
        <PaperStageScene {...sceneProps} />
        {children}
      </Canvas>
    </div>
  )
}
