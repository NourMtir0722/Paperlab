#!/usr/bin/env node
/**
 * Opens every dropdown in the editor and tries to reach the options that do
 * not fit. Run: `pnpm test:dropdown`.
 *
 * The select is the app's own, so the option list is app DOM in a scrolling
 * box rather than an OS popup — and it shipped closing itself on any `scroll`
 * event, including its own. Sixteen presets in a 260px list meant the seven
 * below the fold could not be reached with a mouse at all: reach for them and
 * the list vanished, with nothing in the console to say why. Whether the
 * whole list is reachable is exactly what a unit test cannot see and a
 * screenshot does not try, so drive it.
 */
import { chromium } from 'playwright'
import { startApp } from './harness.mjs'

const PORT = 5206
const { base, stop } = await startApp('editor', PORT)

const results = []
const check = (name, pass, detail = '') => {
  results.push({ name, pass })
  console.log(`${pass ? '+' : 'x'} ${name}${detail ? ` — ${detail}` : ''}`)
}

const browser = await chromium.launch()
const problems = []
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  page.on('pageerror', (e) => problems.push(String(e)))
  page.on('console', (m) => m.type() === 'error' && problems.push(m.text()))
  await page.goto(base, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2500)
  const gotIt = page.getByRole('button', { name: 'Got it' })
  if (await gotIt.isVisible().catch(() => false)) await gotIt.click()

  const list = page.locator('.select-list')
  const isOpen = async () => (await list.count()) > 0
  const dismiss = async () => {
    if (await isOpen()) await page.keyboard.press('Escape').catch(() => {})
    await page.waitForTimeout(200)
  }

  // Every mode has its own rails, and the long lists are spread across them.
  for (const mode of ['Paper', 'Field', 'Stage']) {
    await page.getByRole('button', { name: mode, exact: true }).click()
    await page.waitForTimeout(2200)

    const triggers = page.getByRole('combobox')
    const names = await triggers.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
    check(`${mode} has dropdowns to check`, names.length > 0, `${names.length} found`)

    for (let i = 0; i < names.length; i++) {
      await dismiss()
      // Choosing an option re-renders the panel, and in the field composer it
      // can change which rows exist at all — so re-check that this trigger is
      // still on the page rather than waiting 30s for one that has gone.
      if ((await triggers.count()) <= i) break
      const trigger = triggers.nth(i)
      await trigger.scrollIntoViewIfNeeded().catch(() => {})
      await trigger.click({ timeout: 5000 }).catch(() => {})
      if (!(await isOpen())) {
        check(`${mode} > ${names[i]} opens`, false)
        continue
      }

      const box = await list.first().evaluate((el) => {
        const r = el.getBoundingClientRect()
        return {
          overflows: el.scrollHeight > el.clientHeight + 1,
          onScreen: r.top >= 0 && r.bottom <= window.innerHeight && r.right <= window.innerWidth,
        }
      })
      check(`${mode} > ${names[i]} opens on screen`, box.onScreen)

      // The list fits — there is nothing below the fold to be cut off from.
      if (!box.overflows) continue

      // Reading past the fold is the thing that used to dismiss it.
      const bb = await list.first().boundingBox()
      await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2)
      await page.mouse.wheel(0, 250)
      await page.waitForTimeout(350)
      const survived = await isOpen()
      check(`${mode} > ${names[i]} survives scrolling its own list`, survived)
      if (!survived) continue

      // And the option you scrolled to must still be selectable.
      const last = list.first().locator('.select-option').last()
      const wanted = (await last.textContent())?.trim()
      await last.click({ timeout: 4000 }).catch(() => {})
      await page.waitForTimeout(500)
      const now = await trigger.textContent({ timeout: 4000 }).catch(() => null)
      // A trigger that re-rendered itself out of existence answers the
      // question too: the click landed, which is all this is asking.
      const picked = now === null || (wanted !== undefined && now.includes(wanted))
      check(`${mode} > ${names[i]} can pick its last option`, picked, `wanted "${wanted}"`)
    }
    await dismiss()
  }

  // The behaviour the dismissal exists for must survive the fix: the popup is
  // positioned off a rect captured once, so a rail that scrolls under it has
  // to close it rather than let it drift off its trigger.
  await page.getByRole('button', { name: 'Paper', exact: true }).click()
  await page.waitForTimeout(2000)
  await page.getByRole('combobox', { name: 'Choose a built-in preset' }).click()
  await page.waitForTimeout(300)
  const openedForDrift = await isOpen()
  await page.evaluate(() => {
    document.querySelector('aside')?.dispatchEvent(new Event('scroll', { bubbles: false }))
  })
  await page.waitForTimeout(350)
  check('an outside scroll still dismisses it', openedForDrift && !(await isOpen()))

  await page.getByRole('combobox', { name: 'Choose a built-in preset' }).click()
  await page.waitForTimeout(300)
  const openedForResize = await isOpen()
  await page.setViewportSize({ width: 1500, height: 950 })
  await page.waitForTimeout(450)
  check('a resize still dismisses it', openedForResize && !(await isOpen()))
} finally {
  await browser.close()
  stop()
}

if (problems.length) {
  console.error(`\nconsole errors (${problems.length}):`)
  for (const p of problems.slice(0, 8)) console.error(`  ${p}`)
}
const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exitCode = failed.length || problems.length ? 1 : 0
