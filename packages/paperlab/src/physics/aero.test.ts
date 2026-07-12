import { describe, expect, it } from 'vitest'
import { carryDrive, dampTo, flightPose, gust, type AeroPose, type FlightParams } from './aero'

const freshPose = (): AeroPose => ({ position: [0, 0, 0], rotation: [0, 0, 0] })

const drift: FlightParams = {
  wind: [0.6, 0.08, 0],
  gustiness: 0.4,
  tumble: 0.6,
  path: 'drift',
  respawn: true,
  range: 3.5,
}

describe('aero core', () => {
  it('dampTo converges to the target without overshoot blow-up', () => {
    const state = { value: 0, velocity: 0 }
    for (let i = 0; i < 240; i++) dampTo(state, 1, 0.09, 1 / 60)
    expect(state.value).toBeCloseTo(1, 3)
    expect(Math.abs(state.velocity)).toBeLessThan(0.01)
  })

  it('dampTo is stable under jittery timesteps', () => {
    const state = { value: 0, velocity: 0 }
    for (let i = 0; i < 200; i++) dampTo(state, 2, 0.09, i % 2 === 0 ? 1 / 120 : 1 / 24)
    expect(state.value).toBeCloseTo(2, 2)
  })

  it('gust stays within [1-g, 1+g] and is deterministic', () => {
    for (const t of [0, 0.5, 1.7, 9.3]) {
      const g = gust(t, 0.37, 0.4)
      expect(g).toBeGreaterThanOrEqual(0.6 - 1e-9)
      expect(g).toBeLessThanOrEqual(1.4 + 1e-9)
      expect(gust(t, 0.37, 0.4)).toBe(g)
    }
  })

  it('flightPose is a pure function of time — instancing-safe', () => {
    const a = freshPose()
    const b = freshPose()
    flightPose(2.34, drift, 0.5, a)
    flightPose(2.34, drift, 0.5, b)
    expect(a).toEqual(b)
  })

  it('drift travels across the scene along the wind', () => {
    const early = freshPose()
    const later = freshPose()
    flightPose(0.5, { ...drift, respawn: false, gustiness: 0 }, 0, early)
    flightPose(2.5, { ...drift, respawn: false, gustiness: 0 }, 0, later)
    expect(later.position[0]).toBeGreaterThan(early.position[0])
  })

  it('respawn wraps the drift back within range (exit → re-enter opposite side)', () => {
    const pose = freshPose()
    // Far enough that unwrapped travel would exceed the range many times.
    flightPose(100, drift, 0, pose)
    expect(Math.abs(pose.position[0])).toBeLessThanOrEqual(drift.range + 0.3)
  })

  it('loop path is a seamless closed cycle', () => {
    const loop: FlightParams = { ...drift, path: 'loop', gustiness: 0 }
    const period = (Math.PI * 2) / 0.35
    const at0 = freshPose()
    const at1 = freshPose()
    flightPose(1, loop, 0, at0)
    flightPose(1 + period, loop, 0, at1)
    expect(at1.position[0]).toBeCloseTo(at0.position[0], 4)
    expect(at1.position[2]).toBeCloseTo(at0.position[2], 4)
  })

  it('tumble 0 keeps the paper level', () => {
    const pose = freshPose()
    flightPose(3.7, { ...drift, tumble: 0 }, 0, pose)
    expect(pose.rotation).toEqual([0, 0, 0])
  })

  it('carryDrive saturates — violent drags cap at 1', () => {
    expect(carryDrive(0)).toBe(0)
    expect(carryDrive(0.5)).toBeCloseTo(0.275)
    expect(carryDrive(50)).toBe(1)
  })
})
