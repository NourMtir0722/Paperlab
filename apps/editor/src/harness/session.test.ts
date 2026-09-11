import { describe, expect, it, vi } from 'vitest'
import { Session } from './session'
import type { Crease } from './marks'

/**
 * The store exists to remove a class of bug rather than to add a feature, so
 * what it owes is the two guarantees the forty ref/setState pairs could not
 * give: a change reaches React exactly once, and a non-change reaches it not
 * at all.
 *
 * The second is the load-bearing one. `wind` is recomputed from the breath
 * every single frame and is almost always the same number; a store that
 * invalidated on every write would re-render the tree that owns the canvas
 * sixty times a second to draw an identical sheet — which is precisely the
 * cost the refs were introduced to avoid, reintroduced by the thing that
 * replaced them.
 */

const make = () => new Session({ stockIndex: 2, wind: 0.25 })
const crease = (offset: number): Crease => ({ angle: 0, offset, depth: 12 })

describe('the session store', () => {
  it('starts as a whole, untouched sheet', () => {
    const s = make()
    expect(s.sheet('printer')).toMatchObject({
      scale: 1,
      squeeze: 'none',
      thrown: false,
      creases: [],
      torn: [],
      ripped: [],
      wash: null,
    })
  })

  it('tells React once when something it renders changes', () => {
    const s = make()
    const listener = vi.fn()
    s.subscribe(listener)

    s.set('squeeze', 'crush')
    expect(listener).toHaveBeenCalledTimes(1)
    expect(s.squeeze).toBe('crush')
  })

  it('says nothing when the value is the one already there', () => {
    // The whole point. `wind` is written every frame from the breath and is
    // usually unchanged; a re-render per frame for an identical sheet is the
    // cost this store exists to remove.
    const s = make()
    const listener = vi.fn()
    s.subscribe(listener)

    for (let i = 0; i < 60; i++) s.set('wind', 0.25)
    expect(listener).not.toHaveBeenCalled()
    expect(s.version()).toBe(0)

    s.set('wind', 0.3)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('treats a replaced array as a change and a re-read as none', () => {
    // Every collection here is replaced rather than mutated, which is what
    // makes identity the right comparison — and what would silently break if
    // anything ever started pushing into one in place.
    const s = make()
    const listener = vi.fn()
    s.subscribe(listener)

    const creases = [crease(0.1)]
    s.set('creases', creases)
    s.set('creases', creases)
    expect(listener).toHaveBeenCalledTimes(1)

    s.set('creases', [...creases])
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('leaves frame-loop state out of React entirely', () => {
    // A behavior's progress goes through `ref.set()` on the mesh, not through
    // a render — so writing it must not invalidate anything.
    const s = make()
    const listener = vi.fn()
    s.subscribe(listener)

    s.crush = 0.7
    s.heldSheet = true
    s.ripGap = 1.2
    s.washSeed += 17
    expect(listener).not.toHaveBeenCalled()
  })

  it('stops telling a listener that has gone away', () => {
    const s = make()
    const listener = vi.fn()
    const unsubscribe = s.subscribe(listener)
    unsubscribe()
    s.set('squeeze', 'crush')
    expect(listener).not.toHaveBeenCalled()
  })

  it('hands derive a snapshot with the stock resolved', () => {
    const s = make()
    s.set('scale', 1.5)
    s.set('torn', ['left'])
    const sheet = s.sheet('newsprint')
    expect(sheet.stock).toBe('newsprint')
    expect(sheet.scale).toBe(1.5)
    expect(sheet.torn).toEqual(['left'])
  })

  it('gives a fresh sheet back, undoing what happened to it as well as how it is held', () => {
    const s = make()
    s.set('squeeze', 'crush')
    s.set('thrown', true)
    s.set('scale', 2)
    s.set('creases', [crease(0.2)])
    s.set('torn', ['top'])
    s.set('ripped', ['left'])
    s.crush = 0.9
    s.heldSheet = true

    const listener = vi.fn()
    s.subscribe(listener)
    s.reset()

    expect(listener).toHaveBeenCalledTimes(1)
    expect(s.sheet('printer')).toMatchObject({
      squeeze: 'none',
      thrown: false,
      scale: 1,
      creases: [],
      torn: [],
      ripped: [],
      wash: null,
    })
    expect(s.crush).toBe(0)
    expect(s.heldSheet).toBe(false)
  })

  it('keeps the stock a fresh sheet was on, because that is not damage', () => {
    // The dial is not something a hand did TO the paper — it is what the
    // paper is made of, and the button says fresh sheet, not fresh dial.
    const s = make()
    s.set('stockIndex', 5)
    s.reset()
    expect(s.stockIndex).toBe(5)
  })

  it('moves the version forward every time, so React never misses one', () => {
    const s = make()
    const seen = new Set<number>()
    seen.add(s.version())
    s.set('squeeze', 'crush')
    seen.add(s.version())
    s.set('fold', 20)
    seen.add(s.version())
    s.reset()
    seen.add(s.version())
    expect(seen.size).toBe(4)
  })
})
