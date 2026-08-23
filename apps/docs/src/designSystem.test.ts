import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The design language, held to `docs/design.md`.
 *
 * Graphite Showroom's own notes say the quiet part out loud: *"cheap to
 * build, demanding to hold — one coloured button, one drop shadow, one stock
 * photograph and it degrades to generic dark SaaS."* The discipline IS the
 * style, and discipline that lives only in a document lasts about a quarter.
 * A green "saved" pill is individually reasonable every single time somebody
 * adds one.
 *
 * So the rules that can be checked are checked here, next to the drift test
 * that already holds the docs' prose to the registries. Same reasoning, same
 * place: when it fails it names the file and the offending value, so
 * `pnpm test` tells you what to go and fix rather than leaving it to review.
 *
 * What it cannot check is taste. Nothing here stops a badly spaced panel.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const read = (file: string) => readFileSync(resolve(root, file), 'utf8')

const SHEETS = [
  'apps/editor/src/styles.css',
  'apps/playground/src/styles.css',
  'apps/docs/src/styles.css',
] as const

const START = ':root {'
const END = '/* ── END SHARED TOKEN BLOCK'

/** The two colours the chroma budget was spent on, and nothing else. */
const BUDGET = new Set(['#4f7cff', '#e2726e'])

/**
 * How far a "neutral" may drift off the grey axis. Three points buys the
 * faint cool cast the parent style specifies for plate; it is nowhere near
 * enough to sneak a hue through.
 */
const CAST = 3

const tokenBlock = (css: string) => {
  const start = css.indexOf(START)
  const end = css.indexOf(END)
  if (start < 0 || end < 0) throw new Error('no shared token block')
  return css.slice(start, end)
}

const channels = (hex: string): [number, number, number] => {
  const h = hex.length === 4 ? hex.replace(/[0-9a-f]/gi, (c) => c + c).slice(1) : hex.slice(1)
  return [
    Number.parseInt(h.slice(0, 2), 16),
    Number.parseInt(h.slice(2, 4), 16),
    Number.parseInt(h.slice(4, 6), 16),
  ]
}
const spread = (rgb: [number, number, number]) => Math.max(...rgb) - Math.min(...rgb)

describe('the token block is one block, in three places', () => {
  it('is byte-identical across the three apps', () => {
    const [editor, playground, docs] = SHEETS.map((f) => tokenBlock(read(f)))
    expect(playground, 'apps/playground/src/styles.css has drifted').toBe(editor)
    expect(docs, 'apps/docs/src/styles.css has drifted').toBe(editor)
  })

  it('matches the one printed in docs/design.md', () => {
    const doc = read('docs/design.md')
    const fenced = doc.match(/```css\n(:root \{[\s\S]*?\n\})\n```/)
    // The doc is the source of truth, so it is what the sheets are compared to.
    const printed = fenced?.[1]
    expect(printed, 'docs/design.md no longer prints the token block').toBeTruthy()
    expect(tokenBlock(read(SHEETS[0])).trim()).toBe(printed?.trim())
  })
})

