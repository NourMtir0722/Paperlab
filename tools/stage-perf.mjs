#!/usr/bin/env node
/**
 * Measures what a stage actually costs to draw.
 *
 * Nobody developing this owns the machine it has to run on, so the tiers
 * cannot be guessed. `--soft` forces SwiftShader — Chromium's CPU
 * rasterizer — which is a harsher floor than most real weak hardware and
 * therefore a safe one to design against.
 *
 * Run: `pnpm perf` or `pnpm perf --soft`.
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

const browser = await chromium.launch({
  args: soft ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [],
})

const CASES = [
  ['high', '?preset=nave&quality=high'],
  ['medium', '?preset=nave&quality=medium'],
  ['low', '?preset=nave&quality=low'],
  ['low, no shadow pass', '?preset=nave&quality=low&shadows=0'],
  ['archive (44 banners), high', '?preset=archive&quality=high'],
  ['archive (44 banners), low', '?preset=archive&quality=low'],
  ['nave, quality=auto', '?preset=nave&quality=auto'],
  ['archive, quality=auto', '?preset=archive&quality=auto'],
]

console.log(`renderer: ${soft ? 'swiftshader (CPU — weak-machine floor)' : 'native GPU'}\n`)
console.log(
  'case'.padEnd(30),
  'median'.padStart(9),
  'p95'.padStart(9),
  'fps'.padStart(7),
  'settled'.padStart(9),
)

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
} finally {
  await browser.close()
  kill()
}
