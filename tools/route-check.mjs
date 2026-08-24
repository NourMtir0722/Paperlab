#!/usr/bin/env node
/**
 * Checks the site root's device routing.
 *
 * The root is the URL everyone shares, and a script inside an HTML file is
 * the one bit of the site nothing else type-checks or renders — a typo there
 * sends every launch visitor to the wrong app, silently. So pull the script
 * out of the page and run the real thing against fake locations.
 *
 * Runs in CI as `pnpm test:route`.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const html = readFileSync(resolve(root, 'tools/site-root.html'), 'utf8')

const script = html.match(/<script>([\s\S]*?)<\/script>/)
if (!script) {
  console.error('site-root.html has no redirect script — the root would strand every visitor')
  process.exit(1)
}

/** Runs the page's own script against a fake window and reports where it sent us. */
function route({ search = '', hash = '', width = 1440, pointer = 'fine' }) {
  let destination = null
  const window = {
    location: { search, hash, replace: (url) => (destination = url) },
    matchMedia: (query) => ({
      matches: query.includes('min-width: 1024px')
        ? width >= 1024
        : query.includes('pointer: fine')
          ? pointer === 'fine'
          : false,
    }),
  }
  new Function('window', script[1])(window)
  return destination
}

const SCENE = '?s=eyJwIjoibmF2ZSJ9'

const cases = [
  // The whole point: the editor has no mobile layout, the playground does.
  ['desktop lands in the editor', { width: 1440, pointer: 'fine' }, '/editor/'],
  ['phone lands in the playground', { width: 390, pointer: 'coarse' }, '/playground/'],
  ['touch tablet is not a desktop', { width: 1024, pointer: 'coarse' }, '/playground/'],
  ['a narrow window is not either', { width: 900, pointer: 'fine' }, '/playground/'],

  // A shared link named its destination on purpose; the guess must not win.
  ['a shared scene opens on desktop', { search: SCENE, width: 1440 }, `/playground/${SCENE}`],
  [
    'a shared scene opens on a phone',
    { search: SCENE, width: 390, pointer: 'coarse' },
    `/playground/${SCENE}`,
  ],
  ['a shared sculpt opens in the editor', { search: '?p=abc', width: 1440 }, '/editor/?p=abc'],
  ['the hash survives the hop', { search: '?s=xyz', hash: '#top', width: 1440 }, '/playground/?s=xyz#top'],

  // A campaign tag is not a share link, so the device still decides.
  ['utm does not look like a share', { search: '?utm_source=x', width: 1440 }, '/editor/'],
  [
    'utm on a phone still routes by device',
    { search: '?utm_source=x', width: 390, pointer: 'coarse' },
    '/playground/',
  ],
]

let failed = 0
for (const [name, input, expected] of cases) {
  const got = route(input)
  const ok = got === expected
  if (!ok) failed++
  console.log(
    `${ok ? '  ok  ' : '  FAIL'} ${name.padEnd(36)} → ${got}${ok ? '' : `   (expected ${expected})`}`,
  )
}

console.log(failed ? `\n${failed} of ${cases.length} routes wrong` : `\nall ${cases.length} routes correct`)
process.exit(failed ? 1 : 0)
