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
import { spawn } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const PORT = 5207
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const soft = process.argv.includes('--soft')

const server = spawn('pnpm', ['--filter', '@paperlab/editor', 'exec', 'vite', '--port', String(PORT)], {
  stdio: 'pipe',
  cwd: root,
})
const kill = () => server.kill('SIGTERM')
process.on('exit', kill)

const base = `http://localhost:${PORT}`
for (let i = 0; i < 60; i++) {
  try {
    await fetch(base)
    break
  } catch {
    await new Promise((r) => setTimeout(r, 500))
  }
}

/**
 * Which renderer to ask for.
 *
 * The default was never a choice anyone made: bare headless Chromium hands
 * out **SwiftShader**, its CPU rasterizer, and this harness used to label
 * that "native GPU" because it was reporting the flag it had been given
 * rather than the driver that answered. Every stage number this repo has
 * ever recorded came from a software rasterizer.
 *
 * `--gpu` asks ANGLE for the platform backend and actually gets it, headless
 * — Metal on macOS, and the equivalent elsewhere. Both are worth having:
 * `--soft` is the weak-machine floor to design against, `--gpu` is what a
 * visitor with a laptop will see. The line at the end of the run says which
 * one answered, so a number can never be read as the other again.
 */
const renderer = process.argv.includes('--gpu')
  ? [
      '--use-angle=metal',
      '--enable-gpu',
      '--ignore-gpu-blocklist',
      // Without these the frame time IS the refresh interval and every case
      // reads 8.3 ms on a 120 Hz panel, which measures the display rather
      // than the scene. Uncapped, the number is what the frame actually
      // costs — which is the only form of it worth comparing anything to.
      '--disable-gpu-vsync',
      '--disable-frame-rate-limit',
    ]
  : soft
    ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
    : []

const browser = await chromium.launch({ args: renderer })

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

console.log(
  `requested: ${process.argv.includes('--gpu') ? 'the platform GPU' : soft ? 'swiftshader (CPU — weak-machine floor)' : 'default (whatever Chromium picks — usually SwiftShader)'}\n`,
)
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
    const sorted = perf.frames.slice().sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)]
    const p95 = sorted[Math.floor(sorted.length * 0.95)]
    console.log(
      label.padEnd(30),
      `${median.toFixed(1)}ms`.padStart(9),
      `${p95.toFixed(1)}ms`.padStart(9),
      (1000 / median).toFixed(0).padStart(7),
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
  kill()
}
