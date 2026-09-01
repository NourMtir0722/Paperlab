import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { composeSurface } from './compose'
import { getStock } from '../core/stock'
import { surfaceSchema } from '../config/schema'
import { fold } from '../deformers/fold'
import { CREASE_RADIUS } from '../deformers/memory'
import { letterFold } from '../behaviors/letter-fold'
import { receiptTotals, barcodeBars } from '../content/receipt'
import { receiptContentSchema } from '../config/schema'

const printer = getStock('printer')

describe('composeSurface', () => {
  it('composes only the enabled effects into one program', () => {
    const surface = surfaceSchema.parse({ grain: 0.4, aging: 0.2 })
    const out = composeSurface(surface, getStock('photo-gloss'), 0.2)
    expect(out.structureKey).toBe('ga:')
    expect(out.fragmentShader).toContain('plGrain')
    expect(out.fragmentShader).toContain('plAging')
    expect(out.fragmentShader).not.toContain('plDeckle')
    expect(out.alphaTest).toBe(0)
    expect(out.uniforms.uGrainAmount!.value).toBe(0.4)
  })

  it('deckle enables alphaTest discard (not blending) and edge flags', () => {
    const surface = surfaceSchema.parse({ deckle: { edges: ['bottom', 'left'] } })
    const out = composeSurface(surface, getStock('photo-gloss'), 0.2)
    expect(out.alphaTest).toBe(0.5)
    const edges = out.uniforms.uDeckleEdges!.value as THREE.Vector4
    expect([edges.x, edges.y, edges.z, edges.w]).toEqual([0, 0, 1, 1])
  })

  it('stocks contribute default surface effects; explicit config overrides', () => {
    const thermal = composeSurface(surfaceSchema.parse({}), getStock('thermal'), 0.2)
    expect(thermal.uniforms.uGrainBanding!.value).toBeCloseTo(0.35)
    expect(thermal.uniforms.uAgingAmount!.value).toBeCloseTo(0.1)
    const overridden = composeSurface(surfaceSchema.parse({ aging: 0.9 }), getStock('thermal'), 0.2)
    expect(overridden.uniforms.uAgingAmount!.value).toBe(0.9)
  })

  it('underside darkening scales with thickness', () => {
    const thin = composeSurface(surfaceSchema.parse({}), printer, 0)
    const thick = composeSurface(surfaceSchema.parse({}), printer, 0.5)
    expect(thick.uniforms.uBackDarken!.value as number).toBeLessThan(
      thin.uniforms.uBackDarken!.value as number,
    )
  })

  it('backside branch: stock base + reversed show-through ghost, never the mirrored front', () => {
    const out = composeSurface(surfaceSchema.parse({}), getStock('thermal'), 0.2, {
      hasFrontMap: true,
      hasBackMap: false,
    })
    expect(out.structureKey).toBe('ga:F')
    expect(out.fragmentShader).toContain('gl_FrontFacing')
    expect(out.fragmentShader).toContain('texture2D(uFrontMap, vPaperUv)')
    expect(out.fragmentShader).toContain('mix(vec3(1.0), front, uShowThrough)')
    expect(out.uniforms.uShowThrough!.value).toBeCloseTo(0.06) // thermal stock default
    expect(out.uniforms.uFrontMap).toBeDefined()
    expect(out.uniforms.uBackMap).toBeUndefined()
  })

  it('content.back samples mirrored in x so it reads right when flipped', () => {
    const out = composeSurface(surfaceSchema.parse({}), printer, 0.2, {
      hasFrontMap: true,
      hasBackMap: true,
    })
    expect(out.structureKey).toBe('g:FB')
    expect(out.fragmentShader).toContain('texture2D(uBackMap, vec2(1.0 - vPaperUv.x, vPaperUv.y))')
  })

  it('showThrough: stock defaults, surface override wins, vellum is translucent-high', () => {
    const printerOut = composeSurface(surfaceSchema.parse({}), printer, 0.2)
    expect(printerOut.uniforms.uShowThrough!.value).toBe(0)
    const overridden = composeSurface(surfaceSchema.parse({ showThrough: 0.4 }), printer, 0.2)
    expect(overridden.uniforms.uShowThrough!.value).toBe(0.4)
    const vellum = composeSurface(surfaceSchema.parse({}), getStock('vellum'), 0.2)
    expect(vellum.uniforms.uShowThrough!.value).toBeGreaterThanOrEqual(0.5)
    expect(vellum.uniforms.uOpacity!.value).toBeLessThan(1)
  })

  it('perforation punches via alphaTest with world-unit holes; torn edges flip per edge', () => {
    const surface = surfaceSchema.parse({
      perforation: { edges: 'all', holeRadius: 0.014, spacing: 0.05, state: { right: 'torn' } },
    })
    const out = composeSurface(surface, getStock('sticker'), 0.08, undefined, {
      width: 0.64,
      height: 0.78,
    })
    expect(out.alphaTest).toBe(0.5)
    expect(out.fragmentShader).toContain('plPerforation')
    expect(out.structureKey).toContain('p')
    const edges = out.uniforms.uPerfEdges!.value as THREE.Vector4
    expect([edges.x, edges.y, edges.z, edges.w]).toEqual([1, 1, 1, 1])
    const torn = out.uniforms.uPerfTorn!.value as THREE.Vector4
    expect([torn.x, torn.y, torn.z, torn.w]).toEqual([0, 1, 0, 0]) // top,right,bottom,left
    expect(out.uniforms.uPerfRadius!.value).toBe(0.014)
    const size = out.uniforms.uSheetSize!.value as THREE.Vector2
    expect([size.x, size.y]).toEqual([0.64, 0.78])
  })

  it('perforation and deckle coexist on one paper', () => {
    const surface = surfaceSchema.parse({
      deckle: { edges: ['bottom'] },
      perforation: { edges: ['top'] },
    })
    const out = composeSurface(surface, printer, 0.2)
    expect(out.fragmentShader).toContain('plDeckle')
    expect(out.fragmentShader).toContain('plPerforation')
  })

  it('adhesive underside: glossy near-white back, show-through forced off, no back darkening', () => {
    const sticker = getStock('sticker')
    expect(sticker.adhesive).toBe(true)
    const out = composeSurface(surfaceSchema.parse({ showThrough: 0.4 }), sticker, 0.2, {
      hasFrontMap: true,
      hasBackMap: false,
    })
    expect(out.uniforms.uShowThrough!.value).toBe(0) // adhesive wins over the override
    expect(out.uniforms.uBackDarken!.value).toBe(1)
    expect(out.fragmentShader).toContain('csm_Roughness = 0.18')
    expect(out.structureKey).toContain('A')
    // Non-adhesive stocks are unchanged.
    const plain = composeSurface(surfaceSchema.parse({}), printer, 0.2)
    expect(plain.structureKey).not.toContain('A')
  })

  it('pads crease offsets to the fixed uniform array size', () => {
    const surface = surfaceSchema.parse({ creaseLines: { positions: [0.5] } })
    const out = composeSurface(surface, printer, 0.2)
    // Centred, so the offset is zero; the loop stops at uCreaseCount, so what
    // the padding holds is only ever a matter of not shipping NaN.
    expect(out.uniforms.uCreaseOffsets!.value).toEqual([0, 0, 0, 0])
    expect(out.uniforms.uCreaseCount!.value).toBe(1)
  })

  it('sizes the shaded crease off the hinge the geometry bends over', () => {
    // The two used to be unrelated numbers — a UV width in the shader against
    // a world radius in the deformer — which agreed at one sheet size and
    // drifted at every other.
    const surface = surfaceSchema.parse({ creaseLines: { positions: [0.5] } })
    const out = composeSurface(surface, printer, 0.2)
    const width = out.uniforms.uCreaseWidth!.value as number
    expect(width).toBeGreaterThan(0)
    expect(width).toBeLessThan(CREASE_RADIUS)
  })

  it('lights the relief instead of painting it', () => {
    // A crease that only tints the albedo looks the same from every angle. The
    // effects describe a height now and the standard material lights it.
    const surface = surfaceSchema.parse({ creaseLines: { positions: [0.5] } })
    const out = composeSurface(surface, printer, 0.2)
    expect(out.fragmentShader).toContain('csm_FragNormal = plPerturb')
    // And a sheet with neither grain nor a crease does not pay for a
    // perturbation with nothing in it — vellum has no tooth to describe.
    const plain = composeSurface(
      surfaceSchema.parse({}),
      getStock('vellum'),
      0.2,
      undefined,
      undefined,
      'studio',
      [],
    )
    expect(plain.fragmentShader).not.toContain('csm_FragNormal = plPerturb')
  })

  it('measures every effect in the sheet’s own space', () => {
    // Not UV: UV divides the sheet's aspect out, so fibre stretches, a tear
    // bites unevenly, and all of it changes when the sheet is resized.
    const out = composeSurface(surfaceSchema.parse({ grain: 0.4 }), printer, 0.2, undefined, {
      width: 2,
      height: 0.5,
    })
    const size = out.uniforms.uSheetSize!.value as THREE.Vector2
    expect(size.x).toBe(2)
    expect(size.y).toBe(0.5)
    expect(out.fragmentShader).toContain('plLocal()')
  })
})

