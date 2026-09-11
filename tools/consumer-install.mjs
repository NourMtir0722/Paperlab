#!/usr/bin/env node
/**
 * Installs the packed library into an empty project and imports it, the way a
 * consumer would.
 *
 * This exists because of a bug that shipped in at least two releases and that
 * nothing in CI could see. `packages/paperlab/package.json` declares
 * `@react-three/postprocessing` and `postprocessing` as OPTIONAL peers, so a
 * consumer who reads that contract installs neither — and then
 * `import 'paperlab/stage'` threw `ERR_MODULE_NOT_FOUND` on the spot, because
 * `dist/stage.js` named the specifier at module scope.
 *
 * Every other package gate in the pipeline is blind to it by construction:
 * `publint` and `arethetypeswrong` read the manifest and the types, and the
 * workspace itself always has both peers installed, so nothing in the repo has
 * ever run the library from a tree where the optional ones are absent. The
 * only thing that catches it is an install into somewhere that is not this
 * repo, which is what this does.
 *
 * Two passes, and the second is not optional either:
 *
 *   1. REQUIRED PEERS ONLY. Both entry points must import, under both
 *      conditions (`import` and `require`). This is the regression gate.
 *   2. OPTIONAL PEERS TOO. The lazily-imported module must still resolve.
 *      A dynamic import that is broken in the other direction — a typo in the
 *      specifier, a file left out of `files` — fails silently forever,
 *      because the catch that keeps a missing peer from crashing the scene
 *      would swallow that too.
 *
 * The peer versions are taken from the workspace's own resolved tree rather
 * than from `latest`. That keeps the harness testing the exact combination the
 * repo develops against, and it keeps an upstream peer-range change from
 * failing this gate for a reason that has nothing to do with the library.
 *
 * Runs in CI as `pnpm test:consumer`. Costs a real `npm install`, so it runs
 * after the build rather than with the unit suite.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkgDir = join(root, 'packages/paperlab')

/** The peers a consumer MUST install. The optional two are deliberately absent. */
const REQUIRED = ['react', 'react-dom', 'three', '@react-three/fiber', 'gsap']
/** The two that `peerDependenciesMeta` marks optional — pass 2 only. */
const OPTIONAL = ['@react-three/postprocessing', 'postprocessing']

const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

let failures = 0
const fail = (message) => {
  console.error(`  ✗ ${message}`)
  failures++
}
const pass = (message) => console.log(`  ✓ ${message}`)

/**
 * The version of a package as the WORKSPACE resolved it.
 *
 * Not `latest`: this harness is asking whether the library's own module graph
 * resolves, and pulling a newer peer than the repo has ever built against
 * turns that question into a different one.
 */
const TREES = [
  pkgDir,
  join(root, 'apps/editor'),
  join(root, 'apps/playground'),
  join(root, 'apps/docs'),
  root,
]

function workspaceVersion(name) {
  // pnpm installs per workspace package and hoists a little to the root, so a
  // peer can legitimately live in any of these. `react-dom` in particular is
  // nowhere near the library — it is an app's dependency, and the library
  // never names it.
  for (const tree of TREES) {
    try {
      return JSON.parse(readFileSync(join(tree, 'node_modules', name, 'package.json'), 'utf8')).version
    } catch {}
  }
  // React DOM ships in lockstep with React and is only here because a consumer
  // needs it to render at all; matching React is right and is what npm does.
  if (name === 'react-dom') return workspaceVersion('react')
  throw new Error(
    `${name} is not installed anywhere in the workspace — cannot pin a version for the consumer test`,
  )
}

const pinned = (names) => names.map((name) => `${name}@${workspaceVersion(name)}`)

console.log('Packing the library…')
const packed = run('npm', ['pack', '--silent', '--pack-destination', tmpdir()], pkgDir)
  .trim()
  .split('\n')
  .pop()
const tarball = join(tmpdir(), packed)
console.log(`  ${packed}`)

/**
 * A clean project with a given peer set, and the probe run inside it.
 *
 * `--no-package-lock` and `--install-strategy=nested` are deliberate: this
 * must behave like a consumer's tree, not like a deduped monorepo, and a
 * lockfile would only be written to be thrown away.
 */
