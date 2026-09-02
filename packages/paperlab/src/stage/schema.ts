import { z } from 'zod'
import { lightingNames } from '../config/schema'
import { lightSchema } from '../scene/lighting'
import { walkPathSchema } from './path'
import { shotSchema } from './camera'
import { figureSchema } from './gait'

/**
 * A stage serializes like everything else here: one object that fully
 * describes the walk, who walks it, where the camera stands, and how the
 * space is lit. Same rule as the paper schema — a feature that can't
 * serialize into this waits.
 */

export const stageSourceSchema = z.object({
  /** The bright void the walk resolves toward. Without it the vanishing point is a hole. */
  enabled: z.boolean().default(true),
  color: z.string().default('#fff4e2').describe('color'),
  /** How far past the end of the walk it stands, world units. */
  beyond: z.number().min(0).max(80).default(10),
  /**
   * A cyclorama around the whole stage, graded from the source colour at the
   * horizon to near-dark overhead. The source plane only faces down the walk,
   * so without this every shot that isn't axial — `wide` especially — looks
   * out at a black void where the room should be.
   */
  surround: z.boolean().default(true),
  /** Colour overhead. The horizon takes the source's own colour. */
  zenith: z.string().default('#241c17'),
  /**
   * Size, as a multiple of the PAPER height.
   *
   * It is an OPENING, not a wall. At 5 the plane was 100 units across and
   * filled the entire frame behind the colonnade, so the hall had no dark
   * end to resolve toward and the whole picture sat at one value. Sized to
   * roughly the height of the paper it stands behind, it reads as the way
   * out — which is what the figure is walking toward.
   */
  spread: z.number().min(0.2).max(60).default(2),
})

export const stageGroundSchema = z.object({
  /** The floor. Without something to catch the shadows there is no ground and no scale. */
  enabled: z.boolean().default(true),
  /**
   * Lifted off near-black (`#0e0b09`). A floor dark enough to disappear
   * cannot show its own seams, and the seams are the scale cue — the hall
   * kept its contrast against the source and gained a surface you can read
   * the size of the room from.
   */
  color: z.string().default('#241e19').describe('color'),
  /**
   * Width of one poured slab, in world units. 0 leaves the floor unseamed.
   *
   * The cheapest scale cue there is, and the one this scene most lacked. A
   * concrete floor is poured in bays of roughly two and a half metres, and a
   * viewer knows that without being told — so a floor with seams in it
   * states the size of the room, while a floor without them is a gradient
   * that happens to be horizontal.
   */
  slab: z.number().min(0).max(20).default(2.4),
})

/**
 * The room the walk is in.
 *
 * Stage mode was a void with a horizon: a graded dome, a flat plane, and a
 * bright rectangle at the end, none of it a knowable size. That is why the
 * walking figure was carrying the whole scale burden by itself — and why
 * simply removing the figure would have left an abstraction rather than a
 * hall. Architecture is the better answer: objects whose size the viewer
 * already knows, made of flat surfaces under good light, which is the one
 * thing a renderer never gets wrong.
 */
/**
 * What holds the paper up.
 *
 * Every paper installation shows its hardware — monofilament from a ceiling
 * grid, steel wire, bulldog clips, a rod — and in the scattered-sheet pieces
 * the threads are half the composition. Stage mode's banners hung from
 * nothing at all, which is a bigger realism gap than any shader in the
 * backlog and closes for a few thin lines of geometry.
 */
export const stageSuspensionSchema = z.object({
  /**
   * What carries the load.
   *
   * `thread` is monofilament to the ceiling — one straight line per sheet.
   * `rod` is a dowel across each sheet's top edge, hung from the ceiling at
   * both ends, which is a different image entirely: a rank on threads reads
   * as sheets floating in a row, and a rank on rods reads as sheets that
   * were HUNG, by someone, on something. `none` is for a stage where the
   * paper is meant to be impossible.
   */
  type: z.enum(['none', 'thread', 'rod']).default('thread'),
  color: z.string().default('#9c948a').describe('color'),
  /**
   * What grips the sheet.
   *
   * A clip is wide and shallow — the bulldog clip of a gallery. A peg is
   * narrow and deep, and grips DOWN the face of the sheet rather than
   * across its edge: the domestic one, a line of paper on a washing line.
   * They are told apart by silhouette at any distance, which is the only
   * thing that survives being one instanced box at the top of an
   * eight-metre banner.
   *
   * This replaced a `clips: boolean`. Two of the four pieces of hardware the
   * plan named — pegs, and a rod — had no way to be asked for, and a boolean
   * cannot grow a third answer.
   */
  hardware: z.enum(['none', 'clip', 'peg']).default('clip'),
})

