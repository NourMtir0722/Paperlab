#!/usr/bin/env node
/**
 * Film the burn, rather than photograph it.
 *
 * `test:fire-look` lays a still of every phase beside the reference it is
 * meant to look like, and that settles everything about a burn except the
 * half that only exists between frames: whether a tongue tears or dissolves,
 * how fast the beads flicker, whether "smoulder" and "cold" are two moments
 * or one. Every one of the review's findings about MOTION was inferred from
 * stills, which is a large part of why it took an afternoon.
 *
 * So this records the page playing, from the first contact to cold, and
 * writes one file per origin. Local only — it wants ffmpeg for the mp4 and
 * there is nothing here for CI to assert.
 *
 *   pnpm film
 *   pnpm film --speed=0.25    slower, for the flicker
 * The camera moves here, and only here: the push-in and the drift are part of
 * what a film is for. Everything that MEASURES a frame loads `?camera=static`.
 *
 *   pnpm film --amount=0.42   how much of the sheet burns — from the centre,
 *                             enough to cut it in two and watch the piece fall
 */
import { mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { shotsDir, startApp } from './harness.mjs'

const PORT = 5199
const argv = process.argv.slice(2)
const speed = Number((argv.find((a) => a.startsWith('--speed=')) ?? '--speed=1').slice(8)) || 1
const amount = argv.find((a) => a.startsWith('--amount='))?.slice(9)
const out = join(shotsDir(), 'fire-film')
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

const { base, stop } = await startApp('editor', PORT)
// On the GPU. Headless Chromium on a Mac otherwise draws with SwiftShader,
// on the CPU, at about 5 frames a second — and the lab's burn clock and the
// fire's solver both advance by frame, so the film was of a fire running at a
// fraction of its speed, one step at a time. Stills never showed it.
const browser = await chromium.launch({
  args: process.platform === 'darwin' ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] : [],
})

for (const origin of ['center', 'corner']) {
  const dir = join(out, `${origin}-raw`)
  const context = await browser.newContext({
    viewport: { width: 1200, height: 800 },
    recordVideo: { dir, size: { width: 1200, height: 800 } },
  })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  const asked = amount === undefined ? '' : `&amount=${amount}`
  await page.goto(`${base}/fx-lab/?ui=0&play=1&t=0&origin=${origin}&speed=${speed}${asked}`, {
    waitUntil: 'networkidle',
  })
  await page.waitForFunction(() => window.__FXLAB__?.ready === true, null, { timeout: 180_000 })
  // As long as THIS burn runs, which the page measured: 24 simulated seconds
  // by default, most of a minute for a burn asked to eat the whole sheet. At
  // 0.25× the default is 96 s of wall clock.
  const duration = await page.evaluate(() => window.__FXLAB__?.duration ?? 24)
  const seconds = Math.ceil(duration / speed) + 2
  // Wall clock on purpose: this is a recording of the page running, so the
  // thing being waited for IS elapsed time. Everything else in this repo is
  // frame-driven because it is waiting for a frame to be finished.
  await page.waitForTimeout(seconds * 1000)
  await page.close()
  await context.close()
  if (errors.length) console.error(`  ${origin}: ${errors[0]}`)

  const webm = readdirSync(dir).find((f) => f.endsWith('.webm'))
  if (!webm) {
    console.error(`  ${origin}: nothing recorded`)
    continue
  }
  const src = join(dir, webm)
  try {
    const mp4 = join(out, `${origin}.mp4`)
    // Cut the dead lead-in. Recording starts when the page opens, and the
    // page then sits on a paused sheet for as long as its shaders take to
    // compile and its frames take to settle — about 38 s here, more than the
    // burn itself. Everything before the last `seconds` is that wait, so it
    // goes; a film that is 60% a still frame hides the burn it exists to show.
    const length = Number(
      execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', src])
        .toString()
        .trim(),
    )
    const lead = Math.max(0, length - seconds)
    execFileSync('ffmpeg', [
      '-y',
      '-loglevel',
      'error',
      '-ss',
      String(lead),
      '-i',
      src,
      '-vf',
      'scale=1200:-2',
      '-crf',
      '20',
      mp4,
    ])
    rmSync(dir, { recursive: true, force: true })
    console.log(`  ${origin} → ${mp4}`)
  } catch {
    // No ffmpeg: keep the webm, which plays in a browser anyway.
    renameSync(src, join(out, `${origin}.webm`))
    rmSync(dir, { recursive: true, force: true })
    console.log(`  ${origin} → ${join(out, `${origin}.webm`)} (no ffmpeg, kept as webm)`)
  }
}

console.log(`\n${out}`)
await browser.close()
await stop()
