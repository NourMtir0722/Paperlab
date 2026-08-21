#!/usr/bin/env node
/**
 * Drives a stage the way a visitor does, and checks it moved.
 *
 * Stage mode's navigation is pointer capture, wheel handlers, key handlers
 * and easing against a live canvas — none of which a unit test can see. The
 * math has unit tests (`stage/navigate.test.ts`); this is the other half:
 * whether the listeners are actually attached to the thing on screen and
 * whether dragging it walks. Run: `pnpm test:drive`.
 */
import { spawn } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const PORT = 5203
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const server = spawn('pnpm', ['--filter', '@paperlab/editor', 'exec', 'vite', '--port', String(PORT)], {
  stdio: 'pipe',
  cwd: root,
})
process.on('exit', () => server.kill('SIGTERM'))

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
  // CI has no GPU, and a stage that never renders a frame never ticks the
  // clock the whole check is measuring.
  args: process.env.CI ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [],
})
const failures = []
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(name)
}

try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } })
  page.on('pageerror', (e) => failures.push(`page error: ${e}`))
  // Twelve words for twelve banners, so the scene under test is exactly the
  // one the arithmetic below describes. `count` is a REQUEST: the text is
  // split a column per banner, and fewer words than banners means fewer
  // banners — which is correct, and is what made the first version of this
  // check disagree with a stage that was placing its stops perfectly.
  const BANNERS = 12
  const MARGIN = 0.05
  const text = 'one two three four five six seven eight nine ten eleven twelve'
  await page.goto(
    `${base}/stage.html?drive=1&preset=nave&banners=${BANNERS}&text=${encodeURIComponent(text)}`,
    {
      waitUntil: 'networkidle',
    },
  )
  await page.waitForFunction(() => window.__STAGE__?.ready === true, { timeout: 30_000 })

  const walk = () => page.evaluate(() => window.__STAGE__.walk ?? 0)
  /**
   * Wait for a travel to finish rather than guessing how long it takes. The
   * ease runs on frames, and a software rasterizer's frames are slow enough
   * that a fixed wait lands mid-move and reads as a step that missed.
   */
  const settle = async () => {
    let last = Number.NaN
    let still = 0
    for (let i = 0; i < 60; i++) {
      await page.waitForTimeout(200)
      const now = await walk()
      // THREE readings, not two. A software rasterizer's frames are slow
      // enough that two samples can straddle one frame and agree while the
      // move is still very much in flight.
      still = now === last ? still + 1 : 0
      last = now
      if (still >= 2) return now
    }
    return last
  }
  const canvas = page.locator('canvas')
  const box = await canvas.boundingBox()
  const mid = { x: box.x + box.width / 2, y: box.y + box.height / 2 }

  // ── It moves before anyone touches it ────────────────────────────────────
  const drifted0 = await walk()
  await page.waitForTimeout(900)
  const drifted1 = await walk()
  check('drifts on its own', drifted1 > drifted0, `${drifted0.toFixed(3)} → ${drifted1.toFixed(3)}`)

  // ── Dragging up walks forward, and it is the viewer's from then on ───────
  await page.mouse.move(mid.x, mid.y)
  await page.mouse.down()
  for (let i = 1; i <= 10; i++) await page.mouse.move(mid.x, mid.y - i * 20)
  await page.mouse.up()
  const dragged = await walk()
  check('dragging up walks forward', dragged > drifted1, `→ ${dragged.toFixed(3)}`)

  // Once taken over it must STAY taken: a scene that resumes drifting under
  // the hand is the whole reason this is one driver and not two. Measured
  // after the flick has coasted out, since coasting IS meant to happen.
  const coasted = await settle()
  await page.waitForTimeout(900)
  const afterRelease = await walk()
  check(
    'stays where it was left',
    afterRelease === coasted,
    `let go at ${dragged.toFixed(3)}, coasted to ${coasted.toFixed(3)}, still there`,
  )

  // ── The wheel ────────────────────────────────────────────────────────────
  await page.mouse.wheel(0, 400)
  await page.waitForTimeout(120)
  const wheeled = await walk()
  check('the wheel walks it', wheeled > afterRelease, `→ ${wheeled.toFixed(3)}`)

  // ── Arrow keys land ON a paper, not between two ──────────────────────────
  await canvas.focus()
  await page.keyboard.press('ArrowRight')
  const stepped = await settle()
  // Recomputed here from the colonnade's own rule rather than read back out
  // of the app, so this is a second opinion and not the library agreeing
  // with itself.
  const stops = Array.from({ length: BANNERS }, (_, i) => {
    const side = i % 2 === 0 ? 1 : -1
    const pairs = Math.max(Math.ceil(BANNERS / 2), 1)
    const k = Math.floor(i / 2)
    const span = 1 - MARGIN * 2
    const step = pairs > 1 ? span / (pairs - 1) : 0
    return MARGIN + (pairs > 1 ? k * step : span / 2) + side * step * 0.25
  })
  const onAStop = stops.some((s) => Math.abs(s - stepped) < 0.005)
  check('an arrow key lands on a banner', onAStop, `${stepped.toFixed(4)}`)

  await page.keyboard.press('ArrowLeft')
  const back = await settle()
  check('and the other one goes back', back < stepped, `${stepped.toFixed(3)} → ${back.toFixed(3)}`)

  // ── Clicking a banner travels to it ──────────────────────────────────────
  // Swept across the frame rather than aimed at one pixel: which columns hold
  // paper depends on the viewport's aspect, and the claim under test is that
  // banners are clickable, not that one of them is at 13%.
  const before = await walk()
  let visited
  for (let f = 0.05; f <= 0.95 && visited === undefined; f += 0.05) {
    await page.mouse.click(box.x + box.width * f, box.y + box.height * 0.45)
    await page.waitForTimeout(80)
    visited = await page.evaluate(() => window.__STAGE__.visited)
  }
  const after = await settle()
  check(
    'clicking a banner travels to it',
    visited !== undefined && Math.abs(after - before) > 0.001,
    visited === undefined
      ? 'nothing was hit anywhere across the frame'
      : `paper ${visited}, ${before.toFixed(3)} → ${after.toFixed(3)}`,
  )

  // ── And a drag that ends over one does NOT ───────────────────────────────
  await page.evaluate(() => {
    window.__STAGE__.visited = undefined
  })
  const beforeDrag = await walk()
  await page.mouse.move(mid.x, mid.y)
  await page.mouse.down()
  for (let i = 1; i <= 8; i++) await page.mouse.move(mid.x, mid.y - i * 18)
  await page.mouse.up()
  await page.waitForTimeout(200)
  const strayed = await page.evaluate(() => window.__STAGE__.visited)
  check(
    'a drag is not also a click',
    strayed === undefined,
    strayed === undefined
      ? `walked ${beforeDrag.toFixed(3)} → ${(await walk()).toFixed(3)}`
      : `travelled to ${strayed}`,
  )

  // ── A controlled stage keeps its hands off ───────────────────────────────
  await page.goto(`${base}/stage.html?preset=nave&progress=0.42`, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => window.__STAGE__?.ready === true, { timeout: 30_000 })
  await page.mouse.move(mid.x, mid.y)
  await page.mouse.down()
  await page.mouse.move(mid.x, mid.y - 250)
  await page.mouse.up()
  await page.waitForTimeout(400)
  const held = await walk()
  check('a controlled stage ignores the viewer', Math.abs(held - 0.42) < 1e-6, held.toFixed(4))
} finally {
  await browser.close()
}

server.kill('SIGTERM')
if (failures.length > 0) {
  console.error(`\n${failures.length} failure(s): ${failures.join(', ')}`)
  process.exit(1)
}
console.log('\nthe stage can be walked')
// Explicit: the dev server is a live child and node will not exit while it
// holds the loop open, however finished this script is.
process.exit(0)