/**
 * Columns down the walk — the scale cue that is not a person.
 *
 * Retiring the walking figure rested on the argument that **architecture is
 * a better scale cue than a human mesh, and it is the thing renderers never
 * fail at**. A ceiling and floor seams carried that alone, and they are both
 * boundaries: they tell you where the room stops, not how big it is. A
 * column STANDS in the room. It has a knowable width, it is a known distance
 * from the next one, and its base plate meets the floor at a height your eye
 * already knows — which is exactly the reading a figure was there to give.
 *
 * Off by default: a colonnade of columns is a strong compositional claim,
 * and a stage that did not ask for one should not grow one.
 */
export const stageColumnsSchema = z.object({
  enabled: z.boolean().default(false),
  /** Centres this far apart along the walk. Roughly a bay. */
  spacing: z.number().min(1).max(24).default(7),
  /** Shaft width. The number doing the work — a column is a known size. */
  width: z.number().min(0.1).max(3).default(0.44),
  /**
   * How far off the walk's centreline each rank stands.
   *
   * Outside the banners, always. Columns are the room; the paper is the
   * subject, and a column standing between the viewer and a banner has
   * swapped the two over. Default clears a `colonnade`'s widest sensible
   * aisle with room to spare.
   */
  offset: z.number().min(0.5).max(24).default(6.6),
  /**
   * Stone, and darker than paper on purpose.
   *
   * The brightest thing in any of these frames has to be the light, and the
   * second brightest has to be the paper. A column the same value as a
   * banner does not read as architecture behind the subject; it reads as
   * more banners, and the eye stops being able to tell what the room is made
   * of from what is hanging in it.
   */
  color: z.string().default('#5c554d').describe('color'),
})

/**
 * The end wall, with the source shining through an opening in it.
 *
 * Without it the source is a bright rectangle hanging in a void: it reads as
 * light, but not as light coming from anywhere. A wall around it turns the
 * same rectangle into a doorway — and gives the room the two things it had
 * no way to show, a surface at the end of the walk and a corner where that
 * surface meets the floor and the ceiling.
 *
 * Off by default for the same reason as the columns, and because it changes
 * what the brightest part of every frame is standing in.
 */
export const stageDoorwaySchema = z.object({
  enabled: z.boolean().default(false),
  /** Opening size, as a multiple of the source's own. 1 frames it exactly. */
  opening: z.number().min(0.2).max(3).default(1.05),
  color: z.string().default('#171310').describe('color'),
})

export const stageRoomSchema = z.object({
  enabled: z.boolean().default(true),
  /**
   * Ceiling height, as a multiple of the paper's own height.
   *
   * Relative rather than absolute because the banners ARE the architecture
   * here: a hall whose ceiling sits just above its hangings reads as built
   * for them, and one at a fixed world height reads as whatever the paper
   * happened to be scaled to that day.
   */
  height: z.number().min(1).max(6).default(2.2),
  color: z.string().default('#171310').describe('color'),
  /** Columns flanking the walk — see `stageColumnsSchema`. */
  columns: stageColumnsSchema.prefault({}),
  /** A wall at the end of the walk with the source in it. */
  doorway: stageDoorwaySchema.prefault({}),
})

/**
 * The print: what happens to the frame after the scene is drawn.
 *
 * This lives on the stage rather than on the lighting rig, even though it
 * belongs to the same family as `exposure` and `film`, because the rig is
 * read by `<Paper>` too and `<Paper>` has no composer. A grade in the rig
 * would be a promise one of the two modes could not keep.
 *
 * Every value defaults to a real look rather than to zero — a stage that
 * asks for nothing should still be graded, and `grade: { bloom: 0 }` is how
 * you say you want it raw.
 */
