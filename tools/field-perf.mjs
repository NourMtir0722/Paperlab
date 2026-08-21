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
import { spawn } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const PORT = 5208
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

// photo-print is the field starter (a bend, 16 segments); crumpled-note is the
// new expensive one (72). Same layout and counts, so the difference is the
// deformer and nothing else.
// Both presets carry TEXT, not a remote image: photo-print's content is an
// Unsplash URL, which makes the number depend on the network and on a large
// texture upload rather than on the geometry we are trying to measure.
// typed-note has no deformer at all; crumpled-note has crumple and its 72
// segments. The delta between them is the deformer and nothing else.
const CASES = [
  ['typed-note ×20 (no deformer)', 'typed-note', 20],
  ['typed-note ×60', 'typed-note', 60],
  ['crumpled-note ×20', 'crumpled-note', 20],
  ['crumpled-note ×60', 'crumpled-note', 60],
]

console.log(
  `requested: ${process.argv.includes('--gpu') ? 'the platform GPU' : soft ? 'swiftshader (CPU — weak-machine floor)' : 'default (whatever Chromium picks — usually SwiftShader)'}\n`,
)
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
      await page.waitForFunction(() => window.__FIELD_PERF__?.done === true, { timeout: 180_000 })
    } catch {
      console.log(`${label.padEnd(30)} ${'timed out'.padStart(9)}`)
      await page.close()
      continue
    }
    const perf = await page.evaluate(() => window.__FIELD_PERF__)
    const sorted = perf.frames.slice().sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)]
    const p95 = sorted[Math.floor(sorted.length * 0.95)]
    reportedRenderer = perf.renderer ?? reportedRenderer
    console.log(
      label.padEnd(30),
      `${median.toFixed(1)}ms`.padStart(9),
      `${p95.toFixed(1)}ms`.padStart(9),
      (1000 / median).toFixed(0).padStart(6),
      String(perf.triangles ?? '—').padStart(10),
      String(perf.drawCalls ?? '—').padStart(6),
    )
    await page.close()
  }
  console.log(`\nactually drawn by: ${reportedRenderer}`)
} finally {
  await browser.close()
  kill()
}