describe('fold deformer', () => {
  const ctx = { t: 0, sheet: { width: 1, height: 1.4 } }
  const uv = new THREE.Vector2(0.5, 0.5)
  const apply = (p: [number, number, number], o: Parameters<typeof fold.displace>[2]) => {
    const out = new THREE.Vector3(...p)
    fold.displace(out, uv, o, ctx)
    return out
  }
  const o = { angle: 90, offset: 0, foldAngle: 90, radius: 0.1 }

  it('leaves the near side of the crease untouched', () => {
    expect(apply([0.2, -0.3, 0], o).toArray()).toEqual([0.2, -0.3, 0])
  })

  it('is continuous across the hinge boundary', () => {
    const inside = apply([0, 0.1 - 1e-6, 0], o)
    const outside = apply([0, 0.1 + 1e-6, 0], o)
    expect(inside.distanceTo(outside)).toBeLessThan(1e-4)
  })

  it('a 90° fold sends the flap straight up', () => {
    // Past the hinge, the flap points along +z: d stays at the arc end.
    const a = apply([0, 0.3, 0], o)
    const b = apply([0, 0.5, 0], o)
    expect(b.y).toBeCloseTo(a.y, 6)
    expect(b.z - a.z).toBeCloseTo(0.2, 6)
  })

  it('a 180° fold lays the flap back over the sheet', () => {
    const flat = { ...o, foldAngle: 180 }
    const p = apply([0, 0.4, 0], flat)
    // Height = full hinge diameter, travelling back toward -y.
    expect(p.z).toBeCloseTo((2 * 0.1) / Math.PI, 6)
    expect(p.y).toBeLessThan(0.1)
  })

  it('negative angles fold the other way', () => {
    const down = apply([0, 0.4, 0], { ...o, foldAngle: -90 })
    expect(down.z).toBeLessThan(0)
  })
})

