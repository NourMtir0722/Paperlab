import { describe, expect, it } from 'vitest'

/**
 * The effects layer must stay on its own side of the wall.
 *
 * `paperlab/fx` exists so that a `<Paper>` consumer never resolves anything
 * it did not ask for. Tree-shaking cannot deliver that on its own — it
 * removes unused CODE, and the thing that breaks a consumer is an unused
 * SPECIFIER, which has to resolve before anyone can ask whether it is used.
 * That is the whole reason `paperlab/stage` is a subpath, and it is the
 * reason this one is.
 *
 * A subpath only holds while nothing on the safe side imports across. One
 * `import { DamageField } from './fx/field'` in a file the main entry reaches
 * and the boundary is gone, silently, with every existing test still green
 * and the only symptom a bundle that grew.
 *
 * So this walks the real import graph from each entry point and asserts what
 * it can reach. It is a cheap test for a thing that is expensive to notice
 * any other way — the alternative is spotting it in a published bundle size.
 */

/**
 * Every source file in the library, as text, keyed by its path relative to
 * `src`.
 *
 * Read through Vite rather than through `node:fs` deliberately. This is a
 * browser library and it does not depend on Node's types; pulling
 * `@types/node` in so that one test can call `readFileSync` would put
 * `process`, `Buffer` and the rest into the global scope of every file in the
 * package, which is precisely how browser-incompatible code gets written
 * without anyone noticing.
 */
// Written as the literal `import.meta.glob(…)` because Vite replaces that
// exact text at transform time — held in a variable first, it is just a
// property access on `import.meta` and the runner says so. The suppression is
// for `tsc`, which has no idea this call exists: `vite/client` is not a
// dependency of this package, and pulling it in for one signature would add a
// large global augmentation to a library that deliberately has none.
// @ts-expect-error -- provided by Vite, typed by vite/client which is not installed here
const sources: Record<string, string> = import.meta.glob('../**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
})

/** Keyed on 'fx/field.ts' rather than '../fx/field.ts'. */
const files = new Map<string, string>(
  Object.entries(sources).map(([path, text]) => [path.replace(/^\.\.\//, ''), text]),
)

/** Collapse '.' and '..' the way a resolver does. */
function normalise(path: string): string {
  const out: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return out.join('/')
}

/** Every relative specifier a module names, static or dynamic. */
function imports(file: string): string[] {
  const source = files.get(file)
  if (source === undefined) return []
  const found: string[] = []
  // `from '…'`, `import '…'` and `import('…')`. The dynamic form matters here
  // as much as the static one: `stage/GradeLazy` uses it, and a walk blind to
  // those would miss the most likely kind of leak.
  const pattern = /(?:from|import)\s*\(?\s*['"](\.[^'"]*)['"]/g
  for (const match of source.matchAll(pattern)) found.push(match[1]!)
  return found
}

/** Resolve a relative specifier against the importing file, as the bundler will. */
function resolveFile(from: string, specifier: string): string | null {
  const base = normalise(`${from.split('/').slice(0, -1).join('/')}/${specifier}`)
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (files.has(candidate)) return candidate
  }
  return null
}

/** Every source file an entry point can reach, transitively. */
function reachableFrom(entry: string): Set<string> {
  const seen = new Set<string>()
  const queue = [entry]
  while (queue.length > 0) {
    const file = queue.pop()!
    if (seen.has(file)) continue
    seen.add(file)
    for (const specifier of imports(file)) {
      const target = resolveFile(file, specifier)
      if (target) queue.push(target)
    }
  }
  return seen
}

const inFx = (file: string) => file.startsWith('fx/')

/** The one file outside fx that fx may reach. */
const CONTRACT = 'surface/damageContract.ts'

describe('the fx boundary', () => {
  it('is not crossed by the main entry point', () => {
    expect([...reachableFrom('index.ts')].filter(inFx)).toEqual([])
  })

  it('is not crossed by stage either', () => {
    // Stage is a subpath too, and one subpath quietly importing another
    // would put the whole of fx into a stage consumer's graph.
    expect([...reachableFrom('stage.ts')].filter(inFx)).toEqual([])
  })

  it('reaches back into the library through the damage contract, and nothing else', () => {
    // The other direction, and the one that decides whether fx can ever be
    // lazy-loaded. fx depends on exactly one file outside itself — the
    // contract that says what a damage texel means, which belongs to the
    // sheet because the sheet draws it. If it grows an import of `PaperMesh`
    // or the config schema, `fx.js` stops being a few-KB leaf and starts
    // dragging the library in behind it.
    const outside = [...reachableFrom('fx.ts')].filter((f) => !inFx(f) && f !== 'fx.ts')
    expect(outside).toEqual([CONTRACT])
  })

  it('keeps the damage contract a leaf that imports nothing', () => {
    // The previous test allows fx to reach this file, which is only safe
    // while this file reaches nothing. One `import * as THREE` here and the
    // allowance above quietly becomes an allowance for three.
    expect(files.get(CONTRACT)).toBeDefined()
    expect(imports(CONTRACT)).toEqual([])
    expect(files.get(CONTRACT)).not.toMatch(/^\s*import\s/m)
  })

  it('walks a graph that is actually there, so a broken walk cannot pass', () => {
    // The control. Every assertion above is "found nothing", which is also
    // what a resolver that silently resolves nothing would report.
    expect(files.size).toBeGreaterThan(50)
    const fromIndex = reachableFrom('index.ts')
    expect(fromIndex.size).toBeGreaterThan(20)
    expect(fromIndex.has('PaperMesh.tsx')).toBe(true)
    // And it can see across a dynamic import, which is how stage reaches the
    // print pass — a walk blind to those would miss the most likely leak.
    expect(reachableFrom('stage.ts').has('stage/Grade.tsx')).toBe(true)
  })
})
