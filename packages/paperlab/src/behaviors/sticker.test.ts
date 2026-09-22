import { describe, expect, it } from 'vitest'
import { STICKER_FLY_AT, STICKER_RELEASE_AT, sticker, stickerFront } from './sticker'
import { getDeformer } from '../deformers/registry'
import * as THREE from 'three'

describe('sticker peel', () => {
  const samples = Array.from({ length: 2001 }, (_, i) => i / 2000)

  it('the front never goes backwards and never gets ahead of the pull', () => {
    for (const tack of [0, 0.3, 0.6, 1]) {
      let last = -1
      for (const p of samples) {
        const { front } = stickerFront(p, tack)
        expect(front).toBeGreaterThanOrEqual(last - 1e-9)
        if (p < STICKER_RELEASE_AT) expect(front).toBeLessThanOrEqual(p / STICKER_RELEASE_AT + 1e-9)
        last = front
      }
    }
  })

  it('with tack, the glue holds then lets go — tension rises and drops more than once', () => {
    // A catch is the hold building past most of its strength, then giving.
    let drops = 0
    let holding = false
    for (const p of samples.filter((p) => p < STICKER_RELEASE_AT * 0.78)) {
      const { tension } = stickerFront(p, 0.6)
      if (tension > 0.45) holding = true
      if (holding && tension < 0.1) {
        drops++
        holding = false
      }
    }
    expect(drops).toBeGreaterThanOrEqual(2)
  })

  it('with no tack it peels evenly, with no hold', () => {
    for (const p of samples.filter((p) => p < STICKER_RELEASE_AT)) {
      const { front, tension } = stickerFront(p, 0)
      expect(tension).toBe(0)
      expect(front).toBeCloseTo(p / STICKER_RELEASE_AT, 9)
    }
  })

  it('the last edge clings, and lets go all at once', () => {
    const before = stickerFront(STICKER_RELEASE_AT - 1e-6, 0.6)
    expect(before.front).toBeLessThan(1)
    expect(before.tension).toBeGreaterThan(0.5)
    const after = stickerFront(STICKER_RELEASE_AT, 0.6)
    expect(after.front).toBe(1)
    expect(stickerFront(STICKER_FLY_AT, 0.6).release).toBeCloseTo(1, 6)
  })

  it('once free it flies, and the flight runs 0 to 1 over the last stretch', () => {
    expect(stickerFront(STICKER_FLY_AT - 1e-6, 0.6).fly).toBe(0)
    expect(stickerFront((STICKER_FLY_AT + 1) / 2, 0.6).fly).toBeCloseTo(0.5, 6)
    expect(stickerFront(1, 0.6).fly).toBe(1)
  })

  it('the snap overshoots before it settles', () => {
    const peak = Math.max(
      ...samples.filter((p) => p > STICKER_RELEASE_AT).map((p) => stickerFront(p, 0.6).release),
    )
    expect(peak).toBeGreaterThan(stickerFront(1, 0.6).release - 1e-9)
  })

  const flapLength = (tack: number) => {
    const sheet = { width: 0.6, height: 0.25 }
    const [instance] = sticker.stack({ ...sticker.defaults, progress: 0.5, tack }, sheet)
    const lift = getDeformer(instance!.type)
    const ctx = { t: 0, sheet }
    // Walk a line across the sheet along the peel and measure it deformed.
    const a = (instance!.options.angle as number) * (Math.PI / 180)
    const pts: THREE.Vector3[] = []
    for (let i = 0; i <= 400; i++) {
      const s = -0.3 + (0.6 * i) / 400
      const p = new THREE.Vector3(Math.cos(a) * s * 0.5, Math.sin(a) * s * 0.5, 0)
      lift.displace(p, new THREE.Vector2(), instance!.options, ctx)
      pts.push(p)
    }
    let length = 0
    for (let i = 1; i < pts.length; i++) length += pts[i]!.distanceTo(pts[i - 1]!)
    return length
  }

  it('a peeled flap keeps its length — the lift is a bend, not a stretch', () => {
    expect(flapLength(0)).toBeCloseTo(0.3, 3)
  })

  it('the glue stretches the vinyl at the front, a little', () => {
    const stretched = flapLength(1) / 0.3
    expect(stretched).toBeGreaterThan(1)
    expect(stretched).toBeLessThan(1.08)
  })
})
