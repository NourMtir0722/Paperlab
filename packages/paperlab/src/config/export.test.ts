import { describe, expect, it } from 'vitest'
import { paperConfigSchema } from './schema'
import { diffConfig, buildJsxSnippet } from './diff'
import { buildAgentPayload, describeConfig, AGENT_PAYLOAD_VERSION } from './agent-payload'
import { getPreset, listPresets } from './presets'
import { listBehaviors } from '../behaviors/registry'
import { quantizeProgress, quantizeTime } from '../motion/onTwos'

describe('diffConfig', () => {
  it('an all-default config diffs to nothing', () => {
    expect(diffConfig(paperConfigSchema.parse({}))).toEqual({})
  })

  it('emits only non-default values', () => {
    const config = paperConfigSchema.parse({
      stock: 'thermal',
      sheet: { width: 1, height: 2.6 },
      behavior: { type: 'unroll', progress: 0.5, tightness: 0.8 },
    })
    const diff = diffConfig(config) as Record<string, unknown>
    expect(diff.stock).toBe('thermal')
    expect(diff.sheet).toEqual({ height: 2.6 }) // width 1 is the default
    // progress 0.5 IS the unroll default → only tightness survives.
    expect(diff.behavior).toEqual({ type: 'unroll', tightness: 0.8 })
    expect(diff).not.toHaveProperty('physics')
    expect(diff).not.toHaveProperty('onTwos')
  })

  it('every built-in preset round-trips through its diff', () => {
    for (const name of listPresets()) {
      const config = getPreset(name)
      const reparsed = paperConfigSchema.parse(diffConfig(config))
      expect(reparsed, `preset "${name}" lost data through diff`).toEqual(config)
    }
  })

  it('keeps required fields of typed content (image src)', () => {
    const config = paperConfigSchema.parse({
      content: { type: 'image', src: '/a.jpg' },
    })
    expect(diffConfig(config)).toEqual({ content: { type: 'image', src: '/a.jpg' } })
  })
})

describe('buildJsxSnippet', () => {
  it('a default paper is just <Paper />', () => {
    expect(buildJsxSnippet(paperConfigSchema.parse({}))).toBe('<Paper />')
  })

  it('emits only non-default props', () => {
    const snippet = buildJsxSnippet(
      paperConfigSchema.parse({ stock: 'kraft', behavior: { type: 'peel', progress: 0.6 } }),
    )
    expect(snippet).toContain('stock="kraft"')
    expect(snippet).toContain('"type":"peel"')
    expect(snippet).toContain('"progress":0.6')
    expect(snippet).not.toContain('sheet')
  })
})

describe('buildAgentPayload', () => {
  const receipt = getPreset('receipt-unroll')

  it('has the fixed anatomy: install → code → sizing → verify → constraints', () => {
    const payload = buildAgentPayload(receipt)
    const order = [
      `agent-payload v${AGENT_PAYLOAD_VERSION}`,
      'npm i paperlab three @react-three/fiber gsap',
      "import { Paper, type PaperConfigInput } from 'paperlab'",
      'const preset =',
      'fills its parent container',
      'Verify: run the dev server',
      'parent container almost certainly has no height',
      "Constraints: don't modify the preset values",
    ]
    let cursor = -1
    for (const marker of order) {
      const at = payload.indexOf(marker)
      expect(at, `missing or out of order: "${marker}"`).toBeGreaterThan(cursor)
      cursor = at
    }
  })

  it('inlines the preset — nothing to fetch', () => {
    const payload = buildAgentPayload(receipt)
    expect(payload).toContain('"type": "receipt"')
    expect(payload).toContain('"store": "nawwara.studio"')
  })

  it('names the component from the preset meta', () => {
    expect(buildAgentPayload(receipt)).toContain('export function ReceiptUnroll()')
  })

  it('describeConfig generates a checkable one-liner per preset', () => {
    expect(describeConfig(receipt)).toBe(
      'a store receipt for "nawwara.studio" on thermal paper stock (1×2.6), unrolling from a paper roll at the bottom, torn (deckled) bottom edge',
    )
    expect(describeConfig(getPreset('pinned-sheet'))).toContain('moving like cloth in wind')
    expect(describeConfig(getPreset('vintage-note'))).toContain('visibly aged')
  })

  /**
   * `describeConfig` is the one line an agent checks its render against, and
   * its phrase table is hand-written — so a new behavior joins the registry
   * and is silently described as nothing at all, which is how `crumple`
   * shipped its first render reading "a sheet with typeset text" and no
   * mention of being crushed. Nothing enforced the pair. Now something does.
   */
  it('every registered behavior has a phrase — a new one cannot describe as nothing', () => {
    const bare = describeConfig(paperConfigSchema.parse({}))
    for (const id of listBehaviors()) {
      const described = describeConfig(paperConfigSchema.parse({ behavior: { type: id } }))
      expect(described, `behavior "${id}" has no phrase in describeConfig`).not.toBe(bare)
    }
  })
})

