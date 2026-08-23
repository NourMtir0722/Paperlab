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
import { groupFieldPapers, zoneAccepts } from '../PaperField'

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
  it('payload is v3 with the fixed anatomy and a field verify line', () => {
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

  it('the stamp sheet exports with states, zones, and the verify vocabulary', () => {
    const stamp = getPreset('postage-stamp')
    const stampSheet: FieldExportInput = {
      layout: 'sheet',
      layoutOptions: { rows: 2, columns: 5 },
      motion: { driver: 'none' },
      entrance: { type: 'none' },
      papers: Array.from({ length: 10 }, (_, i) => ({
        presetName: 'postage-stamp',
        preset: stamp,
        // Slot 3's hover peels deeper than the rest (slot-layer override).
        ...(i === 3 ? { states: { states: { hover: { overrides: { behavior: { progress: 0.4 } } } } } } : {}),
      })),
      zones: [
        {
          id: 'envelope',
          accept: ['postage-*'],
          bounds: { position: [3.2, 0, 0], size: [1.6, 1] },
        },
      ],
    }

    const src = buildFieldComponentSource(stampSheet)
    // The preset's states serialize inside the inlined const.
    expect(src).toContain('"states"')
    expect(src).toContain('"hover"')
    // The slot override rides on the slot, not the preset.
    expect(src).toContain('states: {"states":{"hover":{"overrides":{"behavior":{"progress":0.4}}}}}')
    // Zones export as DropZone children with an onPlace stub.
    expect(src).toContain(
      "import { PaperField, type FieldPaperSlot, type PaperConfigInput, DropZone } from 'paperlab'",
    )
    expect(src).toContain('<DropZone')
    expect(src).toContain('id="envelope"')
    expect(src).toContain('accept={["postage-*"]}')
    expect(src).toContain('onPlace={(paper, zone) => {')
    // The stub is a working smoke test, not a dead comment — a first drop logs.
    expect(src).toContain("console.log(paper.presetName, '→', zone.id)")

    const line = describeFieldConfig(stampSheet)
    expect(line).toContain('a 2×5 sheet of papers on a shared backing')
    expect(line).toContain('hovering peels/reacts per paper')
    expect(line).toContain('carry to the envelope zone')

    const payload = buildFieldAgentPayload(stampSheet)
    expect(payload).toContain(`agent-payload v${AGENT_PAYLOAD_VERSION}`)
    expect(payload).toContain('release elsewhere flutters it back')
  })

  it('zoneAccepts matches preset-name globs, all by default', () => {
    expect(zoneAccepts({}, 'postage-stamp')).toBe(true)
    expect(zoneAccepts({ accept: ['postage-*'] }, 'postage-stamp')).toBe(true)
    expect(zoneAccepts({ accept: ['stamp-*'] }, 'postage-stamp')).toBe(false)
    expect(zoneAccepts({ accept: ['stamp-*', 'postage-stamp'] }, 'postage-stamp')).toBe(true)
    // Glob is anchored — a bare prefix doesn't match.
    expect(zoneAccepts({ accept: ['postage'] }, 'postage-stamp')).toBe(false)
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
    // The preset's own content, which for an image preset is now an EMPTY
    // src — a container awaiting the caller's art rather than a photo the
    // library fetches from a CDN on first render.
    expect(groups[0]!.contents[1]).toMatchObject({ type: 'image', src: '' })
  })

  it('slots without a preset use the shared fallback', () => {
    const groups = groupFieldPapers([{}, { preset: 'receipt-unroll' }], 'photo-print')
    expect(groups).toHaveLength(2)
    expect(groups[0]!.config.stock).toBe('photo-gloss')
  })
})
