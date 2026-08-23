import type { PaperConfigInput } from '../config/schema'
import type { StageConfigInput } from './schema'
import { walks } from './walks'

/**
 * Named stages. A mode with no presets asks its visitor to invent a space
 * out of eleven sliders before it will show them anything — and stage mode
 * takes about fifteen seconds to understand once you have seen one, which
 * means the presets ARE the explanation.
 *
 * Each names somewhere paper is actually hung at architectural scale, the
 * same rule the layouts follow.
 */

export interface StagePreset {
  id: string
  label: string
  /** One line, shown under the name. What you are about to look at. */
  description: string
  stage: StageConfigInput
  layout: string
  layoutOptions?: Record<string, unknown>
  /** The paper itself — banners differ per stage more than anything else. */
  paper?: PaperConfigInput
  count: number
  text?: string
}

/** A banner: tall, translucent, folds running the length of its drop. */
const banner = (width: number, height: number, drape: Record<string, unknown> = {}): PaperConfigInput => ({
  sheet: { width, height, segments: 'auto' },
  stock: 'vellum',
  surface: { grain: 0.22 },
  deformers: [
    { type: 'drape', options: { amplitude: 0.16, folds: 3, falloff: 1.7, gather: 0.28, ...drape } },
  ],
})

export const stagePresets: Record<string, StagePreset> = {
  nave: {
    id: 'nave',
    label: 'Nave',
    description: 'A straight aisle of hanging banners, lit from the far end.',
    stage: {
      path: walks.straight,
      shot: { shot: 'follow', distance: 5, lookAhead: 12, offset: 1.5 },
      lighting: 'nave',
    },
    layout: 'colonnade',
    layoutOptions: { aisle: 2.6, twist: 22, drape: 0.6, rise: 0.3 },
    paper: banner(1.5, 8.5),
    count: 18,
    text: 'the paper remembers every hand that folded it and every room it was carried through',
  },
  procession: {
    id: 'procession',
    label: 'Procession',
    description: 'The walk turns twice, so the far end stays hidden until you reach it.',
    stage: {
      path: walks.ess,
      shot: { shot: 'low', distance: 4, lookAhead: 9, offset: 1.1 },
      lighting: 'nave',
      figure: { speed: 1.05 },
    },
    layout: 'colonnade',
    layoutOptions: { aisle: 2.2, twist: 34, breathe: 0.45, drape: 0.7 },
    paper: banner(1.3, 9.5, { folds: 4, amplitude: 0.2 }),
    count: 28,
    text: 'every letter you did not send is still folded somewhere in the dark waiting to be read aloud',
  },
  cloister: {
    id: 'cloister',
    label: 'Cloister',
    description: 'A closed loop. The figure walks it forever and the banners drift past.',
    stage: {
      path: walks.ring,
      shot: { shot: 'follow', distance: 4.5, lookAhead: 8, offset: 1.2 },
      lighting: 'nave',
    },
    layout: 'colonnade',
    layoutOptions: { aisle: 2.4, twist: 18, rise: 0.22 },
    paper: banner(1.6, 7.5),
    count: 24,
    text: 'around and around and the same words come back changed',
  },
  threshold: {
    id: 'threshold',
    label: 'Threshold',
    description: 'A few enormous sheets, wide enough apart to walk between and read.',
    stage: {
      // Its own short walk. A colonnade spreads over the WHOLE path whatever
      // it is populating, so ten banners on the default 36-unit walk stand
      // seven apart and the shot looks down an empty corridor.
      path: {
        points: [
          [0, 9],
          [0, -11],
        ],
        closed: false,
      },
      // The aisle has to stay inside the frustum at the distance the shot
      // stands: paper half a frame-width off the walk line is paper you
      // never see. `lead` fails here for the same reason and worse.
      shot: { shot: 'follow', distance: 6.5, lookAhead: 9, offset: 0.9 },
      lighting: 'nave',
      figure: { speed: 0.85 },
      /**
       * The one room in the set with a COLOUR in it.
       *
       * Every other stage is a warm neutral corridor, and white paper against
       * warm neutral is white paper against nothing — the sheets and the room
       * sit at the same temperature and the picture flattens. Against a
       * saturated ground the paper sings, which is why the installations
       * worth copying are shot in rooms painted terracotta and washed with
       * gels rather than in white boxes.
       *
       * `source.color` is the horizon and `ground.color` the floor of the
       * same three-stop sky that builds the environment map, so the light
       * bouncing onto the sheets is the room's own colour and cannot
       * disagree with the walls the viewer can see.
       */
      source: { spread: 1.1, color: '#ffd7a8', zenith: '#3d1c12' },
      ground: { color: '#6b2f1d' },
    },
    layout: 'colonnade',
    layoutOptions: { aisle: 2.4, twist: 14, breathe: 0.18, margin: 0.12, rise: 0.2 },
    paper: banner(2.6, 10, { folds: 2, amplitude: 0.24, falloff: 2 }),
    count: 10,
    text: 'stand closer and read what it cost to write this down',
  },
  /**
   * The one stage that is not a colonnade of banners.
   *
   * A ribbon reaches the floor and keeps going, and everything built in the
   * last four phases exists so that this reads: a room with a ceiling to
   * hang from, hardware to hang by, type that can be set down a length
   * without looking like a caption, and a `roll` that begins at the floor
   * line rather than at the sheet's centre.
   */
  ribbon: {
    id: 'ribbon',
    label: 'Ribbon',
    description: 'Printed strips falling the full drop of the room, pooling where they land.',
    stage: {
      path: walks.straight,
      // Close. Ribbons are a curtain you part rather than a hall you walk
      // down, so the camera stands nearer and looks less far ahead than any
      // other stage in the set.
      // Lower than the other stages. Pooled paper lies FLAT, so from
      // standing height it foreshortens to a sliver; the shot has to get
      // down toward the floor for the thing this stage is about to read.
      shot: { shot: 'follow', distance: 4.6, height: 2.3, lookAhead: 3.6, offset: 0.34 },
      lighting: 'nave',
      // A low ceiling: the strips ARE the height of the room, so a lid far
      // above them would leave metres of empty air and make the drop read as
      // short. This is the stage the room proportion matters most on.
      room: { height: 1.12 },
      source: { spread: 1.3 },
      suspension: { clips: true },
    },
    layout: 'colonnade',
    // Packed tighter than the banner stages, barely twisted, and hung at a
    // steady height — a rank of strips reads by its rhythm, and jitter that
    // flatters a colonnade of banners just makes this look untidy.
    // `hover` is NEGATIVE by exactly the pool fraction, and that is the whole
    // trick. A colonnade hangs a sheet with its BOTTOM edge on the floor, but
    // a ribbon's crease sits a pool-length above its bottom edge — so at
    // hover 0 the pooled length lies flat in mid-air, parallel to a ground it
    // never touches. Dropping the strip by the same fraction puts the crease
    // on the floor and the pool ON it.
    layoutOptions: {
      aisle: 1.75,
      twist: 5,
      breathe: 0.1,
      margin: 0.06,
      rise: 0.06,
      drape: 0.2,
      hover: -0.22,
    },
    paper: {
      sheet: { width: 1.05, height: 9, segments: 'auto' },
      stock: 'printer',
      surface: { grain: 0.2 },
      behavior: { type: 'ribbon', pool: 0.22, curl: 0.34, drape: 0.6 },
    },
    // Eight, not twelve, and the reason is the type rather than the room.
    // A strip 1.05 wide holds about 105px of measure, which caps the type at
    // 26px, which means a column needs roughly twenty-six words to reach the
    // bottom of a nine-metre drop. Twelve strips wanted three hundred words;
    // eight want two hundred, which is a passage rather than an essay. Fewer
    // and longer is also what the reference installations look like.
    count: 8,
    // Long, because the whole point of this stage is type running the length
    // of the paper. It shipped with twenty words across twelve banners — two
    // words a strip — which set as a caption at the top of nine metres of
    // blank paper. Every word here is kept to seven letters or fewer: the
    // measure is narrow, and one long word shrinks the type on every banner
    // in the room, because a rank of banners is set at one size or it reads
    // as a mistake.
    text:
      'the paper kept going long after the floor ran out from under it and nobody moved to pick it up ' +
      'we let it lie there the way you let a letter lie it had come down from a height no one could name ' +
      'and it held the shape of the fall in its folds someone inked it once and you can still read the ' +
      'last of it where the light gets in a room is only a room until you hang a thing in it then it is ' +
      'a place you walk across slowly the strips move when the door opens and settle again before you ' +
      'reach them paper holds what it was rolled around it holds being flat too and it will go back to ' +
      'flat if you leave it alone long enough but not today today it lies in a curve at the foot of the ' +
      'wall and the curve is the whole point the floor was never meant to hold this much so the paper ' +
      'takes over where the floor gives up it pools the way water would if water could be inked we came ' +
      'to look at the light we stayed for the paper on the ground',
  },
  archive: {
    id: 'archive',
    label: 'Archive',
    description: 'Narrow strips packed tight — a corridor of records you edge through.',
    stage: {
      path: walks.bend,
      // Far enough back that the figure reads as small; a `low` camera
      // three units behind a body is all body.
      shot: { shot: 'low', distance: 8, lookAhead: 13, offset: 0.5 },
      lighting: 'nave',
      ground: { color: '#0b0908' },
      // Its banners are eleven units tall and `spread` is a multiple of that,
      // so the default opening would be fifty units across — a wall, on a
      // walk whose whole point is that it is narrow.
      source: { spread: 1.1 },
    },
    layout: 'colonnade',
    layoutOptions: { aisle: 1.7, twist: 44, breathe: 0.5, drape: 0.75, rise: 0.4 },
    paper: banner(0.85, 11, { folds: 2, amplitude: 0.12 }),
    count: 44,
    text: 'catalogued indexed cross referenced filed and never once opened by anyone at all',
  },
}

export function getStagePreset(id: string): StagePreset {
  const preset = stagePresets[id]
  if (!preset) {
    throw new Error(
      `[paperlab] Unknown stage preset "${id}". Available: ${Object.keys(stagePresets).join(', ')}`,
    )
  }
  return preset
}

export function listStagePresets(): string[] {
  return Object.keys(stagePresets)
}
