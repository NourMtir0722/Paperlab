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
 *
 * Everything here waits on a condition rather than a duration. Choosing a
 * preset rebuilds a canvas, and on CI that canvas is SwiftShader on a shared
 * runner — the same click that settles instantly on a laptop can take fifteen
 * seconds there. A sleep long enough to cover that is either flaky or slow,
 * and the first draft of this file was both.
 */
import { chromium } from 'playwright'
import { startApp } from './harness.mjs'

const PORT = 5206
/** One interaction's worth of patience, generous enough for a cold CI runner. */
const SETTLE = 20_000

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

  const list = page.locator('.select-list')
  const isOpen = async () => (await list.count()) > 0

  const gotIt = page.getByRole('button', { name: 'Got it' })
  await gotIt.click({ timeout: SETTLE }).catch(() => {})

  /** Click a trigger and wait for its list, rather than for a guessed delay. */
  const openList = async (trigger) => {
    await trigger.scrollIntoViewIfNeeded().catch(() => {})
    await trigger.click({ timeout: SETTLE }).catch(() => {})
    return await list
      .first()
      .waitFor({ state: 'attached', timeout: SETTLE })
      .then(() => true)
      .catch(() => false)
  }

  const dismiss = async () => {
    if (!(await isOpen())) return
    await page.keyboard.press('Escape').catch(() => {})
    await list
      .first()
      .waitFor({ state: 'detached', timeout: SETTLE })
      .catch(() => {})
  }

  /**
   * Which dropdowns each mode is asked about. The field composer builds one
   * identical picker per slot; driving all fourteen re-renders the canvas
   * fourteen times to re-test one component, which is how this gate came to
   * take eight minutes. Two instances prove the wiring, and the schema-driven
   * pickers in the other modes cover the rest.
   */
  const MODES = [
    { mode: 'Paper', only: null },
    { mode: 'Field', only: ['Paper 1 preset', 'type'] },
    { mode: 'Stage', only: null },
  ]

  for (const { mode, only } of MODES) {
    await page.getByRole('button', { name: mode, exact: true }).click({ timeout: SETTLE })

    // The rails for this mode have to exist before anything can be clicked,
    // and on a cold runner they do not arrive on the same tick as the click.
    const triggers = page.getByRole('combobox')
    await page
      .waitForFunction(() => document.querySelectorAll('[role=combobox]').length > 0, null, {
        timeout: SETTLE,
      })
      .catch(() => {})
    await triggers
      .first()
      .waitFor({ state: 'visible', timeout: SETTLE })
      .catch(() => {})

    const names = await triggers.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
    check(`${mode} has dropdowns to check`, names.length > 0, `${names.length} found`)

    for (let i = 0; i < names.length; i++) {
      if (only && !only.includes(names[i])) continue
      await dismiss()
      // Choosing an option re-renders the panel, and in the field composer it
      // can change which rows exist at all — so re-check that this trigger is
      // still on the page rather than waiting on one that has gone.
      if ((await triggers.count()) <= i) break
      const trigger = triggers.nth(i)

      if (!(await openList(trigger))) {
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

      // Reading past the fold is the thing that used to dismiss it. Give the
      // wheel a moment to be acted on, then ask whether the list is still up.
      const bb = await list.first().boundingBox()
      await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2)
      await page.mouse.wheel(0, 250)
      const survived = await list
        .first()
        .waitFor({ state: 'detached', timeout: 1500 })
        .then(() => false)
        .catch(() => true)
      check(`${mode} > ${names[i]} survives scrolling its own list`, survived)
      if (!survived) continue

      // And the option you scrolled to must still be selectable. Wait for the
      // trigger to actually say so — committing a preset rebuilds the canvas.
      const last = list.first().locator('.select-option').last()
      const wanted = (await last.textContent())?.trim()
      await last.click({ timeout: SETTLE }).catch(() => {})
      const picked = await page
        .waitForFunction(
          ({ label, want }) => {
            const el = document.querySelector(`[role=combobox][aria-label="${label}"]`)
            // A trigger that re-rendered itself out of existence answers the
            // question too: the click landed, which is all this is asking.
            return el === null || (el.textContent ?? '').includes(want)
          },
          { label: names[i], want: wanted ?? '' },
          { timeout: SETTLE },
        )
        .then(() => true)
        .catch(() => false)
      check(`${mode} > ${names[i]} can pick its last option`, picked, `wanted "${wanted}"`)
    }
    await dismiss()
  }

  // The behaviour the dismissal exists for must survive the fix: the popup is
  // positioned off a rect captured once, so a rail that scrolls under it has
  // to close it rather than let it drift off its trigger.
  await page.getByRole('button', { name: 'Paper', exact: true }).click({ timeout: SETTLE })
  const presetPicker = page.getByRole('combobox', { name: 'Choose a built-in preset' })
  await presetPicker.waitFor({ state: 'visible', timeout: SETTLE })

  const closedBy = async (act) => {
    if (!(await openList(presetPicker))) return false
    await act()
    return await list
      .first()
      .waitFor({ state: 'detached', timeout: SETTLE })
      .then(() => true)
      .catch(() => false)
  }

  check(
    'an outside scroll still dismisses it',
    await closedBy(() =>
      page.evaluate(() => {
        document.querySelector('aside')?.dispatchEvent(new Event('scroll', { bubbles: false }))
      }),
    ),
  )
  check(
    'a resize still dismisses it',
    await closedBy(() => page.setViewportSize({ width: 1500, height: 950 })),
  )

  // ── The keyboard contract ───────────────────────────────────────────────
  // A navigation key names an option: closed, that opens the list on it, and
  // the value does not move until Enter, Space or a click. Home and End used
  // to commit on the spot instead, so one keystroke could swap the sculpt for
  // another preset and rebuild the canvas with no list ever shown.
  await dismiss()
  const shownValue = async () => ((await presetPicker.textContent()) ?? '').replace('▾', '').trim()
  const openBy = async (key) => {
    await presetPicker.focus()
    await page.keyboard.press(key)
    return await list
      .first()
      .waitFor({ state: 'attached', timeout: SETTLE })
      .then(() => true)
      .catch(() => false)
  }

  // Start from the top of the list. The run above left the picker on the last
  // preset, and there "End committed it" and "End did nothing" produce the
  // same value — the check would pass on the broken behaviour too.
  if (await openList(presetPicker)) {
    const first = list.first().locator('.select-option').first()
    const firstName = (await first.textContent())?.trim()
    await first.click({ timeout: SETTLE }).catch(() => {})
    await page
      .waitForFunction(
        (want) =>
          (
            document.querySelector('[role=combobox][aria-label="Choose a built-in preset"]')?.textContent ??
            ''
          ).includes(want),
        firstName ?? '',
        { timeout: SETTLE },
      )
      .catch(() => {})
  }
  await dismiss()
  // Park the pointer clear of the list. Hover follows the mouse, and a cursor
  // left sitting over an option would be answering these keyboard checks.
  await page.mouse.move(10, 10)

  const before = await shownValue()
  const endOpened = await openBy('End')
  check('End on a closed select opens the list', endOpened)
  // If it did not open, End committed instead — the exact regression this
  // section is here for. Say so for each remaining check rather than throwing
  // on the list that is not there and losing the rest of the run.
  const last = endOpened ? (await list.first().locator('.select-option').last().textContent())?.trim() : null
  check(
    'and does not commit on its own',
    endOpened && (await shownValue()) === before,
    endOpened ? `still "${before}"` : `was "${before}", now "${await shownValue()}"`,
  )

  let commits = false
  if (endOpened) {
    await page.keyboard.press('Enter')
    commits = await page
      .waitForFunction(
        (want) =>
          (
            document.querySelector('[role=combobox][aria-label="Choose a built-in preset"]')?.textContent ??
            ''
          ).includes(want),
        last ?? '',
        { timeout: SETTLE },
      )
      .then(() => true)
      .catch(() => false)
  }
  check('Enter is what commits it', commits, `wanted "${last}"`)

  // Whatever the value is by now, backing out of the list must not move it.
  const beforeHome = await shownValue()
  check('Home on a closed select opens the list', await openBy('Home'))
  await page.keyboard.press('Escape')
  await list
    .first()
    .waitFor({ state: 'detached', timeout: SETTLE })
    .catch(() => {})
  check('Escape leaves the value alone', (await shownValue()) === beforeHome, `still "${beforeHome}"`)
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
