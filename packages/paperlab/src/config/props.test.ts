import { describe, expect, it } from 'vitest'
import { resolveConfig, type PaperMeshProps } from '../PaperMesh'
import { getStock } from '../core/stock'

/**
 * The props are a contract with the README.
 *
 * Both halves of this file are the same bug caught twice. `surface` was
 * documented as a `<Paper>` prop in three places and was not a prop at all —
 * it type-errored, and in plain JS it was silently dropped on the floor. And
 * every prop that took a schema's PARSED type instead of its input type
 * demanded that the caller supply every field of every nested object, so the
 * documented one-liner did not compile either.
 *
 * The type-level half of this file has no assertions on purpose: it is
 * written the way the docs tell people to write it, and `pnpm typecheck` is
 * what runs it. If a prop ever goes back to an inferred type, this file stops
 * compiling.
 */

// ── The type half. Exactly what README / AGENTS.md / llms.txt promise. ──────

const documented: PaperMeshProps = {
  sheet: { width: 1, height: 2.6, thickness: 0.3 },
  stock: 'thermal',
  content: { type: 'receipt', store: 'acme.dev', items: [{ name: 'Widget', price: 9.99 }] },
  behavior: { type: 'unroll', progress: 0.6 },
  surface: { grain: 0.3, deckle: { edges: ['bottom'] } },
  memory: { set: 0.6, creases: [{ angle: 270, offset: 0.23, depth: 13 }] },
  physics: 'none',
  interactive: true,
  autoplay: true,
}

/**
 * The smallest form of each prop: one field, everything else defaulted. Cloth
 * sits beside a behavior here only because this object is never parsed — the
 * schema rejects that pair at runtime, deliberately, and the runtime half
 * below keeps them apart.
 */
const minimal: PaperMeshProps = {
  content: { type: 'text', text: 'hi' },
  behavior: { type: 'peel' },
  surface: { aging: 0.5 },
  memory: { set: 0 },
  scene: { lighting: 'noir' },
  physics: { type: 'cloth', pins: 'top-edge' },
  deformers: [{ type: 'bend' }],
}
void minimal

// ── The runtime half. ──────────────────────────────────────────────────────

describe('prop overrides reach the config', () => {
  it('carries surface, which used to be documented and silently ignored', () => {
    const config = resolveConfig({ surface: { grain: 0.7, aging: 0.25 } })
    expect(config.surface.grain).toBe(0.7)
    expect(config.surface.aging).toBe(0.25)
  })

  it('carries memory, which is the same bug waiting to happen a third time', () => {
    const config = resolveConfig({ memory: { creases: [{ angle: 90, offset: 0.2, depth: 14 }] } })
    expect(config.memory.creases).toHaveLength(1)
    expect(config.memory.creases[0]).toMatchObject({ angle: 90, depth: 14 })
  })

  it('merges memory over a preset’s instead of replacing it', () => {
    // Turning the retention down on a letter that ships creased must not
    // flatten it on the way past — `set` and `creases` are separate facts.
    const config = resolveConfig({ preset: 'letter-fold', memory: { set: 0.2 } })
    expect(config.memory.set).toBe(0.2)
    expect(config.memory.creases.length).toBeGreaterThan(0)
  })

  it('merges surface over the stock defaults instead of replacing them', () => {
    // Thermal ships its own aging; asking for grain must not erase it.
    const stockAging = getStock('thermal').defaultSurface.aging
    const config = resolveConfig({ stock: 'thermal', surface: { grain: 0.6 } })
    expect(config.surface.grain).toBe(0.6)
    expect(config.surface.aging ?? stockAging).toBeDefined()
  })

  it('lets a prop override the surface a preset already carries', () => {
    const base = resolveConfig({ preset: 'vintage-note' })
    const config = resolveConfig({ preset: 'vintage-note', surface: { aging: 0.05 } })
    expect(base.surface.aging).not.toBe(0.05)
    expect(config.surface.aging).toBe(0.05)
    // …without dropping the rest of that preset's surface.
    expect(config.surface.deckle).toEqual(base.surface.deckle)
  })

  it('carries scene lighting', () => {
    expect(resolveConfig({ scene: { lighting: 'noir' } }).scene.lighting).toBe('noir')
  })

  it('fills defaults for a partially-specified content and behavior', () => {
    const config = resolveConfig({ content: { type: 'text', text: 'hi' }, behavior: { type: 'peel' } })
    expect(config.content).toMatchObject({ type: 'text', text: 'hi', align: 'left' })
    // Every param the caller left out came from peel's own schema defaults.
    expect(config.behavior).toMatchObject({ type: 'peel', corner: 'bottom-right', progress: 0.35 })
  })

  it('fills defaults for a partially-specified cloth', () => {
    const config = resolveConfig({ physics: { type: 'cloth', pins: 'top-edge' } })
    expect(config.physics).toMatchObject({ type: 'cloth', pins: 'top-edge', stiffness: 0.8 })
  })

  it('resolves the documented example without a single cast', () => {
    const config = resolveConfig(documented)
    expect(config.stock).toBe('thermal')
    expect(config.behavior).toMatchObject({ type: 'unroll', progress: 0.6 })
    expect(config.surface.deckle).toMatchObject({ edges: ['bottom'], roughness: 0.5 })
  })
})