describe('onTwos quantizer', () => {
  it('steps time at 12fps', () => {
    expect(quantizeTime(0.0)).toBe(0)
    expect(quantizeTime(0.083)).toBe(0)
    expect(quantizeTime(0.084)).toBeCloseTo(1 / 12)
    expect(quantizeTime(1.0)).toBeCloseTo(1)
  })

  it('snaps progress to whole frames of the play duration', () => {
    // 2s duration → 24 steps.
    expect(quantizeProgress(0.5, 2)).toBe(0.5)
    expect(quantizeProgress(0.51, 2)).toBeCloseTo(12 / 24)
    expect(quantizeProgress(0.53, 2)).toBeCloseTo(13 / 24)
  })
})

describe('the scene survives the trip out', () => {
  const parse = (scene: unknown) => paperConfigSchema.parse({ scene })
  const upload = 'data:image/jpeg;base64,AAAA'

  it('says nothing about a scene nobody touched', () => {
    expect(diffConfig(parse({}))).not.toHaveProperty('scene')
    expect(diffConfig(parse({ lighting: 'studio' }))).not.toHaveProperty('scene')
  })

  it('carries a named preset', () => {
    expect(diffConfig(parse({ lighting: 'nave' })).scene).toEqual({ lighting: 'nave' })
  })

  it('carries hand-moved light overrides', () => {
    // This is what the old `if (lighting !== "studio") out.scene = { lighting }`
    // threw away: the editor showed a tuned rig and nothing that left the
    // editor — file, link or snippet — carried a single number of it.
    expect(diffConfig(parse({ light: { exposure: 1.8, key: 6 } })).scene).toEqual({
      light: { exposure: 1.8, key: 6 },
    })
  })

  it('carries only the overrides that were moved', () => {
    // An unset field means "whatever the preset says"; freezing the resolved
    // rig would stop it tracking the preset it names.
    const scene = diffConfig(parse({ lighting: 'nave', light: { haze: 0.4 } })).scene
    expect(scene).toEqual({ lighting: 'nave', light: { haze: 0.4 } })
  })

  it('carries a backdrop', () => {
    const scene = diffConfig(parse({ backdrop: { image: '/wall.jpg' } })).scene
    expect(scene).toMatchObject({ backdrop: { image: '/wall.jpg', fit: 'cover' } })
  })

  it('round-trips: what the diff emits parses back to what went in', () => {
    const original = parse({ lighting: 'nave', light: { exposure: 1.8 }, backdrop: { image: '/w.jpg' } })
    expect(paperConfigSchema.parse(diffConfig(original)).scene).toEqual(original.scene)
  })

  it('swaps an uploaded backdrop for a path in a code export, and says so', () => {
    const jsx = buildJsxSnippet(parse({ backdrop: { image: upload } }))
    expect(jsx).not.toContain('base64')
    expect(jsx).toContain('/paperlab-image-1.jpg')
    expect(jsx).toContain('stand-ins')
  })

  it('swaps an uploaded sheet picture too', () => {
    // Same problem, and it was there before backdrops were: an uploaded
    // content image put its whole base64 into the snippet.
    const config = paperConfigSchema.parse({ content: { type: 'image', src: upload } })
    expect(buildJsxSnippet(config)).not.toContain('base64')
    expect(buildAgentPayload(config)).not.toContain('base64')
  })

  it('leaves a referenced URL exactly as it is', () => {
    // A path the receiver can fetch is the case that already works.
    const jsx = buildJsxSnippet(parse({ backdrop: { image: 'https://example.com/w.jpg' } }))
    expect(jsx).toContain('https://example.com/w.jpg')
    expect(jsx).not.toContain('stand-ins')
  })

  it('numbers the stand-ins so two pictures do not become one', () => {
    const config = paperConfigSchema.parse({
      content: { type: 'image', src: upload },
      scene: { backdrop: { image: upload } },
    })
    const jsx = buildJsxSnippet(config)
    expect(jsx).toContain('/paperlab-image-1.jpg')
    expect(jsx).toContain('/paperlab-image-2.jpg')
  })
})
