#!/usr/bin/env node
/**
 * GPU golden-vector parity gate: boots the editor dev server, loads
 * /parity.html in headless Chromium, and fails if any deformer's GLSL
 * implementation drifts from its JS twin. Run: `pnpm test:parity`.
 */
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

const PORT = 5199
const server = spawn('pnpm', ['--filter', '@paperlab/editor', 'exec', 'vite', '--port', String(PORT)], {
  stdio: 'pipe',
})

const kill = () => {
  server.kill('SIGTERM')
}
process.on('exit', kill)

// Wait for vite to answer.
const base = `http://localhost:${PORT}`
for (let i = 0; i < 60; i++) {
  try {
    await fetch(base)
    break
  } catch {
    await new Promise((r) => setTimeout(r, 500))
  }
}

// CI runners have no GPU; force software WebGL via SwiftShader.
const browser = await chromium.launch({
  args: process.env.CI ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [],
})
try {
  const page = await browser.newPage()
  await page.goto(`${base}/parity.html`, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => window.__PARITY__ !== undefined, { timeout: 30_000 })
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
  kill()
}
