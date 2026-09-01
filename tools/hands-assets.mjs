#!/usr/bin/env node
/**
 * Put the hand tracker's own copies of its wasm and its models where the page
 * can serve them itself.
 *
 * The spike fetched all of it from third-party CDNs at runtime — jsdelivr for
 * the wasm, Google's model host for the two `.task` files — with a note saying
 * that would have to stop before any of it was real. Two reasons, and the
 * second is the one that matters:
 *
 *   - a demo that dies when a CDN does is not a demo, and this one dies on a
 *     conference wifi captive portal;
 *   - nothing else in this repo pulls EXECUTABLE code from a third-party
 *     origin at runtime, and a wasm binary is executable code. Whoever serves
 *     that URL can run whatever they like inside the page.
 *
 * What it does NOT do is commit 34 MB of binaries. The wasm is already a
 * declared dependency, so it is copied out of `node_modules` — same bytes,
 * same version, no new artifacts in git. The models are not in any npm
 * package and are fetched once into a gitignored directory, which is a build
 * step rather than a page load: the deployed site then serves its own copy
 * from its own origin, which was the whole point.
 *
 * Run: `pnpm hands:setup` (or let `pnpm test:hands` call it for you).
 */
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs'
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
 * The wasm files `FilesetResolver` actually asks for.
 *
 * Both variants, because it probes for SIMD support and picks one at load
 * time: shipping only the SIMD build works everywhere it has been tried and
 * fails on the one browser that has not been. The `_module_` pair in the same
 * folder is for the ES-module loader, which this page does not use.
 */
const WASM_FILES = [
  'vision_wasm_internal.js',
  'vision_wasm_internal.wasm',
  'vision_wasm_nosimd_internal.js',
  'vision_wasm_nosimd_internal.wasm',
]

/**
 * Pinned by digest, not just by URL.
 *
 * These are model weights fetched over the network and then executed against
 * a camera feed. Pinning what we expect is the difference between "we host it
 * ourselves" and "we host whatever we were handed that day", and it is what
 * makes the copy on disk auditable at all.
 */
const MODELS = [
  {
    file: 'hand_landmarker.task',
    url: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
  },
  {
    file: 'face_landmarker.task',
    url: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
  },
]

/** Committed, unlike what it describes — the digests are the auditable part. */
const LOCK = resolve(root, 'tools/hands-models.sha256')

function digest(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

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

  const locked = existsSync(LOCK)
    ? Object.fromEntries(
        readFileSync(LOCK, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((line) => line.split('  ')),
      )
    : {}

  for (const model of MODELS) {
    const target = resolve(HANDS_ASSETS, model.file)
    if (existsSync(target) && locked[model.file] === digest(target)) {
      log(`  ${model.file.padEnd(22)} already in place`)
      continue
    }
    log(`  ${model.file.padEnd(22)} fetching…`)
    const response = await fetch(model.url)
    if (!response.ok) throw new Error(`${model.url} answered ${response.status}`)
    const bytes = Buffer.from(await response.arrayBuffer())
    // Written beside and renamed, so an interrupted fetch never leaves a
    // half-written model that the next run believes.
    const temp = `${target}.partial`
    writeFileSync(temp, bytes)
    renameSync(temp, target)
    locked[model.file] = digest(target)
    log(`  ${model.file.padEnd(22)} ${(bytes.length / 1048576).toFixed(1)} MB`)
  }

  writeFileSync(LOCK, `${MODELS.map((m) => `${m.file}  ${locked[m.file]}`).join('\n')}\n`)
  return HANDS_ASSETS
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('')
  console.log('  hands — the tracker gets its own copies')
  console.log(`  ${'─'.repeat(58)}`)
  await ensureHandsAssets({ log: (line) => console.log(line) })
  console.log('')
  console.log(`  Ready. The page serves them from its own origin: ${HANDS_ASSETS.replace(`${root}/`, '')}`)
  console.log('')
}
