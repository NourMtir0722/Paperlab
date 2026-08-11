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
      source: { spread: 4 },
    },
    layout: 'colonnade',
    layoutOptions: { aisle: 2.4, twist: 14, breathe: 0.18, margin: 0.12, rise: 0.2 },
    paper: banner(2.6, 10, { folds: 2, amplitude: 0.24, falloff: 2 }),
    count: 10,
    text: 'stand closer and read what it cost to write this down',
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
