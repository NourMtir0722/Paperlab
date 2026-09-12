import { describe, expect, it } from 'vitest'
import { BLOW_OUT, MATCH_DWELL_MS, MATCH_STILL, Match } from './match'

/**
 * A match is a pinch, and so is a grab, and so is the start of a flick. Every
 * test here is about telling those three apart — which is the only hard part
 * of adding a gesture to a vocabulary that ran out of poses.
 */

const ASPECT = 4 / 3
const PALM = 0.2

const held = (over: Partial<Parameters<Match['push']>[0]> = {}) => ({
  pinching: true,
  onPaper: false,
  at: { x: 0.6, y: 0.2 },
  palm: PALM,
  blow: 0,
  now: 0,
  aspect: ASPECT,
  ...over,
})

/** Hold a pinch still for `ms`, one frame every 16. */
function dwell(match: Match, ms: number, over: Partial<Parameters<Match['push']>[0]> = {}) {
  let state = match.push(held({ now: 0, ...over }))
  for (let now = 16; now <= ms; now += 16) state = match.push(held({ now, ...over }))
  return state
}

describe('the match', () => {
  it('lights when a pinch is held still in free air', () => {
    const match = new Match()
    expect(dwell(match, MATCH_DWELL_MS + 32)).toBe('lit')
    expect(match.lit).toBe(true)
  })

  it('is not lit before the dwell is up', () => {
    // The frame before: a flick that happened to be slow is still not a match.
    const match = new Match()
    expect(dwell(match, MATCH_DWELL_MS - 48)).toBe('arming')
    expect(match.lit).toBe(false)
  })

  it('is never summoned by a flick', () => {
    // The case the dwell exists for. A flick IS a pinch, briefly — without
    // this, every snap of the fingers lights a match on its way past.
    const match = new Match()
    for (let i = 0; i <= 4; i++) {
      match.push(held({ at: { x: 0.65 - i * 0.04, y: 0.17 }, now: i * 20 }))
    }
    expect(match.lit).toBe(false)
    // And the pinch opening leaves nothing behind.
    expect(match.push(held({ pinching: false, now: 100 }))).toBe('none')
  })

  it('will not light on a pinch that is moving, however long it is held', () => {
    const match = new Match()
    let state: string = 'none'
    for (let now = 0; now <= 2000; now += 16) {
      // Drifting past the allowance every frame: the clock restarts each time.
      const x = 0.6 + ((now / 16) % 2 === 0 ? MATCH_STILL * PALM * 2 : 0)
      state = match.push(held({ at: { x, y: 0.2 }, now }))
    }
    expect(state).toBe('arming')
  })

  it('tolerates the drift of a hand that is trying to hold still', () => {
    const match = new Match()
    let state: string = 'none'
    for (let now = 0; now <= MATCH_DWELL_MS + 64; now += 16) {
      state = match.push(held({ at: { x: 0.6 + Math.sin(now) * 0.002, y: 0.2 }, now }))
    }
    expect(state).toBe('lit')
  })

  it('never lights on the paper — that pinch is a grab', () => {
    const match = new Match()
    expect(dwell(match, 1000, { onPaper: true })).toBe('none')
  })

  it('never lights on a pinch that has ALREADY held the paper, however long it is held after', () => {
    // The regression, and it failed on CI rather than here. Tearing an edge is
    // a pinch that starts on the paper and pulls away from it: within a few
    // frames the hand is over empty space and holding as still as any match.
    // On a slow machine those frames outlast the dwell, so the match lit in
    // the middle of the pull and the flame took the pointer away from the
    // grab — the tear could not finish, and the frame rate decided whether a
    // gesture worked at all.
    const match = new Match()
    for (let now = 0; now < 60; now += 16) match.push(held({ onPaper: true, now }))
    // Now off the sheet, dragging slowly — a whole second of it.
    let state: string = 'none'
    for (let now = 64; now < 1200; now += 100) {
      state = match.push(held({ onPaper: false, at: { x: 0.6 - now / 20_000, y: 0.2 }, now }))
    }
    expect(state).toBe('none')
    // Only opening the hand ends the grab, and then a match is available again.
    match.push(held({ pinching: false, now: 1300 }))
    expect(dwell(match, MATCH_DWELL_MS + 32)).toBe('lit')
  })

  it('stays lit when it is carried over the paper, which is what lighting it is for', () => {
    const match = new Match()
    expect(dwell(match, MATCH_DWELL_MS + 32)).toBe('lit')
    for (let now = 400; now < 900; now += 16) match.push(held({ onPaper: true, now }))
    expect(match.lit).toBe(true)
  })

  it('goes out when the hand opens', () => {
    const match = new Match()
    dwell(match, MATCH_DWELL_MS + 32)
    expect(match.push(held({ pinching: false, now: 400 }))).toBe('none')
  })

  it('is blown out, and does not relight while the pinch is still held', () => {
    // Blowing a flame out has to MEAN something, so it cannot come back the
    // instant the blowing stops with the hand unchanged.
    const match = new Match()
    dwell(match, MATCH_DWELL_MS + 32)
    expect(match.push(held({ blow: BLOW_OUT, now: 400 }))).toBe('none')
    let state: string = 'none'
    for (let now = 420; now < 2000; now += 16) state = match.push(held({ now }))
    expect(state).toBe('none')
    // Let go, and a fresh pinch lights a fresh match.
    match.push(held({ pinching: false, now: 2000 }))
    expect(dwell(match, MATCH_DWELL_MS + 32, {})).toBe('lit')
  })

  it('can be lit, and blown out, by a face whose breath never reads zero', () => {
    // What the level-only rule cost: `mouthPucker` does not rest at zero for
    // everybody — lighting, a beard, the shape of a mouth all move it — so a
    // viewer whose rest sat above the old threshold had every match blown out
    // on the frame it lit, and nothing on screen said why. A RISE can tell
    // blowing from a face that always reads high; a level cannot.
    const match = new Match()
    expect(dwell(match, MATCH_DWELL_MS + 32, { blow: 0.6 })).toBe('lit')
    expect(match.push(held({ blow: 0.6, now: 420 }))).toBe('lit')
    expect(match.push(held({ blow: 0.85, now: 440 }))).toBe('none')
  })

  it('is not put out by a breath too light to matter', () => {
    const match = new Match()
    dwell(match, MATCH_DWELL_MS + 32)
    expect(match.push(held({ blow: BLOW_OUT * 0.5, now: 400 }))).toBe('lit')
  })

  it('goes out when there is no hand at all', () => {
    const match = new Match()
    dwell(match, MATCH_DWELL_MS + 32)
    expect(match.push(held({ at: null, now: 400 }))).toBe('none')
  })

  it('starts over on demand', () => {
    const match = new Match()
    dwell(match, MATCH_DWELL_MS + 32)
    match.reset()
    expect(match.lit).toBe(false)
  })
})
