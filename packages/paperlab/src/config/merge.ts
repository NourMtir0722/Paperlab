/**
 * Deep-merge preset config with prop overrides (overrides win; arrays and
 * discriminated unions replace wholesale, plain objects merge).
 *
 * Lives in its own module (not serialize.ts) because the schema needs it to
 * validate state overrides — schema → serialize would be circular.
 */
export function mergeConfig<T>(base: T, override: unknown): T {
  if (override === undefined) return base
  if (
    base !== null &&
    override !== null &&
    typeof base === 'object' &&
    typeof override === 'object' &&
    !Array.isArray(base) &&
    !Array.isArray(override)
  ) {
    // A content/behavior union with a different `type` replaces wholesale —
    // merging { type: 'text' } over { type: 'image', src } would leak `src`.
    const b = base as Record<string, unknown>
    const o = override as Record<string, unknown>
    if ('type' in b && 'type' in o && b.type !== o.type) return override as T
    const out: Record<string, unknown> = { ...b }
    for (const key of Object.keys(o)) {
      out[key] = mergeConfig(b[key], o[key])
    }
    return out as T
  }
  return override as T
}

/**
 * Like {@link mergeConfig}, but an explicit `undefined` DELETES its key instead
 * of being ignored — the semantics a BASE-config write needs: structural
 * setters can clear `behavior`/`deformers` or toggle a surface effect off.
 * Discriminated unions (differing `type`) still replace wholesale.
 */
export function mergeWithDeletes<T>(base: T, patch: unknown): T {
  if (
    base !== null &&
    patch !== null &&
    typeof base === 'object' &&
    typeof patch === 'object' &&
    !Array.isArray(base) &&
    !Array.isArray(patch)
  ) {
    const b = base as Record<string, unknown>
    const p = patch as Record<string, unknown>
    if ('type' in b && 'type' in p && b.type !== p.type) return patch as T
    const out: Record<string, unknown> = { ...b }
    for (const [key, value] of Object.entries(p)) {
      if (value === undefined) delete out[key]
      else out[key] = mergeWithDeletes(b[key], value)
    }
    return out as T
  }
  return patch as T
}
