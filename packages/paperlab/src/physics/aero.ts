/**
 * The shared fake-aerodynamics core: velocity-linked lift +
 * curated noise, per v0.2's "reads more real than a true sim" doctrine.
 * Pure math, no three.js, no allocation in the per-frame paths — `carry`
 * and `flight` both source their motion here.
 */

export interface AeroPose {
  position: [number, number, number]
  rotation: [number, number, number]
}

/**
 * Critically-damped spring toward a target — the carry pin's cursor
 * follow. Mutates `state` in place; returns nothing.
 */
export interface DampedValue {
  value: number
  velocity: number
}

export function dampTo(state: DampedValue, target: number, smoothing: number, dt: number): void {
  // Critically damped: ω from smoothing (≈ time to close 90% of the gap).
  const omega = 2 / Math.max(smoothing, 1e-4)
  const x = omega * dt
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x)
  const change = state.value - target
  const temp = (state.velocity + omega * change) * dt
  state.velocity = (state.velocity - omega * temp) * exp
  state.value = target + (change + temp) * exp
}

/** Coherent gust factor in [1-g, 1+g] — curated, seeded, cheap. */
export function gust(t: number, seed: number, gustiness: number): number {
  const n =
    Math.sin(t * 1.7 + seed * 12.9898) * 0.6 +
    Math.sin(t * 0.53 + seed * 78.233) * 0.3 +
    Math.sin(t * 3.1 + seed * 3.7) * 0.1
  return 1 + n * gustiness
}

export interface FlightParams {
  wind: [number, number, number]
  gustiness: number
  tumble: number
  path: 'drift' | 'loop'
  /** Exit the scene → re-enter the opposite side (drift only). */
  respawn: boolean
  /** Half-extent of the drift travel before respawn wraps it. */
  range: number
}

/**
 * Free paper on the wind: the falling-leaf tumble core + a directional wind
 * vector + lift, so paper travels ACROSS, not just down. A pure function of
 * time and phase — instancing-safe, deterministic, loopable.
 */
export function flightPose(t: number, o: FlightParams, phase: number, pose: AeroPose): void {
  const g = gust(t + phase * 7.3, phase, o.gustiness)
  const time = t + phase * 11.7

  if (o.path === 'loop') {
    // A seamless closed circuit: travel scaled by the wind vector.
    const s = Math.max(0.2, Math.hypot(o.wind[0], o.wind[1], o.wind[2]))
    const a = time * 0.35
    pose.position[0] = Math.sin(a) * o.range * 0.8 * Math.sign(o.wind[0] || 1)
    pose.position[1] = Math.sin(a * 2) * o.range * 0.18 * s
    pose.position[2] = Math.cos(a) * o.range * 0.35
  } else {
    // Drift: travel along the wind; respawn wraps the along-wind coordinate.
    const travel = time * 0.55 * g
    const wrap = (v: number, r: number) => (o.respawn ? ((((v + r) % (2 * r)) + 2 * r) % (2 * r)) - r : v)
    pose.position[0] = wrap(o.wind[0] * travel, o.range)
    pose.position[1] = wrap(o.wind[1] * travel, o.range * 0.6) + Math.sin(time * 1.3) * 0.08 * g
    pose.position[2] = wrap(o.wind[2] * travel, o.range)
  }

  // The falling-leaf tumble: see-saw pitch/roll with a lift bob, gust-scaled.
  pose.rotation[0] = Math.sin(time * 0.5 + 1) * 0.65 * o.tumble
  pose.rotation[1] = Math.sin(time * 0.23) * 0.4 * o.tumble
  pose.rotation[2] = Math.sin(time * 0.7) * 0.55 * o.tumble
  pose.position[1] += Math.sin(time * 1.4) * 0.06 * o.tumble * g
}

/**
 * Carry flutter drive: how much a held paper ripples for a given drag speed
 * (world units/s). Saturates — a violent drag doesn't tear the illusion.
 */
export function carryDrive(speed: number): number {
  return Math.min(1, speed * 0.55)
}
