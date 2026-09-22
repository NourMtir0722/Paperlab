#!/usr/bin/env node
/**
 * GPU golden-vector parity gate: boots the editor dev server, loads
 * /parity.html in headless Chromium, and fails if any deformer's GLSL
 * implementation drifts from its JS twin. Run: `pnpm test:parity`.
 */
import { chromium } from 'playwright'
import { startApp } from './harness.mjs'

const PORT = 5199
const { base, stop } = await startApp('editor', PORT)

// Software WebGL via SwiftShader, everywhere. CI runners have no GPU, and
// headless Chromium on a laptop often has none it will use either: without
// these the harness page never finishes and the gate times out with nothing
// to say, which is why it was reputed to be unrunnable locally. Forcing one
// rasterizer also means a laptop and CI compare the same numbers.
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
try {
  const page = await browser.newPage()
  await page.goto(`${base}/parity.html`, { waitUntil: 'networkidle' })
  // The options go in the THIRD argument. waitForFunction takes (fn, arg,
  // options), so an options object in the second slot is passed to the page as
  // the function's argument and every setting in it is silently ignored — the
  // old call read as a 30s default that no edit here could change.
  //
  // Poll on a timer rather than on animation frames, because the harness page
  // runs its own render loop and starves a raf-polled wait: the results sat in
  // the page while the wait timed out around them, which is why this gate has
  // been unrunnable on a laptop. Software WebGL is slow, so the ceiling is
  // generous.
  await page.waitForFunction(() => window.__PARITY__ !== undefined, undefined, {
    timeout: 120_000,
    polling: 500,
  })
  const parity = await page.evaluate(() => window.__PARITY__)

  if (parity.error) {
    console.error(`parity harness error: ${parity.error}`)
    process.exitCode = 1
  } else {
    for (const r of parity.results) {
      console.log(`${r.pass ? '✓' : '✗'} ${r.name} — max error ${r.maxError.toExponential(2)}`)
    }
    const failed = parity.results.filter((r) => !r.pass)
    if (failed.length > 0 || parity.results.length === 0) {
      console.error(`\n${failed.length} parity case(s) FAILED`)
      process.exitCode = 1
    } else {
      console.log(`\nall ${parity.results.length} parity cases pass`)
    }
  }
} finally {
  await browser.close()
  stop()
}
