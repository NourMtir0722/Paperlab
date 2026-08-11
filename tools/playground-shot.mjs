#!/usr/bin/env node
/**
 * Screenshots the playground. It is the launch surface, so "does it look
 * like something you'd want to share" is the only question that matters
 * about it, and only a picture answers that. Run: `pnpm shot:play`.
 */
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const PORT = 5206
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = resolve(root, '.shots')

const server = spawn('pnpm', ['--filter', '@paperlab/playground', 'exec', 'vite', '--port', String(PORT)], {
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
  const problems = []
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(m.text())
  })
  page.on('pageerror', (e) => problems.push(String(e)))

  const query = process.argv.slice(2).find((a) => a.startsWith('?')) ?? ''
  await page.goto(base + query, { waitUntil: 'networkidle' })
  await page.waitForTimeout(3000)
  mkdirSync(outDir, { recursive: true })
  await page.screenshot({ path: resolve(outDir, 'playground.png') })
  console.log(`shot → ${resolve(outDir, 'playground.png')}`)

  // The share round-trip is the whole persistence model; check the address
  // bar actually carries the scene.
  const url = page.url()
  console.log(url.includes('?s=') ? 'url carries the scene' : 'NO SCENE IN URL')

  if (problems.length > 0) {
    console.error(`\n${problems.length} console error(s):`)
    for (const p of problems.slice(0, 10)) console.error(`  ${p}`)
    process.exitCode = 1
  } else {
    console.log('no console errors')
  }
} finally {
  await browser.close()
  kill()
}
