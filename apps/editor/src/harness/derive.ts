import type { PaperEdge, PaperMeshProps, StockName, WashConfig } from 'paperlab'
import { foldAlong } from './marks'
import type { Crease, PaperCorner } from './marks'

/**
 * What a closed hand is doing to the sheet.
 *
 * A fist means two different things and the sheet decides which: with a line
 * scored on it a fist folds along that line, and with nothing scored it
 * crumples. The single tidiest join in this harness, and it lives here
 * because it is a fact about the paper rather than about the hand.
 */
export type Squeeze = 'none' | 'fold' | 'crush'

/**
 * The props this stage owns.
 *
 * Named as a subset of `PaperMeshProps` rather than as its own shape, so that
 * a prop renamed in the library fails here at compile time instead of being
 * silently ignored at runtime.
 */
export type PaperShape = Pick<
  PaperMeshProps,
  'preset' | 'sheet' | 'stock' | 'content' | 'memory' | 'surface' | 'physics' | 'deformers' | 'behavior'
>

/**
 * The last stage of the frame pipeline: what the paper IS, turned into what
 * `<Paper>` is told.
 *
 * Pure, and that is the whole point of it existing. This used to be eighty
 * lines of conditional JSX in the middle of a 1,200-line component, which
 * meant the one question you most want to ask of a gesture — "given that the
 * sheet is in THIS state, what does the library get?" — could only be
 * answered by running a browser, a camera shim and a cloth simulation. Here
 * it is a function call, and every branch of it has a test.
 *
 * It is deliberately the FULL config rather than a patch. A patch would make
 * "what is the paper right now" a question about the diff and its base, and
 * the answer has to be one object you can print.
 */

/** Everything about the sheet that a gesture can change. */
export interface SheetState {
  /** Multiple of the preset's own size. Two open palms set this. */
  scale: number
  stock: StockName
  /** What a closed hand is doing to the sheet. */
  squeeze: Squeeze
  /** Degrees the scored lines are folded to. Only read while folding. */
  fold: number
  /** The corner a pinch took hold of, if it landed on one. */
  peel: PaperCorner | null
  /** Off its pins, thrown by a flick. */
  thrown: boolean
  /** Live `cloth.wind`, which a blow drives. */
  wind: number
  /** Lines a fingertip scored. The sheet keeps them. */
  creases: Crease[]
  /** Edges yanked off, as ragged `surface.deckle`. */
  torn: PaperEdge[]
  /** Edges ripped along their perforation, two-handed. */
  ripped: PaperEdge[]
  /** The most recent flick of paint, if there has been one. */
  wash: WashConfig | null
}

/** The sheet the `pinned-sheet` preset defines, at rest. */
export const BASE_SHEET = { width: 1.2, height: 1.5 }

/**
 * The ground, in proportion to the sheet.
 *
 * A fixed floor is a floor at a fixed height, so a sheet twice the size hangs
 * through it and piles up on it. Scaling it with the sheet keeps the drop
 * proportional, which is what makes a big sheet read as a big sheet rather
 * than as a sheet in a smaller room. It is a live cloth parameter, so this
 * costs no rebuild.
 */
export const BASE_FLOOR = -1.4

export function sheetAt(scale: number): { width: number; height: number } {
  return { width: BASE_SHEET.width * scale, height: BASE_SHEET.height * scale }
}

export const PROMPT = 'Pinch to hold.\nPoint to score.\nFlick to paint.'

/**
 * The shape running over the simulation, if any.
 *
 * Three mutually exclusive answers and an order between them, which is the
 * part worth having in one place: a fold beats a crush because a scored sheet
 * folds along what you scored, a crush beats a peel because a closed hand is
 * not holding a corner, and a peel is what is left.
 *
 * Folds are RAW DEFORMERS rather than a behavior because they are aimed at
 * lines the sheet is already carrying — `creaseFromDrag` produced each
 * `{ angle, offset }` when a fingertip scored it, and `fold` takes the
 * identical pair. A behavior would have to invent its own line.
 */
function shape(state: SheetState): Pick<PaperShape, 'deformers' | 'behavior'> {
  if (state.squeeze === 'fold' && state.creases.length > 0) {
    return {
      deformers: state.creases.map((crease, index) => ({
        type: 'fold' as const,
        options: {
          // Named so each flap is the smaller side — see `foldAlong`.
          ...foldAlong(crease),
          // Alternating, so two scored lines concertina instead of rolling
          // the same way twice — which is what a hand does to paper and what
          // makes a second fold legible as one. Negative first because the
          // flap should fold AWAY from the camera: swung forward it comes at
          // the lens and shows you its back.
          foldAngle: index % 2 === 0 ? -state.fold : state.fold,
          radius: 0.05,
        },
      })),
    }
  }
  if (state.squeeze === 'crush') return { behavior: { type: 'crumple', progress: 0 } }
  if (state.peel) {
    return { behavior: { type: 'peel', corner: state.peel, progress: 0, radius: 0.2 } }
  }
  return {}
}

/** Edges ripped along their perforation, in the shape `surface` wants. */
function perforationState(ripped: PaperEdge[]): Partial<Record<PaperEdge, 'torn'>> {
  const out: Partial<Record<PaperEdge, 'torn'>> = {}
  for (const edge of ripped) out[edge] = 'torn'
  return out
}

/** What the library is handed this frame. */
export function derive(state: SheetState): PaperShape {
  return {
    preset: 'pinned-sheet',
    // Two hands set this. A rebuild is invisible on a shape — a deformer is a
    // pure function of its options — and on cloth the drape survives it,
    // because `ClothSim.adopt` carries the particles over.
    sheet: sheetAt(state.scale),
    stock: state.stock,
    content: {
      type: 'text',
      text: PROMPT,
      size: 40,
      ...(state.wash ? { wash: state.wash } : {}),
    },
    // Creases and surface effects live BESIDE the vertices rather than owning
    // them, so unlike a behavior they compose with the sim.
    memory: { creases: state.creases },
    surface: {
      ...(state.torn.length ? { deckle: { edges: state.torn, roughness: 0.6 } } : {}),
      // Perforated from the start, because a dotted line you cannot see is
      // not an affordance. The defaults are tuned to a postage stamp, and at
      // this sheet's size they scallop the edges like one — fine holes read
      // as a tear line, coarse ones read as a stamp.
      perforation: {
        edges: 'all',
        holeRadius: 0.007,
        spacing: 0.026,
        state: perforationState(state.ripped),
      },
    },
    // Cloth, always — it is never swapped out for a shape, it HOSTS one. The
    // sheet stays grabbable through a fold and a crush.
    //
    // `pins` is the one thing a gesture takes AWAY: flick the sheet while you
    // are holding it and it lets go of the wall. The rebuild that costs is
    // free of consequence — `ClothSim.adopt` carries the drape and the
    // velocity across it, so the sheet leaves at the speed your hand gave it
    // instead of dropping from a standstill.
    physics: {
      type: 'cloth',
      pins: state.thrown ? 'none' : 'top-corners',
      wind: state.wind,
      stiffness: 0.75,
      floor: BASE_FLOOR * state.scale,
    },
    ...shape(state),
  }
}
