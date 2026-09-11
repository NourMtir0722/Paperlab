import { describe, expect, it } from 'vitest'
import { BASE_FLOOR, BASE_SHEET, derive, sheetAt, type SheetState } from './derive'
import type { Crease } from './marks'
import type { WashConfig } from 'paperlab'

/**
 * What the library is handed, given what the sheet has had done to it.
 *
 * This is the stage that was impossible to test before it was a function.
 * Every one of these was previously answerable only by starting a browser,
 * shimming a camera, scripting a hand and looking at the result — for a
 * question with an exact answer that never needed a renderer at all.
 *
 * The branch worth the most attention is the shape: three mutually exclusive
 * answers with an order between them, and the order is a design decision
 * rather than an implementation detail.
 */

const rest: SheetState = {
  scale: 1,
  stock: 'printer',
  squeeze: 'none',
  fold: 0,
  peel: null,
  thrown: false,
  wind: 0.25,
  creases: [],
  torn: [],
  ripped: [],
  wash: null,
}

const at = (patch: Partial<SheetState>) => derive({ ...rest, ...patch })
const crease = (offset: number): Crease => ({ angle: 0, offset, depth: 12 })

describe('derive', () => {
  it('hands over a pinned cloth sheet when nothing has happened to it', () => {
    const paper = at({})
    expect(paper.preset).toBe('pinned-sheet')
    expect(paper.physics).toMatchObject({ type: 'cloth', pins: 'top-corners', wind: 0.25 })
    // No shape: a sheet nobody has touched is the simulation and nothing else.
    expect(paper.deformers).toBeUndefined()
    expect(paper.behavior).toBeUndefined()
  })

  it('is cloth whatever else is happening to it', () => {
    // The claim the whole gesture vocabulary rests on. A behavior does not
    // replace the simulation, it runs over it — so there is no state in which
    // `physics` is anything but cloth.
    const states: Partial<SheetState>[] = [
      { squeeze: 'crush' },
      { squeeze: 'fold', creases: [crease(0)] },
      { peel: 'top-right' },
      { thrown: true },
    ]
    for (const state of states) {
      expect(at(state).physics).toMatchObject({ type: 'cloth' })
    }
  })

  it('lets go of the wall when the sheet is thrown, and only then', () => {
    expect(at({}).physics).toMatchObject({ pins: 'top-corners' })
    expect(at({ thrown: true }).physics).toMatchObject({ pins: 'none' })
  })

  it('scales the floor with the sheet, so a big sheet is not in a small room', () => {
    expect(at({ scale: 1 }).physics).toMatchObject({ floor: BASE_FLOOR })
    expect(at({ scale: 2 }).physics).toMatchObject({ floor: BASE_FLOOR * 2 })
    expect(sheetAt(2)).toEqual({ width: BASE_SHEET.width * 2, height: BASE_SHEET.height * 2 })
  })

  describe('the shape running over the simulation', () => {
    it('folds along the lines that were scored, as raw deformers', () => {
      const paper = at({ squeeze: 'fold', fold: 40, creases: [crease(0), crease(0.2)] })
      expect(paper.behavior).toBeUndefined()
      expect(paper.deformers).toHaveLength(2)
      expect(paper.deformers?.[0]).toMatchObject({ type: 'fold' })
    })

    it('alternates the fold direction, so two scores concertina', () => {
      const paper = at({ squeeze: 'fold', fold: 40, creases: [crease(0), crease(0.2)] })
      const angles = paper.deformers?.map((d) => (d.options as { foldAngle: number }).foldAngle)
      // Away from the camera first: swung forward the flap comes at the lens
      // and shows you its back.
      expect(angles).toEqual([-40, 40])
    })

    it('crumples a fist on an unmarked sheet', () => {
      const paper = at({ squeeze: 'crush' })
      expect(paper.behavior).toMatchObject({ type: 'crumple' })
      expect(paper.deformers).toBeUndefined()
    })

    it('crumples a fist even where a line was scored, if the fist is a crush', () => {
      // `squeeze` is the decision, already made upstream by whether the sheet
      // was marked. This stage obeys it rather than second-guessing it.
      expect(at({ squeeze: 'crush', creases: [crease(0)] }).behavior).toMatchObject({
        type: 'crumple',
      })
    })

    it('leaves the sheet alone when a fold has nothing to fold along', () => {
      // A `fold` with no creases would emit an empty deformer list, which is
      // not a shape. It must not win the branch — but it does not fall
      // through to a crumple either, because a fist on a sheet with no line
      // on it was already read as a crush upstream. Reaching here means the
      // creases went away after the fist closed, and the honest answer to
      // that is the simulation on its own.
      const paper = at({ squeeze: 'fold', fold: 40, creases: [] })
      expect(paper.deformers).toBeUndefined()
      expect(paper.behavior).toBeUndefined()
    })

    it('peels the corner a pinch took hold of', () => {
      expect(at({ peel: 'bottom-left' }).behavior).toMatchObject({
        type: 'peel',
        corner: 'bottom-left',
      })
    })

    it('prefers a closed hand to a held corner', () => {
      // A fist is not holding a corner. If both were somehow set, the crush
      // is the one that happened second.
      expect(at({ squeeze: 'crush', peel: 'top-left' }).behavior).toMatchObject({
        type: 'crumple',
      })
    })
  })

  describe('what lives beside the vertices', () => {
    it('keeps the creases as memory, so they compose with the sim', () => {
      const creases = [crease(0.1)]
      expect(at({ creases }).memory).toEqual({ creases })
      // And they survive a crush, unlike anything that owned the vertices.
      expect(at({ creases, squeeze: 'crush' }).memory).toEqual({ creases })
    })

    it('adds a ragged edge only where one was torn off', () => {
      expect(at({}).surface?.deckle).toBeUndefined()
      expect(at({ torn: ['left'] }).surface?.deckle).toMatchObject({ edges: ['left'] })
    })

    it('perforates every edge from the start, because an invisible line is not an affordance', () => {
      expect(at({}).surface?.perforation).toMatchObject({ edges: 'all', state: {} })
    })

    it('marks only the ripped edges as torn', () => {
      expect(at({ ripped: ['top', 'right'] }).surface?.perforation).toMatchObject({
        state: { top: 'torn', right: 'torn' },
      })
    })

    it('carries a wash only once paint has been thrown', () => {
      expect((at({}).content as { wash?: unknown }).wash).toBeUndefined()
      const wash: WashConfig = {
        color: '#c33',
        secondary: '#833',
        blooms: 3,
        spread: 0.4,
        bleed: 0.3,
        intensity: 0.5,
        edge: 0.6,
        granulation: 0.4,
        seed: 7,
      }
      expect((at({ wash }).content as { wash?: unknown }).wash).toEqual(wash)
    })
  })

  it('is a pure function of the state it is given', () => {
    // Nothing here reads a ref, a clock or the DOM — so the same state is the
    // same paper, and a snapshot of one frame means something.
    const state: SheetState = {
      ...rest,
      scale: 1.4,
      squeeze: 'fold',
      fold: 25,
      creases: [crease(0.1)],
      torn: ['left'],
      ripped: ['top'],
      wind: 0.6,
    }
    expect(derive(state)).toEqual(derive({ ...state }))
  })
})
