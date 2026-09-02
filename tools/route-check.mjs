#!/usr/bin/env node
/**
 * Checks the site root — where it sends you, and what it lets you reach.
 *
 * The root is the URL everyone shares, and a script inside an HTML file is
 * the one bit of the site nothing else type-checks or renders — a typo there
 * sends every launch visitor to the wrong app, silently. So pull the script
 * out of the page and run the real thing against fake locations.
 *
 * Then the other direction: every route `pages.yml` deploys has to be named
 * in the signpost's nav, because the redirect only knows about two of them
 * and a route nothing links to is a route nobody has.
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

// ── Every deployed route is reachable from the signpost ────────────────────
//
// The redirect above is only half of what the root is for. The other half is
// the nav, and it is the half that rots quietly: /hands shipped as a real
// route — built, deployed, copied into site/hands by pages.yml — and for its
// whole life nothing on the site linked to it. A page nobody can reach is a
// page nobody has, and no test noticed, because every test was looking at
// the redirect.
//
// So read the routes out of the WORKFLOW rather than restating them here. A
// list written twice is a list that disagrees with itself; `mkdir -p site/x`
// is the workflow saying "x is a route", and there is exactly one of those
// per route. (`site/media` is images for the npm README and has no mkdir of
// its own, which is what keeps it out of this.)
const workflow = readFileSync(resolve(root, '.github/workflows/pages.yml'), 'utf8')
const deployed = [...workflow.matchAll(/^\s*mkdir -p site\/(\S+)\s*$/gm)].map((m) => m[1])

/**
 * The routes the signpost names — from the `<nav>` ONLY.
 *
 * Scanning the whole page would let any anchor anywhere satisfy this, and
 * "there is an `<a>` somewhere in the file" is not the claim. The claim is
 * that a visitor who lands on the root with the redirect not running sees a
 * way to every route, and that is the nav or it is nothing.
 *
 * Returns null when there is no nav at all, which is its own failure.
 */
function navLinks(page) {
  const nav = page.match(/<nav\b[^>]*>([\s\S]*?)<\/nav>/i)?.[1]
  if (nav === undefined) return null
  return new Set([...nav.matchAll(/<a href="\/([^"]*)"/g)].map((m) => m[1].replace(/\/$/, '')))
}

// The scoping above, asserted rather than trusted: a link outside the nav
// must not count as a signpost.
const decoy = navLinks('<a href="/hands/">not the nav</a><nav><a href="/editor/">e</a></nav>')
if (decoy?.has('hands') !== false) {
  console.error('\nthe link scan is not scoped to the <nav> — an anchor anywhere would satisfy it')
  process.exit(1)
}

const linked = navLinks(html)
if (deployed.length === 0) {
  console.error('\nno routes found in pages.yml — has the site assembly moved?')
  process.exit(1)
}
if (linked === null) {
  console.error('\nsite-root.html has no <nav> — nothing without JS can reach any route')
  process.exit(1)
}

const unreachable = deployed.filter((route) => !linked.has(route))
console.log(`\n${deployed.length} deployed routes: ${deployed.map((r) => `/${r}/`).join(' ')}`)
if (unreachable.length) {
  console.error(
    `  FAIL deployed but nothing links to it: ${unreachable.map((r) => `/${r}/`).join(' ')}\n` +
      '       add it to the <nav> in tools/site-root.html',
  )
  failed++
} else {
  console.log('  ok   every deployed route is named in the signpost')
}

process.exit(failed ? 1 : 0)