describe('letter-fold behavior', () => {
  it('bottom flap leads, top follows', () => {
    const sheet = { width: 1, height: 1.4 }
    const early = letterFold.stack({ progress: 0.15, crease: 0.3 }, sheet)
    expect((early[0]!.options as { foldAngle: number }).foldAngle).toBeGreaterThan(0)
    expect((early[1]!.options as { foldAngle: number }).foldAngle).toBe(0)
    const flat = letterFold.stack({ progress: 0, crease: 0.3 }, sheet)
    for (const instance of flat) {
      expect((instance.options as { foldAngle: number }).foldAngle).toBe(0)
    }
  })
})

describe('receipt content', () => {
  it('computes totals from items and tax rate', () => {
    const content = receiptContentSchema.parse({ type: 'receipt' })
    const totals = receiptTotals(content)
    expect(totals.subtotal).toBeCloseTo(21.49)
    expect(totals.tax).toBeCloseTo(21.49 * 0.08)
    expect(totals.total).toBeCloseTo(21.49 * 1.08)
  })

  it('barcode is deterministic per store and guarded', () => {
    const a = barcodeBars('nawwara.studio')
    const b = barcodeBars('nawwara.studio')
    const c = barcodeBars('other.store')
    expect(a).toEqual(b)
    expect(a).not.toEqual(c)
    expect(a.slice(0, 4)).toEqual([2, 1, 1, 4])
    expect(a.slice(-6)).toEqual([2, 3, 3, 1, 1, 2])
    for (const width of a) expect(width).toBeGreaterThanOrEqual(1)
  })
})
