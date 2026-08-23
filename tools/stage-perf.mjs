#!/usr/bin/env node
/**
 * Measures what a stage actually costs to draw.
 *
 * Nobody developing this owns the machine it has to run on, so the tiers
 * cannot be guessed. `--soft` forces SwiftShader — Chromium's CPU
 * rasterizer — which is a harsher floor than most real weak hardware and
 * therefore a safe one to design against.
 *
 * Run: `pnpm perf --gpu` for the real thing, `pnpm perf --soft` for the floor.
 */
import { chromium } from 'playwright'
import { frameStats, rendererArgs, rendererRequested, startApp } from './harness.mjs'

const PORT = 5207

const { base, stop } = await startApp('editor', PORT)

const browser = await chromium.launch({ args: rendererArgs() })

const CASES = [
  ['high', '?preset=nave&quality=high'],
  ['medium', '?preset=nave&quality=medium'],
  ['low', '?preset=nave&quality=low'],
  // What the two new costs are worth, so the trade is a measurement rather
  // than a feeling: the studio light is a texture read per lit fragment, and
  // a shaded figure is one draw call per material on the rig instead of one
  // for the whole silhouette.
  ['medium, no studio light', '?preset=nave&quality=medium&studio=0'],
  ['medium, silhouette figure', '?preset=nave&quality=medium&finish=silhouette'],
  ['archive (44 banners), high', '?preset=archive&quality=high'],
  ['archive (44 banners), low', '?preset=archive&quality=low'],
  ['nave, quality=auto', '?preset=nave&quality=auto'],
  ['archive, quality=auto', '?preset=archive&quality=auto'],
]

console.log(`requested: ${rendererRequested()}\n`)
console.log(
  'case'.padEnd(30),
  'median'.padStart(9),
  'p95'.padStart(9),
  'fps'.padStart(7),
  'settled'.padStart(9),
)

let reportedRenderer = 'unknown'

try {
  for (const [label, query] of CASES) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    await page.goto(`${base}/stage.html${query}`, { waitUntil: 'networkidle' })
    try {
      await page.waitForFunction(() => window.__PERF__?.done === true, { timeout: 150_000 })
    } catch {
      console.log(`${label.padEnd(30)} ${'timed out'.padStart(9)}`)
      await page.close()
      continue
    }
    const perf = await page.evaluate(() => window.__PERF__)
    reportedRenderer = perf.renderer ?? reportedRenderer
    const { median, p95, fps } = frameStats(perf.frames)
    console.log(
      label.padEnd(30),
      `${median.toFixed(1)}ms`.padStart(9),
      `${p95.toFixed(1)}ms`.padStart(9),
      fps.toFixed(0).padStart(7),
      (perf.tier ?? '—').padStart(9),
    )
    await page.close()
  }
  // The launch flags say what was ASKED for; this says what drew it. Headless
  // Chromium hands out SwiftShader far more readily than `--use-gl` suggests,
  // and every tier number above means something different depending on which
  // one answered.
  console.log(`\nactually drawn by: ${reportedRenderer}`)
} finally {
  await browser.close()
  stop()
}
