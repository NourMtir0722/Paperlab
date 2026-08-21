#!/usr/bin/env node
/**
 * Renders one frame of stage mode headless and writes a PNG. This is the
 * check the unit suite structurally cannot do — whether the shaders compile
 * on a real GPU and whether the scene looks like the thing it was built to
 * look like. Run: `pnpm shot`, or `pnpm shot --shot=low --walked=14 --out=x.png`.
 */
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const PORT = 5201
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const args = new URLSearchParams()
let out = resolve(root, '.shots/stage.png')
// Composition is a function of the frame it is composed in: a stage that
// reads in a tall panel can be all empty sky in a 16:9 hero. Default stays
// portrait so old shots stay comparable; `--w=1600 --h=900` judges the other.
const viewport = { width: 1280, height: 1600 }
for (const arg of process.argv.slice(2)) {
  const [key, value = ''] = arg.replace(/^--/, '').split('=')
  if (key === 'out') out = resolve(root, value)
  else if (key === 'w') viewport.width = Number(value)
  else if (key === 'h') viewport.height = Number(value)
  else args.set(key, value)
}

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
  args: process.env.CI ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [],
})
try {
  const page = await browser.newPage({ viewport })
  // Shader compile failures surface as console errors, not exceptions —
  // a silently black canvas is exactly the bug this harness has to catch.
  const problems = []
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(m.text())
  })
  page.on('pageerror', (e) => problems.push(String(e)))

  await page.goto(`${base}/stage.html?${args}`, { waitUntil: 'networkidle' })
  let rendered = true
  try {
    await page.waitForFunction(() => window.__STAGE__?.ready === true, { timeout: 20_000 })
  } catch {
    // Screenshot anyway — a frame that never arrived is itself the evidence.
    rendered = false
  }
  // Let the idle motion settle into a pose worth looking at.
  await page.waitForTimeout(1200)

  mkdirSync(dirname(out), { recursive: true })
  await page.screenshot({ path: out })
  console.log(`shot → ${out}`)

  if (!rendered) {
    console.error('the scene never rendered a frame')
    process.exitCode = 1
  }
  if (problems.length > 0) {
    console.error(`\n${problems.length} console error(s):`)
    for (const p of problems.slice(0, 12)) console.error(`  ${p}`)
    process.exitCode = 1
  } else {
    console.log('no console errors — shaders compiled')
  }
} finally {
  await browser.close()
  kill()
}
