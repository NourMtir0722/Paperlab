#!/usr/bin/env node
/**
 * Screenshots the editor UI itself, one shot per mode. The stage renders
 * were never the question — whether the editor exposes any of it was, and
 * that only a picture of the actual interface can answer.
 * Run: `pnpm shot:ui`.
 */
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const PORT = 5202
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = resolve(root, '.shots')

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
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  const problems = []
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(m.text())
  })
  page.on('pageerror', (e) => problems.push(String(e)))

  await page.goto(base, { waitUntil: 'networkidle' })
  mkdirSync(outDir, { recursive: true })

  for (const mode of process.argv.slice(2).length ? process.argv.slice(2) : ['Stage']) {
    await page.getByRole('button', { name: mode, exact: true }).click()
    await page.waitForTimeout(2500)
    const out = resolve(outDir, `editor-${mode.toLowerCase()}.png`)
    await page.screenshot({ path: out })
    console.log(`shot → ${out}`)
  }

  if (problems.length > 0) {
    console.error(`\n${problems.length} console error(s):`)
    for (const p of problems.slice(0, 12)) console.error(`  ${p}`)
    process.exitCode = 1
  } else {
    console.log('no console errors')
  }
} finally {
  await browser.close()
  kill()
}
