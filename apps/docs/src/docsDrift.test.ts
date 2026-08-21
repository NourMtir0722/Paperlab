import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { idleNames, listBehaviors, listLayouts, listPresets, stockNames } from 'paperlab'
import { listStagePresets } from 'paperlab/stage'
/**
 * The docs enumerate what the library has. Nothing used to check that.
 *
 * `README.md` claimed seven behaviors for as long as there were nine —
 * `carry` and `flight` were simply never added, and `crumple` would have been
 * the third to go missing. Before that the README advertised five layouts
 * that did not exist. The lists are hand-written prose with a sentence of
 * value around each name, so generating them wholesale would only move the
 * hand-maintenance somewhere else; what actually has to be true is that the
 * NAMES match the registries, in both directions. That is what this asserts.
 *
 * It lives here rather than in the library for two reasons. It reads files
 * off disk, and a browser library has no business gaining `@types/node` for a
 * test. And this app already asserts the same thing about its own pages — the
 * catalogue comes from the registries — so doc-versus-registry drift is one
 * concern in one place. When it fails it names the file and the missing or
 * invented entry, which is the whole point: `pnpm test` tells you what to go
 * and write.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const read = (file: string) => readFileSync(resolve(root, file), 'utf8')

/**
 * Pull the bare names out of a `a | b | c` / `'a','b'` / ``a` · `b`` run.
 * Parenthesised and braced asides are each entry's PARAMS, not more entries —
 * dropping them first is what stops `peel {progress, corner}` from reading as
 * three behaviors.
 */
function names(list: string): string[] {
  return list
    .replace(/\{[^{}]*\}/g, ' ')
    .replace(/\([^()]*\)/g, ' ')
    .split(/[|,·\s]+/)
    .map((part) => part.trim().replace(/^[`'"]+/, ''))
    .map((part) => /^[a-z][a-z0-9-]*/.exec(part)?.[0] ?? '')
    .filter(Boolean)
}

/** A markdown table's first column — the name, without the params beside it. */
function firstColumn(block: string): string[] {
  return [...block.matchAll(/^\|\s*`([a-z][a-z0-9-]*)`\s*\|/gm)].map((m) => m[1]!)
}

/** Capture one enumeration out of a doc, or fail loudly if the shape moved. */
function enumerated(file: string, pattern: RegExp, table = false): string[] {
  const match = pattern.exec(read(file))
  if (!match?.[1]) {
    throw new Error(
      `[docs-drift] ${file}: could not find the list matching ${pattern}. The doc was ` +
        `restructured — update this test's extractor, do not delete the check.`,
    )
  }
  return table ? firstColumn(match[1]) : names(match[1])
}

/**
 * Every list in the docs that is meant to be COMPLETE. A list that is
 * deliberately partial ("`float`, `tumble`, `breeze`…") does not belong here.
 */
const LISTS: {
  doc: string
  what: string
  pattern: RegExp
  registry: () => string[]
  /** The capture is a markdown table; take its first column. */
  table?: boolean
}[] = [
  {
    doc: 'README.md',
    what: 'behaviors',
    pattern: /- \*\*Behaviors\*\* — (.+?): human-named/,
    registry: listBehaviors,
  },
  {
    doc: 'AGENTS.md',
    what: 'behaviors',
    pattern: /### Behaviors \(the `behavior` prop.*?\|---\|---\|---\|\n(.*?)\n\n/s,
    registry: listBehaviors,
    table: true,
  },
  {
    doc: 'AGENTS.md',
    what: 'presets',
    pattern: /Built-ins: (.+?)\. A preset is/,
    registry: listPresets,
  },
  {
    doc: 'AGENTS.md',
    what: 'layouts',
    pattern: /layout="ring"\s+\/\/ (.+)/,
    registry: listLayouts,
  },
  {
    doc: 'AGENTS.md',
    what: 'stocks',
    pattern: /stock="thermal"\s+\/\/ (.+)/,
    registry: () => [...stockNames],
  },
  {
    doc: 'AGENTS.md',
    what: 'stage presets',
    pattern: /Stage presets — (.+?) —/,
    registry: listStagePresets,
  },
  {
    doc: 'AGENTS.md',
    what: 'idle physics',
    pattern: /Idle presets \(`physics: (.+?)`\)/,
    registry: () => [...idleNames],
  },
  {
    doc: 'docs/llms.txt',
    what: 'behaviors',
    pattern: /## Behaviors \(behavior=\{\{ type, \.\.\.params \}\}\)\n\n(.+)/,
    registry: listBehaviors,
  },
  {
    doc: 'docs/llms.txt',
    what: 'presets',
    pattern: /Built-ins: (.+?)\. Presets are/,
    registry: listPresets,
  },
  {
    doc: 'docs/llms.txt',
    what: 'layouts',
    pattern: /layout \((.+?)\), layoutOptions/,
    registry: listLayouts,
  },
  {
    doc: 'docs/llms.txt',
    what: 'stocks',
    pattern: /stock \((.+?)\), content/,
    registry: () => [...stockNames],
  },
  {
    doc: 'docs/llms.txt',
    what: 'stage presets',
    pattern: /listStagePresets\(\)` — (.+?)\. Export helpers/,
    registry: listStagePresets,
  },
  {
    doc: 'docs/llms.txt',
    what: 'idle physics',
    pattern: /Idle \(compose with behaviors\): (.+?)\. Cloth/,
    registry: () => [...idleNames],
  },
]

describe('the docs enumerate what the library actually has', () => {
  for (const { doc, what, pattern, registry, table } of LISTS) {
    it(`${doc} lists every ${what}, and invents none`, () => {
      const documented = new Set(enumerated(doc, pattern, table))
      const registered = new Set(registry())

      const missing = [...registered].filter((n) => !documented.has(n))
      const invented = [...documented].filter((n) => !registered.has(n))

      expect(missing, `${doc} is missing ${what}: ${missing.join(', ')}`).toEqual([])
      expect(invented, `${doc} lists ${what} that do not exist: ${invented.join(', ')}`).toEqual([])
    })
  }
})
