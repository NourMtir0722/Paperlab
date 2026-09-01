#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Where the files live. Gitignored, and deliberately NOT under `public/`:
 * Vite copies that directory into `dist` wholesale, for every build, whether
 * or not the page using it was one of the entry points — which put 36 MB of
 * models into a 4 MB deploy for a page that is not even emitted. A dev-server
 * middleware serves them from here instead (`apps/editor/vite.config.ts`),
 * and a build only copies them if `hands.html` is actually being built.
 */
export const HANDS_ASSETS = resolve(root, 'apps/editor/.hands')

/**
 * The wasm files `FilesetResolver` asks for.
 *
 * The SIMD build only. `FilesetResolver` probes for SIMD and would ask for
 * the no-SIMD pair without it — another 11 MB in the deploy to serve browsers
 * that have not existed since 2021 (Chrome 91, Firefox 89, Safari 16.4). It
 * fails loudly rather than silently if one turns up, which is the right way
 * round for a demo. The `_module_` pair is for the ES-module loader, which
 * this page does not use.
 */
const WASM_FILES = ['vision_wasm_internal.js', 'vision_wasm_internal.wasm']

function wasmSource() {
  for (const base of ['apps/editor/node_modules', 'node_modules']) {
    const dir = resolve(root, base, '@mediapipe/tasks-vision/wasm')
    if (existsSync(dir)) return dir
  }
  throw new Error('@mediapipe/tasks-vision is not installed — run `pnpm install` first')
}

/**
 * Make sure everything is in place. Cheap and idempotent: a file that is
 * already there at the right size is left alone, so this is safe to call from
 * a test harness on every run.
 */
export async function ensureHandsAssets({ log = () => {} } = {}) {
  mkdirSync(HANDS_ASSETS, { recursive: true })

  const from = wasmSource()
  let copied = 0
  for (const file of WASM_FILES) {
    const source = resolve(from, file)
    const target = resolve(HANDS_ASSETS, file)
    if (existsSync(target) && statSync(target).size === statSync(source).size) continue
    copyFileSync(source, target)
    copied++
  }
  log(
    copied
      ? `  wasm      copied ${copied} file${copied === 1 ? '' : 's'} from node_modules`
      : '  wasm      already in place',
  )

  return HANDS_ASSETS
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('')
  console.log('  hands — the tracker gets its own copy of the wasm')
  console.log(`  ${'─'.repeat(58)}`)
  await ensureHandsAssets({ log: (line) => console.log(line) })
  console.log('')
  console.log(`  Ready: ${HANDS_ASSETS.replace(`${root}/`, '')}`)
  console.log('  Models are NOT vendored — the page links to Google for those. See the note above.')
  console.log('')
}
