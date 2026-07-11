import { describe, expect, it } from 'vitest'
import {
  buildFieldAgentPayload,
  buildFieldComponentSource,
  describeFieldConfig,
  diffFieldProps,
  distinctFieldPresets,
  type FieldExportInput,
} from './field-export'
import { AGENT_PAYLOAD_VERSION } from './agent-payload'
import { getPreset } from './presets'
import { groupFieldPapers } from '../PaperField'

const photo = getPreset('photo-print')
const receipt = getPreset('receipt-unroll')

const mixedField: FieldExportInput = {
  layout: 'ring',
  layoutOptions: { radius: 3.2, tiltDeg: 8 }, // tiltDeg 8 IS the default
  motion: { driver: 'autoplay', speed: 0.8 },
  entrance: { type: 'rise', stagger: 0.06 },
  papers: [
    { presetName: 'photo-print', preset: photo, content: { type: 'image', src: '/a.jpg', fit: 'cover' } },
    { presetName: 'photo-print', preset: photo, content: { type: 'image', src: '/b.jpg', fit: 'cover' } },
    { presetName: 'receipt-unroll', preset: receipt },
  ],
}

describe('field export', () => {
  it('payload is v2 with the fixed anatomy and a field verify line', () => {
    const payload = buildFieldAgentPayload(mixedField)
    const order = [
      `agent-payload v${AGENT_PAYLOAD_VERSION}`,
      'npm i paperlab three @react-three/fiber gsap',
      "import { PaperField, type FieldPaperSlot, type PaperConfigInput } from 'paperlab'",
      'const papers: FieldPaperSlot[] = [',
      'fills its parent container',
      'Verify: run the dev server',
      '3 papers arranged in a ring',
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

  it('inlines every referenced preset as a const — nothing to fetch', () => {
    const src = buildFieldComponentSource(mixedField)
    expect(src).toContain('const photoPrint = {')
    expect(src).toContain('const receiptUnroll = {')
    expect(src).toContain('"stock": "thermal"') // receipt preset body present
    expect(src).toContain('{ preset: photoPrint, content: {"type":"image","src":"/a.jpg","fit":"cover"} },')
    expect(src).toContain('{ preset: receiptUnroll },')
    expect(src).toContain('layout="ring"')
  })

  it('describeFieldConfig covers count, layout, driver and preset mix', () => {
    expect(describeFieldConfig(mixedField)).toBe(
      '3 papers arranged in a ring you can see around, slowly orbiting on their own, mixing 2 paper presets (photo-print, receipt-unroll)',
    )
  })

  it('diffFieldProps strips layout/motion/entrance defaults', () => {
    expect(diffFieldProps(mixedField)).toEqual({
      layoutOptions: { radius: 3.2 }, // tiltDeg 8 stripped
      layout: 'ring',
      motion: { speed: 0.8 }, // autoplay stripped
      // entrance was all defaults → omitted entirely
    })
  })

  it('deduplicates presets and keeps const names collision-safe', () => {
    const twin = { ...photo, meta: { ...photo.meta, name: 'Photo print B' } }
    const distinct = distinctFieldPresets({
      layout: 'ring',
      papers: [
        { presetName: 'photo-print', preset: photo },
        { presetName: 'photo print', preset: twin }, // same camel name, different config
      ],
    })
    expect(distinct).toHaveLength(2)
    expect(distinct[0]!.varName).toBe('photoPrint')
    expect(distinct[1]!.varName).toBe('photoPrint2')
  })
})

describe('groupFieldPapers', () => {
  it('groups slots by resolved preset, preserving global indices', () => {
    const groups = groupFieldPapers([
      { preset: photo },
      { preset: receipt },
      { preset: photo },
      { preset: photo },
    ])
    expect(groups).toHaveLength(2)
    expect(groups[0]!.indices).toEqual([0, 2, 3])
    expect(groups[1]!.indices).toEqual([1])
    expect(groups[1]!.config.stock).toBe('thermal')
  })

  it('slot content overrides the preset content, falls back otherwise', () => {
    const groups = groupFieldPapers([
      { preset: photo, content: { type: 'image', src: '/x.jpg', fit: 'cover' } },
      { preset: photo },
    ])
    expect(groups[0]!.contents[0]).toMatchObject({ src: '/x.jpg' })
    expect(groups[0]!.contents[1]).toMatchObject({ src: expect.stringContaining('unsplash') })
  })

  it('slots without a preset use the shared fallback', () => {
    const groups = groupFieldPapers([{}, { preset: 'receipt-unroll' }], 'photo-print')
    expect(groups).toHaveLength(2)
    expect(groups[0]!.config.stock).toBe('photo-gloss')
  })
})
