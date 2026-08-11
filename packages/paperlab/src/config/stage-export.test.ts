import { describe, expect, it } from 'vitest'
import {
  stringifyStage,
  buildStageAgentPayload,
  buildStageComponentSource,
  describeStage,
  diffStage,
  walkNameFor,
  type StageExportInput,
} from './stage-export'
import { stageSchema } from '../stage/schema'
import { walks } from '../stage/walks'

const base = (o: Partial<StageExportInput> = {}): StageExportInput => ({
  stage: {},
  layout: 'colonnade',
  count: 18,
  text: 'the paper remembers every hand that folded it',
  ...o,
})

describe('diffStage', () => {
  it('writes down nothing that is already the default', () => {
    expect(diffStage({})).toEqual({})
  })

  it('keeps only what actually changed, nested included', () => {
    const diff = diffStage({ shot: { shot: 'low' }, figure: { height: 2.1 } })
    expect(diff).toEqual({ shot: { shot: 'low' }, figure: { height: 2.1 } })
    // Untouched siblings inside a changed folder stay out of the export.
    expect(diff.shot).not.toHaveProperty('distance')
  })

  it('treats a path as one value — half a walk is not a walk', () => {
    expect(diffStage({ path: walks.ess })).toEqual({ path: walks.ess })
    expect(diffStage({ path: walks.straight })).toEqual({ path: walks.straight })
  })
})

describe('walkNameFor', () => {
  it('recognizes the named walks so the brief can say which one', () => {
    for (const [name, walk] of Object.entries(walks)) {
      expect(walkNameFor(stageSchema.parse({ path: walk }).path)).toBe(name)
    }
  })

  it('returns nothing for a hand-drawn path', () => {
    const custom = stageSchema.parse({
      path: {
        points: [
          [0, 3],
          [1, -4],
        ],
      },
    })
    expect(walkNameFor(custom.path)).toBeUndefined()
  })
})

describe('stage component source', () => {
  it('inlines the stage and the words — receivers have neither', () => {
    const source = buildStageComponentSource(base())
    expect(source).toContain("import { PaperStage, type StageConfigInput } from 'paperlab'")
    expect(source).toContain('satisfies StageConfigInput')
    expect(source).toContain('the paper remembers every hand that folded it')
    expect(source).toContain('count={18}')
  })

  it('omits the layout prop when it is the default one', () => {
    expect(buildStageComponentSource(base())).not.toContain('layout=')
    expect(buildStageComponentSource(base({ layout: 'ring' }))).toContain('layout="ring"')
  })

  it('exports only the layout options that differ from the layout defaults', () => {
    const source = buildStageComponentSource(base({ layoutOptions: { aisle: 2.4, twist: 40 } }))
    // aisle 2.4 IS the colonnade default; twist 40 is not.
    expect(source).toContain('"twist": 40')
    expect(source).not.toContain('"aisle"')
  })

  it('the scroll variant reserves its own height and pins the canvas', () => {
    const source = buildStageComponentSource(base({ scroll: true }))
    expect(source).toContain("height: '400vh'")
    expect(source).toContain("position: 'sticky'")
    expect(source).toContain('progress={progress}')
    // Listener hygiene: a hero that leaks a scroll handler is a real bug.
    expect(source).toContain("window.addEventListener('scroll', onScroll, { passive: true })")
    expect(source).toContain("window.removeEventListener('scroll', onScroll)")
  })

  it('the clock variant takes no progress and reserves no scroll', () => {
    const source = buildStageComponentSource(base())
    expect(source).not.toContain('progress')
    expect(source).not.toContain('sticky')
    expect(source).not.toContain('useEffect')
  })

  it('honours a component name', () => {
    expect(buildStageComponentSource(base({ componentName: 'Cathedral' }))).toContain(
      'export function Cathedral()',
    )
  })
})

describe('describeStage', () => {
  it('describes what the agent should actually see', () => {
    const described = describeStage(base())
    expect(described).toContain('18 tall paper banners')
    expect(described).toContain('column of your text')
    expect(described).toContain('figure walking between them')
    expect(described).toContain('lit from behind')
  })

  it('names the walk shape, and says when scroll drives it', () => {
    expect(describeStage(base({ stage: { path: walks.ess } }))).toContain('"ess" walk')
    expect(describeStage(base({ stage: { path: walks.ring } }))).toContain('closed loop')
    expect(describeStage(base({ scroll: true }))).toContain('scrolling the page walks the figure')
  })

  it('drops the figure from the description when it is turned off', () => {
    expect(describeStage(base({ stage: { showFigure: false } }))).not.toContain('figure walking')
  })

  it('names the shot, because that is what the reader is looking at', () => {
    expect(describeStage(base({ stage: { shot: { shot: 'low' } } }))).toContain('floor level')
  })
})

describe('stage agent payload', () => {
  it('carries install, component, placement and a verification step', () => {
    const payload = buildStageAgentPayload(base())
    expect(payload).toContain('npm i paperlab three @react-three/fiber gsap')
    expect(payload).toContain('components/PaperNave.tsx')
    expect(payload).toContain('You should see')
    // The mistake a receiving agent would otherwise make.
    expect(payload).toContain("don't add OrbitControls")
  })

  it('tells the receiver the scroll variant brings its own height', () => {
    expect(buildStageAgentPayload(base({ scroll: true }))).toContain('reserves 4 viewport')
    expect(buildStageAgentPayload(base())).toContain('fills its parent container')
  })
})

describe('stringifyStage', () => {
  it('keeps coordinate pairs on one line', () => {
    expect(
      stringifyStage({
        points: [
          [6, 17],
          [-3, 7],
        ],
      }),
    ).toBe('{\n  "points": [\n    [6, 17],\n    [-3, 7]\n  ]\n}')
  })

  it('still nests objects, and survives the empty cases', () => {
    expect(stringifyStage({ a: { b: 1 } })).toBe('{\n  "a": {\n    "b": 1\n  }\n}')
    expect(stringifyStage({})).toBe('{}')
    expect(stringifyStage([])).toBe('[]')
    expect(stringifyStage(null)).toBe('null')
  })

  it('produces valid JSON for any stage diff', () => {
    const diff = diffStage({ path: walks.spiral, shot: { shot: 'wide' } })
    expect(JSON.parse(stringifyStage(diff))).toEqual(diff)
  })
})

describe('the banner travels with the export', () => {
  it('inlines the paper preset — receivers have no preset library', () => {
    const source = buildStageComponentSource(
      base({ paper: { sheet: { width: 0.9, height: 11 }, stock: 'vellum' } }),
    )
    expect(source).toContain('const banner =')
    expect(source).toContain('type PaperConfigInput')
    expect(source).toContain('preset={banner}')
    expect(source).toContain('"height": 11')
  })

  it('says nothing about paper when the built-in banner is used', () => {
    const source = buildStageComponentSource(base())
    expect(source).not.toContain('const banner')
    expect(source).not.toContain('PaperConfigInput')
  })
})
