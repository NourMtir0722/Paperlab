#!/usr/bin/env node
/**
 * Screenshots the editor UI itself, one shot per mode. The stage renders
 * were never the question — whether the editor exposes any of it was, and
 * that only a picture of the actual interface can answer.
 * Run: `pnpm shot:ui`.
 */
import { resolve } from 'node:path'
import { chromium } from 'playwright'
import { shotsDir, startApp } from './harness.mjs'

const PORT = 5202
const outDir = shotsDir()

const { base, stop } = await startApp('editor', PORT)

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

  for (const mode of process.argv.slice(2).length ? process.argv.slice(2) : ['Stage']) {
    await page.getByRole('button', { name: mode, exact: true }).click()
    await page.waitForTimeout(2500)
    // The coach mark is a first-visit hint that parks itself over the tool
    // cluster. It is real UI, but it is transient, and a screenshot of the
    // editor should show the editor rather than its onboarding.
    const tip = page.getByRole('button', { name: 'Dismiss this tip' })
    if (await tip.count()) {
      await tip.first().click()
      await page.waitForTimeout(400)
    }
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
  stop()
}