export const stageGradeSchema = z.object({
  /**
   * How far light bleeds past what is emitting it.
   *
   * This is the one that matters most in a backlit hall, because the source
   * plane is drawn with `toneMapped: false` — it is light, not an object, so
   * no tone curve ever rolls it off. Bloom is the only thing that gives it
   * an edge that behaves like light instead of like a lit rectangle.
   */
  bloom: z.number().min(0).max(3).default(0.45),
  /**
   * How bright a pixel has to be before it blooms at all, in LINEAR light.
   *
   * Above 1.0 is not only legal, it is the useful range — and that is the
   * whole reason the bound is 4 rather than 1. Bloom reads the scene before
   * the tone curve, while values are still unbounded, so "1.0" means "as
   * bright as white" rather than "as bright as the brightest pixel on
   * screen". Lit near-white paper sits close to 1.0 all by itself; the
   * source burns at `SOURCE_INTENSITY`, several times that. A threshold
   * under 1 therefore blooms the PAPER, which fogs the hall and costs the
   * sheets their edges — the exact failure this default is set to avoid.
   */
  threshold: z.number().min(0).max(4).default(1.6),
  /**
   * Depth falloff — how much the near and far ends of the walk go soft.
   *
   * **Defaults to 0, and that is a considered default rather than a stub.**
   * Depth in this scene is already staged by haze, which is how a real hall
   * does it and which costs one fragment instruction; optical blur is a
   * second full-screen pass with a circle-of-confusion buffer behind it, and
   * it is the effect most likely to read as a video game rather than as a
   * photograph. Every paper installation worth copying is shot deep — an
   * f/11 room where the sheets at the far end are as sharp as the ones you
   * can touch.
   *
   * It is here because a shallow frame is a legitimate look and the schema
   * is the only place a look is allowed to live. Turn it up for a close shot
   * on one banner; leave it alone for a hall.
   */
  depth: z.number().min(0).max(1).default(0),
  /** How far the corners fall off. A frame with no edge reads as a viewport rather than a photograph. */
  vignette: z.number().min(0).max(1).default(0.34),
  /**
   * Film grain.
   *
   * Worth more here than in most scenes: grain is the one texture shared
   * between the render and the thing being rendered. Keep it under ~0.05 —
   * past that it stops reading as stock and starts reading as noise.
   */
  grain: z.number().min(0).max(0.5).default(0.022),
})

export const stageSchema = z.object({
  path: walkPathSchema.prefault({}),
  shot: shotSchema.prefault({}),
  figure: figureSchema.prefault({}),
  /** Stage mode is built for `nave`; the others are all front-lit. */
  lighting: z.enum(lightingNames).default('nave'),
  /**
   * The light, by hand: exposure, key, direction, height, ambient, studio,
   * haze. Overrides on `lighting` rather than a replacement for it, so a
   * shared stage carries the sliders that were moved and nothing else.
   */
  light: lightSchema.default({}),
  /**
   * OFF by default now.
   *
   * The figure existed to say "this is a room at gallery scale", which is a
   * real job and the right instinct. A rendered human is simply the most
   * expensive and least reliable way to do it: it is the one thing in frame
   * every viewer appraises, and a low-polygon one reads as an asset-store
   * placeholder no matter how good the hall around it is.
   *
   * `stageRoomSchema` does the job instead, with objects whose size the
   * viewer already knows. And the deciding argument is that the stage is
   * NAVIGABLE — drag, wheel, arrow-step, click-to-approach — so there is
   * already a person in the hall and it is the viewer. A second one walking
   * the same aisle on its own clock competes for that role.
   *
   * Still one flag away for anyone who wants it.
   */
  showFigure: z.boolean().default(false),
  source: stageSourceSchema.prefault({}),
  ground: stageGroundSchema.prefault({}),
  /** Ceiling and the architecture around the walk — see `stageRoomSchema`. */
  room: stageRoomSchema.prefault({}),
  /** Thread and clips — see `stageSuspensionSchema`. */
  suspension: stageSuspensionSchema.prefault({}),
  /**
   * The print — bloom, vignette, grain.
   *
   * Needs `@react-three/postprocessing` and `postprocessing`. They are
   * declared OPTIONAL peers, which means `<Paper>` never pulls them in and a
   * bundle that only imports `<Paper>` never contains them — not that a
   * stage renders without them. A bundler asked to resolve `<PaperStage>`
   * without them installed fails at build time, and that is the intended
   * behaviour: a stage silently losing its grade would be worse than a
   * missing-module error that names the package.
   */
  grade: stageGradeSchema.prefault({}),
})

export type StageConfig = z.infer<typeof stageSchema>
export type StageConfigInput = z.input<typeof stageSchema>
export type StageGradeConfig = z.infer<typeof stageGradeSchema>
