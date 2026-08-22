import { useRef } from 'react'

/**
 * Deep-equality memo deps, without serializing anything.
 *
 * Several hooks here need to recompute on the CONTENT of a prop rather than
 * on its identity, because the props in question — the paper slots, a
 * preset, a content list — are rebuilt as fresh objects on every render of
 * whatever is above. The library used to spell that as
 * `[JSON.stringify(papers)]`, which reads well and is a trap: a dependency
 * array is evaluated on **every render**, so the serialization is paid every
 * render whether or not anything changed, and it is paid in garbage rather
 * than in time.
 *
 * That is affordable for a layout's options and ruinous for a paper. An
 * image slot carries its bitmap inline as a data URL, so a field of fourteen
 * photographs serialized roughly seventeen megabytes per render — and the
 * controls that render the most are the continuous ones, which is why
 * dragging a speed slider was the way to take the tab out with an
 * out-of-memory crash.
 *
 * `useStable` compares instead of serializing. Nothing is allocated, and the
 * comparison short-circuits on `Object.is` at every level, so the common
 * case — a fresh wrapper around the same inner objects — costs a handful of
 * pointer checks no matter how large the data URL underneath is.
 */
export function useStable<T>(value: T): T {
  const held = useRef(value)
  if (!deepEqual(held.current, value)) held.current = value
  return held.current
}

/**
 * Structural equality over JSON-shaped data, matching what the
 * `JSON.stringify` comparison it replaces considered equal.
 *
 * That last part is the reason for the `undefined` handling below: stringify
 * drops a key whose value is `undefined`, so `{a: 1, b: undefined}` and
 * `{a: 1}` used to compare equal and must go on doing so — a config that
 * spells an absent option either way should not rebuild the field.
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false
    return true
  }

  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  // Keys carrying `undefined` do not count, on either side — see above.
  const keys = new Set<string>()
  for (const key of Object.keys(left)) if (left[key] !== undefined) keys.add(key)
  for (const key of Object.keys(right)) if (right[key] !== undefined) keys.add(key)
  for (const key of keys) if (!deepEqual(left[key], right[key])) return false
  return true
}
