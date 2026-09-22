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
 * in the signpost's nav, because the redirect only knows about the editor
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
function route({ search = '', hash = '', mouse = true, referrer = '' }) {
  let destination = null
  const window = {
    location: { search, hash, hostname: 'paperlab.nawwara.studio', replace: (url) => (destination = url) },
    // Only one query is asked now, and it is asked by name rather than by
    // substring: `(any-pointer: fine)` contains `pointer: fine`, so a loose
    // matcher answers both with the same value and the test stops testing.
    matchMedia: (query) => {
      if (query !== '(any-pointer: fine)') throw new Error(`unexpected media query: ${query}`)
      return { matches: mouse }
    },
  }
  new Function('window', 'document', script[1])(window, { referrer })
  return destination
}

const SCULPT = '?p=eyJwIjoicmVjZWlwdC11bnJvbGwifQ'

const cases = [
  // The whole point of the change: there is one app, and everything with a
  // pointer lands in it. No second destination to leak traffic into.
  ['a laptop lands in the editor', { mouse: true }, '/editor/'],

  // A phone is not sent anywhere: the card on the root IS the page for it,
  // and it costs nothing to load. `null` is the script declining to move.
  ['a phone stays on the signpost', { mouse: false }, null],
  ['a tablet stays on the signpost', { mouse: false }, null],

  // Except when a link named the editor itself. Someone sent this exact
  // thing on purpose, from whatever they were holding.
  ['a shared sculpt opens in the editor', { search: SCULPT, mouse: true }, `/editor/${SCULPT}`],
  ['a shared sculpt opens on a phone too', { search: SCULPT, mouse: false }, `/editor/${SCULPT}`],
  ['the hash survives the hop', { search: '?p=abc', hash: '#top', mouse: true }, '/editor/?p=abc#top'],

  // Nothing else in the address rides along. Campaign tags were carried for
  // an analytics tool that read them; Cloudflare's does not.
  ['utm does not look like a share', { search: '?utm_source=x', mouse: true }, '/editor/'],
  ['anything else is left behind', { search: '?junk=1', mouse: true }, '/editor/'],
  // A dead playground share is not a share any more. It loses its scene,
  // which is the cost of removing the route, and it still lands somewhere.
  ['a dead playground link still lands', { search: '?s=eyJwIjoibmF2ZSJ9', mouse: true }, '/editor/'],

  // And no referrer is invented: the page sets no-referrer, so the one it
  // came in with goes nowhere.
  ['the referrer is not handed on', { referrer: 'https://t.co/abc', mouse: true }, '/editor/'],
]

let failed = 0
for (const [name, input, expected] of cases) {
  const got = route(input)
  const ok = got === expected
  if (!ok) failed++
  console.log(
    `${ok ? '  ok  ' : '  FAIL'} ${name.padEnd(36)} → ${got ?? 'stays put'}${
      ok ? '' : `   (expected ${expected ?? 'stays put'})`
    }`,
  )
}

console.log(failed ? `\n${failed} of ${cases.length} routes wrong` : `\nall ${cases.length} routes correct`)

// ── The device question is not a width ─────────────────────────────────────
//
// This is the bug that cost the playground its route. The root used to ask
// `(min-width: 1024px)`, which is a CSS width: a laptop at 125% zoom reports
// 1024 and at 150% reports 853, so zooming in on a real desktop machine sent
// it to the phone app. Nobody notices, because it looks like a choice.
//
// A case in the table above cannot catch a regression to that — it would
// just be another row saying "editor". So assert on the QUESTION instead:
// the script is handed a matchMedia that records what it is asked, and any
// width in there fails. The matcher in `route()` above is stricter still
// and throws, which is what keeps this honest while both exist.
const asked = []
new Function('window', 'document', script[1])(
  {
    location: { search: '', hash: '', replace: () => {} },
    matchMedia: (query) => {
      asked.push(query)
      return { matches: true }
    },
  },
  { referrer: '' },
)
const widths = asked.filter((q) => /width/i.test(q))
if (widths.length) {
  console.error(`\n  FAIL the root picks by width again: ${widths.join(', ')}`)
  console.error('       a laptop at 125% zoom is narrower than 1024px and is still a laptop')
  failed++
} else {
  console.log(`  ok   the root asks about the pointer, not the width (${asked.join(', ') || 'nothing'})`)
}

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
