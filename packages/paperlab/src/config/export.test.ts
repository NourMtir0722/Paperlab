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
