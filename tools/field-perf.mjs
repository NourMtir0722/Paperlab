#!/usr/bin/env node
/**
 * Measures what a field actually costs to draw.
 *
 * "N papers, one instanced draw call" is true and is not the whole story: the
 * vertex cost is per sheet, and each deformer asks for the grid density its
 * creases need. `crumple` asks for 72 segments — roughly twenty times the
 * triangles of a plain bend — and evaluates nine cells per probe, three
 * probes per vertex for the normal. This is the harness that turns that from
 * an argument into a number.
 *
 *   pnpm perf:field           # whatever Chromium picks (usually SwiftShader)
 *   pnpm perf:field --gpu     # the real platform GPU
 *   pnpm perf:field --soft    # SwiftShader: the weak-machine floor
 */
import { chromium } from 'playwright'
import { frameStats, rendererArgs, rendererRequested, startApp } from './harness.mjs'

const PORT = 5208

const { base, stop } = await startApp('editor', PORT)

const browser = await chromium.launch({ args: rendererArgs() })

// Same layout and counts throughout, so the delta between the two presets is
// the deformer and nothing else: typed-note has none, crumpled-note has
// crumple and the 72 segments a crease network needs.
//
// Both carry TEXT rather than a remote image. photo-print would have been the
// obvious "starter" case, but its content is an Unsplash URL — the number
// would then depend on the network and on a large texture upload instead of
// on the geometry this harness exists to measure.
const CASES = [
  ['typed-note ×20 (no deformer)', 'typed-note', 20],
  ['typed-note ×60', 'typed-note', 60],
  ['crumpled-note ×20', 'crumpled-note', 20],
  ['crumpled-note ×60', 'crumpled-note', 60],
]

console.log(`requested: ${rendererRequested()}\n`)
console.log(
  'case'.padEnd(30),
  'median'.padStart(9),
  'p95'.padStart(9),
  'fps'.padStart(6),
  'tris'.padStart(10),
  'calls'.padStart(6),
)

let reportedRenderer = 'unknown'

try {
  for (const [label, preset, count] of CASES) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    await page.goto(`${base}/field.html?preset=${preset}&count=${count}`, { waitUntil: 'networkidle' })
    try {
      await page.waitForFunction(() => window.__PERF__?.done === true, { timeout: 180_000 })
    } catch {
      console.log(`${label.padEnd(30)} ${'timed out'.padStart(9)}`)
      await page.close()
      continue
    }
    const perf = await page.evaluate(() => window.__PERF__)
    const { median, p95, fps } = frameStats(perf.frames)
    reportedRenderer = perf.renderer ?? reportedRenderer
    console.log(
      label.padEnd(30),
      `${median.toFixed(1)}ms`.padStart(9),
      `${p95.toFixed(1)}ms`.padStart(9),
      fps.toFixed(0).padStart(6),
      String(perf.triangles ?? '—').padStart(10),
      String(perf.drawCalls ?? '—').padStart(6),
    )
    await page.close()
  }
  console.log(`\nactually drawn by: ${reportedRenderer}`)
} finally {
  await browser.close()
  stop()
}
