#!/usr/bin/env node
/**
 * Photographs one axis of the catalogue, one frame per value.
 *
 * Calibration needs eyes. Every other harness here either shoots the stage
 * or records a motion loop; nothing could answer "what does `raking`
 * actually do to a sheet of newsprint?", or "what does `rack` look like next
 * to `spread`?", without a human opening the editor and clicking. These are
 * all data, and this makes them data you can look at — side by side, which
 * is the only way a catalogue means anything. Feed the output to
 * `contact-sheet.mjs` to get the comparison in one image.
 *
 * `--vary` names the query parameter to sweep; every other `--flag=value` is
 * passed to the media harness untouched.
 *
 *   node tools/catalogue-shot.mjs --vary=lighting --all --preset=vintage-note
 *   node tools/catalogue-shot.mjs --vary=layout --values=ring,fan,pile \
 *     --mode=field --preset=blank-sheet --w=900 --h=620
 *   node tools/catalogue-shot.mjs --vary=stock --values=kraft,newsprint
 */
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
import { root, shotsDir, startApp } from './harness.mjs'

const PORT = 5209

/** `--all` on an axis that has a known full set expands to that set. */
const ALL = {
  lighting: ['studio', 'window', 'leaves', 'goldenhour', 'noir', 'nave', 'raking', 'lightbox'],
  layout: [
    'ring',
    'fan',
    'spread',
    'pile',
    'wall',
    'spill',
    'sweep',
    'book',
    'accordion',
    'rack',
    'colonnade',
    'sheet',
  ],
  stock: ['printer', 'thermal', 'kraft', 'newsprint', 'vellum', 'photo-gloss', 'sticker'],
}

const args = new URLSearchParams()
const viewport = { width: 620, height: 620 }
let all = false
let vary = 'lighting'
let values = null
let outDir = shotsDir()
for (const arg of process.argv.slice(2)) {
  const [key, value = ''] = arg.replace(/^--/, '').split('=')
  if (key === 'all') all = true
  else if (key === 'vary') vary = value
  else if (key === 'values') values = value.split(',').filter(Boolean)
  else if (key === 'w') viewport.width = Number(value)
  else if (key === 'h') viewport.height = Number(value)
  else if (key === 'outDir') outDir = resolve(root, value)
  else args.set(key, value)
}

if (all && !ALL[vary]) {
  throw new Error(`[catalogue-shot] --all needs a known axis (${Object.keys(ALL).join(', ')}), got "${vary}"`)
}
const sweep = values ?? (all ? ALL[vary] : [args.get(vary) ?? ALL[vary]?.[0]].filter(Boolean))
if (sweep.length === 0) throw new Error(`[catalogue-shot] nothing to sweep for --vary=${vary}`)
const preset = args.get('preset') ?? 'typed-note'

const { base, stop } = await startApp('editor', PORT)

const browser = await chromium.launch()
try {
  mkdirSync(outDir, { recursive: true })
  const page = await browser.newPage({ viewport })
  const problems = []
  page.on('console', (m) => m.type() === 'error' && problems.push(m.text()))
  page.on('pageerror', (e) => problems.push(String(e)))

  for (const value of sweep) {
    const q = new URLSearchParams(args)
    q.set(vary, value)
    q.set('preset', preset)
    await page.goto(`${base}/media.html?${q}`, { waitUntil: 'networkidle' })
    await page.waitForFunction(() => window.__MEDIA__?.ready === true, { timeout: 20_000 })
    await page.waitForTimeout(700)
    const out = resolve(outDir, `${vary}-${value}-${preset}.png`)
    await page.screenshot({ path: out })
    console.log(`shot → ${out}`)
  }

  if (problems.length) {
    console.error(`\n${problems.length} console error(s):`)
    for (const p of problems.slice(0, 8)) console.error(`  ${p}`)
    process.exitCode = 1
  }
} finally {
  await browser.close()
  stop()
}