describe('rule 4 — chroma only for state', () => {
  for (const file of SHEETS) {
    it(`${file} spends nothing outside the budget`, () => {
      const css = read(file)
      const offenders: string[] = []

      for (const [hex] of css.matchAll(/#[0-9a-f]{3}(?:[0-9a-f]{3})?\b/gi)) {
        const value = hex.toLowerCase()
        if (BUDGET.has(value)) continue
        if (spread(channels(value)) > CAST) offenders.push(value)
      }
      for (const m of css.matchAll(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g)) {
        const rgb = [Number(m[1]), Number(m[2]), Number(m[3])] as [number, number, number]
        if (BUDGET.has(`#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`)) continue
        if (spread(rgb) > CAST) offenders.push(m[0])
      }

      expect(
        [...new Set(offenders)],
        'a hue got in. Emphasis is a brighter step on the ramp, never a colour — see docs/design.md rule 4',
      ).toEqual([])
    })
  }
})

describe('amendment 2 — the room is exactly achromatic', () => {
  it('every --room value is a pure grey', () => {
    const block = tokenBlock(read(SHEETS[0]))
    const rooms = [...block.matchAll(/--room[\w-]*:\s*(#[0-9a-f]{6})/gi)]
    expect(rooms.length, 'the room tokens have gone missing').toBeGreaterThanOrEqual(3)
    for (const room of rooms) {
      const hex = room[1] ?? ''
      expect(
        spread(channels(hex.toLowerCase())),
        `${hex} is the band that touches the paper — a cast here shifts the sheet's perceived colour`,
      ).toBe(0)
    }
  })

  /**
   * The clear colour lives in App.tsx as a literal, because a WebGL clear is
   * not a CSS property and cannot read a custom property. So the token and
   * the literal are two copies of one decision, which is exactly the shape of
   * thing that drifts — hence this.
   */
  it('the editor clears its canvas to the room tokens', () => {
    const block = tokenBlock(read(SHEETS[0]))
    const room = (name: string) =>
      block.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i'))?.[1]?.toLowerCase()

    const app = read('apps/editor/src/App.tsx')
    const clear = app.match(/<color attach="background" args=\{\[([^\]]+)\]\}/)
    expect(clear, 'the canvas no longer sets its own background').toBeTruthy()

    const used = [...(clear?.[1] ?? '').matchAll(/#[0-9a-f]{6}/gi)].map((m) => m[0].toLowerCase())
    expect(used.length, 'expected a paper room and a stage room').toBe(2)
    expect(new Set(used), 'the canvas clear colour and the --room tokens have drifted apart').toEqual(
      new Set([room('room'), room('room-stage')]),
    )
  })
})

describe('amendment 1 — glass floats, plate docks', () => {
  for (const file of SHEETS) {
    it(`${file} declares at most two blurs`, () => {
      // Unprefixed only: the -webkit- alias is the same declaration twice.
      const blurs = read(file).match(/\n\s*backdrop-filter:\s*blur\(/g) ?? []
      expect(
        blurs.length,
        'one recipe for surfaces floating over the canvas, one modal scrim, and that is the budget — see docs/design.md amendment 1',
      ).toBeLessThanOrEqual(2)
    })
  }

  it('every glass surface has an opaque fallback', () => {
    for (const file of SHEETS) {
      const css = read(file)
      if (!/backdrop-filter:\s*blur\(/.test(css)) continue
      expect(css, `${file} blurs without a reduced-transparency fallback`).toMatch(
        /prefers-reduced-transparency/,
      )
    }
  })
})

describe('amendment 3 — the accent is the grab point', () => {
  it('only the handle and its coach-mark spend it', () => {
    const css = read('apps/editor/src/styles.css')
    const body = css.slice(css.indexOf('END SHARED TOKEN BLOCK'))
    const offenders: string[] = []

    // Crude but sufficient: every rule is "selector { declarations }", and
    // this file has no nested syntax beyond @media, whose prelude is dropped.
    for (const chunk of body.split('}')) {
      const brace = chunk.indexOf('{')
      if (brace < 0) continue
      const declarations = chunk.slice(brace + 1)
      if (!declarations.includes('var(--grab')) continue
      const selector = chunk
        .slice(0, brace)
        .replace(/@media[^{]*/g, '')
        .trim()
      if (!/coach-mark|guide-dot/.test(selector)) offenders.push(selector.split('\n').pop() ?? selector)
    }

    expect(
      offenders,
      'the accent means "this is the part you can pull". Anything else that wants emphasis gets a brighter step — see docs/design.md amendment 3',
    ).toEqual([])
  })

  it('the two showroom apps never touch it', () => {
    for (const file of SHEETS.slice(1)) {
      const css = read(file)
      const body = css.slice(css.indexOf('END SHARED TOKEN BLOCK'))
      expect(body, `${file} has no handle to point at`).not.toMatch(/var\(--grab/)
    }
  })
})