function consumer(label, peers, probe) {
  const dir = mkdtempSync(join(tmpdir(), 'paperlab-consumer-'))
  try {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'consumer', private: true, version: '0.0.0', type: 'module' }, null, 2),
    )
    console.log(`\n${label}`)
    console.log(`  installing: ${peers.join(' ')}`)
    try {
      run('npm', ['install', '--no-audit', '--no-fund', '--no-package-lock', tarball, ...pinned(peers)], dir)
    } catch (error) {
      fail(
        `npm install failed — a consumer cannot install this at all\n${error.stdout ?? ''}${error.stderr ?? ''}`,
      )
      return
    }
    writeFileSync(join(dir, 'probe.mjs'), probe)
    try {
      const out = run('node', ['probe.mjs'], dir)
      for (const line of out.trim().split('\n').filter(Boolean)) {
        if (line.startsWith('FAIL ')) fail(line.slice(5))
        else if (line.startsWith('OK ')) pass(line.slice(3))
        else console.log(`    ${line}`)
      }
    } catch (error) {
      fail(`the probe crashed\n${error.stdout ?? ''}${error.stderr ?? ''}`)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * Pass 1. The entry points have to LOAD, which is a different and much weaker
 * claim than that they work — nothing here renders. Loading is precisely what
 * was broken, though: a module-scope specifier that cannot resolve takes the
 * whole entry point down before a consumer reaches their first component.
 *
 * Both conditions, because `exports` declares both and a bundler will pick
 * either: the ESM graph and the CJS one are separate builds with separate
 * import statements, and only one of them being lazy would be a bug that
 * reaches exactly half of consumers.
 */
const loadProbe = `
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const expect = {
  paperlab: 'Paper',
  'paperlab/stage': 'PaperStage',
  'paperlab/fx': 'DamageField',
}

for (const [specifier, name] of Object.entries(expect)) {
  try {
    const m = await import(specifier)
    if (!m[name]) throw new Error(\`imported, but exports no \${name}\`)
    console.log(\`OK import '\${specifier}' — \${Object.keys(m).length} exports\`)
  } catch (e) {
    console.log(\`FAIL import '\${specifier}' — \${e.code ?? ''} \${e.message.split('\\n')[0]}\`)
  }
  try {
    const m = require(specifier)
    if (!m[name]) throw new Error(\`required, but exports no \${name}\`)
    console.log(\`OK require('\${specifier}') — \${Object.keys(m).length} exports\`)
  } catch (e) {
    console.log(\`FAIL require('\${specifier}') — \${e.code ?? ''} \${e.message.split('\\n')[0]}\`)
  }
}
`

consumer('Pass 1 — required peers only (the optional two absent, as declared)', REQUIRED, loadProbe)

/**
 * Pass 2. The lazy module has to be reachable when the peers ARE there.
 *
 * `GradeLazy` catches a failed import so that a missing peer degrades to an
 * ungraded stage instead of a crash — which means a genuinely broken dynamic
 * import (wrong path, chunk missing from the tarball) would be swallowed by
 * the same catch and never seen by anyone. So resolve the chunk directly and
 * import it, without the catch in the way.
 */
const gradeProbe = `
import { createRequire } from 'node:module'
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
const require = createRequire(import.meta.url)

try {
  await import('paperlab/stage')
  console.log('OK stage imports with the optional peers present too')
} catch (e) {
  console.log(\`FAIL stage import — \${e.code ?? ''} \${e.message.split('\\n')[0]}\`)
}

// The ESM build code-splits the graded pass into its own chunk. Find it by the
// specifier it is the only file to name, then load it — if it is missing from
// the tarball or names something unresolvable, this is where that shows up.
try {
  const dist = dirname(require.resolve('paperlab/stage'))
  const chunks = readdirSync(dist).filter((f) => f.startsWith('Grade') && f.endsWith('.js'))
  if (chunks.length !== 1) throw new Error(\`expected one Grade chunk in dist, found \${chunks.length}\`)
  const mod = await import(pathToFileURL(join(dist, chunks[0])).href)
  if (typeof mod.Grade !== 'function') throw new Error('the chunk exports no Grade component')
  console.log(\`OK the print pass loads on demand (\${chunks[0]})\`)
} catch (e) {
  console.log(\`FAIL the print pass cannot load — \${e.message.split('\\n')[0]}\`)
}
`

consumer('Pass 2 — optional peers installed as well', [...REQUIRED, ...OPTIONAL], gradeProbe)

rmSync(tarball, { force: true })

console.log()
if (failures > 0) {
  console.error(
    `${failures} check${failures === 1 ? '' : 's'} failed — the published package does not install clean.`,
  )
  process.exit(1)
}
console.log('Consumer install is clean: every entry point loads with only the required peers.')
