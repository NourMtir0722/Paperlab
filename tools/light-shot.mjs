#!/usr/bin/env node
/**
 * Photographs one paper preset under one lighting preset.
 *
 * Calibration needs eyes. Every other harness here either shoots the stage
 * or records a motion loop; nothing could answer "what does `raking`
 * actually do to a sheet of newsprint?" without a human opening the editor.
 * A preset is data, and this makes it data you can look at.
 *
 *   node tools/light-shot.mjs --lighting=raking --preset=vintage-note
 *   node tools/light-shot.mjs --all --preset=typed-note   # every rig, one run
 */
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
import { root, shotsDir, startApp } from './harness.mjs'

const PORT = 5209

const RIGS = ['studio', 'window', 'leaves', 'goldenhour', 'noir', 'nave', 'raking', 'lightbox']

const args = new URLSearchParams()
let all = false
let outDir = shotsDir()
for (const arg of process.argv.slice(2)) {
  const [key, value = ''] = arg.replace(/^--/, '').split('=')
  if (key === 'all') all = true
  else if (key === 'outDir') outDir = resolve(root, value)
  else args.set(key, value)
}
const rigs = all ? RIGS : [args.get('lighting') ?? 'studio']
const preset = args.get('preset') ?? 'typed-note'

const { base, stop } = await startApp('editor', PORT)

const browser = await chromium.launch()
try {
  mkdirSync(outDir, { recursive: true })
  const page = await browser.newPage({ viewport: { width: 620, height: 620 } })
  const problems = []
  page.on('console', (m) => m.type() === 'error' && problems.push(m.text()))
  page.on('pageerror', (e) => problems.push(String(e)))

  for (const rig of rigs) {
    const q = new URLSearchParams(args)
    q.set('lighting', rig)
    q.set('preset', preset)
    await page.goto(`${base}/media.html?${q}`, { waitUntil: 'networkidle' })
    await page.waitForFunction(() => window.__MEDIA__?.ready === true, { timeout: 20_000 })
    await page.waitForTimeout(700)
    const out = resolve(outDir, `light-${rig}-${preset}.png`)
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
