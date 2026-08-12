#!/usr/bin/env node
/**
 * Drives the community loop the way two people actually would: one person
 * sculpts a paper and copies a link, a second person with an empty browser
 * opens it and gets an editable copy. Run: `node tools/share-loop-check.mjs`.
 *
 * The second browser context is the point — a fresh profile has none of the
 * first one's localStorage, so this catches the failure where sharing
 * "works" only because the paper was already on the machine.
 */
import { spawn } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const PORT = 5205
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
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

const results = []
const check = (name, pass, detail = '') => {
  results.push({ name, pass })
  console.log(`${pass ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
}

const browser = await chromium.launch()
const problems = []
try {
  // ── Person A: sculpt something, then copy the link. ─────────────────────
  const alice = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] })
  const a = await alice.newPage()
  a.on('pageerror', (e) => problems.push(`alice: ${e}`))
  a.on('console', (m) => m.type() === 'error' && problems.push(`alice: ${m.text()}`))
  await a.goto(base, { waitUntil: 'networkidle' })
  await a.waitForTimeout(2500)
  const gotIt = a.getByRole('button', { name: 'Got it' })
  if (await gotIt.isVisible().catch(() => false)) await gotIt.click()

  // Sculpt: move `tightness` somewhere unmistakable.
  const row = a.locator('.control-row', { has: a.getByLabel('tightness', { exact: true }) })
  await row.locator('input[type=range]').fill('0.93')
  await a.waitForTimeout(400)
  const sculpted = await row.locator('.control-value').textContent()
  check('sculpted a paper', sculpted?.startsWith('0.93') ?? false, `tightness ${sculpted}`)

  await a.getByRole('button', { name: 'Share' }).click()
  await a.waitForTimeout(600)
  const link = await a.evaluate(() => navigator.clipboard.readText())
  check('share produced a link', link.includes('?p=') || link.includes('&p='), `${link.length} chars`)
  check('link is short enough to paste', link.length < 2000, `${link.length} chars`)

  // ── Person B: a browser that has never seen this paper. ────────────────
  const bob = await browser.newContext()
  const b = await bob.newPage()
  b.on('pageerror', (e) => problems.push(`bob: ${e}`))
  b.on('console', (m) => m.type() === 'error' && problems.push(`bob: ${m.text()}`))

  const storedBefore = await b.evaluate(() => localStorage.length).catch(() => 0)
  await b.goto(link, { waitUntil: 'networkidle' })
  await b.waitForTimeout(3000)

  const bobRow = b.locator('.control-row', { has: b.getByLabel('tightness', { exact: true }) })
  const bobValue = await bobRow.locator('.control-value').textContent()
  check('the sculpt survived the trip', bobValue?.startsWith('0.93') ?? false, `tightness ${bobValue}`)

  const inLibrary = await b.locator('.user-presets .preset-card').count()
  check('it landed in their library as an editable preset', inLibrary > 0, `${inLibrary} user preset(s)`)

  // Editable means editable: change it on Bob's side.
  await bobRow.locator('input[type=range]').fill('0.3')
  await b.waitForTimeout(400)
  const remixed = await bobRow.locator('.control-value').textContent()
  check('and it is editable, not read-only', Number(remixed) === 0.3, `tightness ${remixed}`)

  // The URL must not keep re-importing on refresh.
  const cleaned = await b.evaluate(() => window.location.search)
  check('the link is consumed, not left to re-import', !cleaned.includes('p='), `search "${cleaned}"`)
  await b.reload({ waitUntil: 'networkidle' })
  await b.waitForTimeout(2500)
  const afterReload = await b.locator('.user-presets .preset-card').count()
  check('refreshing does not duplicate it', afterReload === inLibrary, `${afterReload} preset(s)`)

  // ── The export half: what Bob does with it next. ───────────────────────
  await b.getByRole('button', { name: 'Export code' }).click()
  await b.waitForTimeout(400)
  const hasAi = await b.getByText('Copy for AI').isVisible()
  check('export is one click from the remix', hasAi)

  await b.screenshot({ path: '/tmp/share-loop-bob.png' })
  console.log(`storage before: ${storedBefore} keys`)
} finally {
  await browser.close()
  kill()
}

if (problems.length) {
  console.error(`\nconsole errors (${problems.length}):`)
  for (const p of problems.slice(0, 8)) console.error(`  ${p}`)
}
const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exitCode = failed.length || problems.length ? 1 : 0
