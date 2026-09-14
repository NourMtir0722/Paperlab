#!/usr/bin/env node
/**
 * Does attaching an untouched damage field change a single pixel?
 *
 * `<Paper damage={field}>` compiles a different program — one more chunk, one
 * more sampler, an alpha test of one half instead of zero — and the chunk is
 * written so that on an untouched field it is an exact identity. That is an
 * argument about arithmetic. This is the render that settles it: the same
 * sheet drawn with no texture and with an empty one, photographed, compared
 * byte for byte.
 *
 * Two stocks, because the alpha test is the part most likely to show: an
 * opaque sheet has alpha 1 everywhere, and `vellum` sits at 0.62, the one
 * stock where a careless cut could eat the whole sheet.
 *
 * And a control, because a comparison that cannot fail proves nothing: the
 * same sheet with a scorch painted into the field must NOT match. If it does,
 * the texture is not reaching the shader at all, and "identical" meant
 * "ignored".
 *
 * Then the shadow. A hole cut by alpha in the colour program is invisible to
 * the shadow map — three's own depth material ignores alpha computed in
 * shader code — so every hole in paper used to cast a solid shadow. The sheet
 * now carries a depth program that discards where paper is gone. Checked on a
 * floor that RECEIVES the shadow map (contact shadows off: they are a
 * separate pass that never reads a mesh's depth material), photographing only
 * the floor beside the sheet — so the hole in the paper itself cannot be what
 * makes the two photographs differ. Only light through the hole can.
 *
 * Runs in CI as `pnpm test:damage`.
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { startApp } from './harness.mjs'

const PORT = 5193
const STOCKS = ['printer', 'vellum']

const { base, stop } = await startApp('editor', PORT)
const browser = await chromium.launch({
  args: process.env.CI ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [],
})

let failed = 0
const check = (ok, label, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${ok ? '' : ` — ${detail}`}`)
  if (!ok) failed++
}

/**
 * The floor beside the sheet in `?scene=shadow`, where its shadow falls under
 * the studio key: left of the sheet and clear of it. Tied to that camera and
 * that preset — move either and this has to be re-aimed, which the
 * photographed-twice baseline and the hole check will say loudly rather than
 * pass quietly.
 */
const SHADOW_CLIP = { x: 100, y: 245, width: 112, height: 130 }

/** One photograph in a fresh page, so nothing carries over. */
async function photograph(query, clip) {
  const page = await browser.newPage({ viewport: { width: 640, height: 640 }, deviceScaleFactor: 1 })
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))
  try {
    await page.goto(`${base}/damage.html?${query}`, { waitUntil: 'networkidle' })
    await page.waitForFunction(() => window.__DAMAGE__?.ready === true, null, { timeout: 120_000 })
    const shot = clip ? await page.screenshot({ clip }) : await page.locator('canvas').first().screenshot()
    if (errors.length) throw new Error(errors.join('\n'))
    return shot
  } finally {
    await page.close()
  }
}

const keep = mkdtempSync(join(tmpdir(), 'paperlab-damage-'))

try {
  for (const stock of STOCKS) {
    console.log(`\n${stock}`)
    const none = await photograph(`stock=${stock}&damage=none`)
    const untouched = await photograph(`stock=${stock}&damage=untouched`)
    const again = await photograph(`stock=${stock}&damage=none`)
    const scorched = await photograph(`stock=${stock}&damage=scorched`)

    // The baseline has to be repeatable, or a mismatch below means nothing.
    check(
      none.equals(again),
      'the same sheet photographs the same twice',
      'the render is not deterministic here',
    )

    const same = none.equals(untouched)
    if (!same) {
      writeFileSync(join(keep, `${stock}-none.png`), none)
      writeFileSync(join(keep, `${stock}-untouched.png`), untouched)
    }
    check(same, 'an untouched field draws exactly the sheet without one', `see ${keep}`)
    check(
      !none.equals(scorched),
      'and a scorched one does not — the texture reaches the shader',
      'the control matched, so the check is blind',
    )

    // Heat on its own draws NOTHING. This used to check that a burning line
    // glowed warm, and the glow it passed was paint — a warm band added over
    // paper that had not burnt, which is what made the first fire's rim read
    // salmon. No emissive light on
    // unburnt paper. Heat emits only from the ember line, flames and embers,
    // and through bloom. `scorched` is the same field with the heat left out.
    const glowing = await photograph(`stock=${stock}&damage=glowing`)
    const cold = glowing.equals(scorched)
    if (!cold) {
      writeFileSync(join(keep, `${stock}-scorched.png`), scorched)
      writeFileSync(join(keep, `${stock}-glowing.png`), glowing)
    }
    check(cold, 'heat alone paints nothing onto the sheet — no glow on paper', `see ${keep}`)
  }

  // The fray: a hard-edged hole, drawn with and without it. If the two match,
  // `detail` reaches nothing and the edge is the grid's own staircase.
  console.log('\nthe edge')
  const frayed = await photograph('damage=hole')
  const gridEdge = await photograph('damage=hole&detail=0')
  check(
    !frayed.equals(gridEdge),
    'a cut edge is frayed finer than the grid, and detail 0 turns it off',
    'the two photographs match, so detail reaches nothing',
  )

  console.log('\nthe shadow map')
  const whole = await photograph('scene=shadow&damage=none', SHADOW_CLIP)
  const wholeAgain = await photograph('scene=shadow&damage=none', SHADOW_CLIP)
  const holed = await photograph('scene=shadow&damage=hole', SHADOW_CLIP)
  check(
    whole.equals(wholeAgain),
    'the floor beside the sheet photographs the same twice',
    'the shadow render is not deterministic here',
  )
  if (whole.equals(holed)) {
    writeFileSync(join(keep, 'shadow-whole.png'), whole)
    writeFileSync(join(keep, 'shadow-holed.png'), holed)
  }
  check(
    !whole.equals(holed),
    'light comes through a hole in the paper and reaches the floor',
    `the hole cast a solid shadow — see ${keep}`,
  )
} finally {
  await browser.close()
  stop()
}

console.log()
if (failed) {
  console.error(`${failed} check${failed === 1 ? '' : 's'} failed.`)
  process.exit(1)
}
console.log('The damage seam costs an untouched sheet nothing it can see.')
