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
 */
import { mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { shotsDir, startApp } from './harness.mjs'

const PORT = 5199
const argv = process.argv.slice(2)
const speed = Number((argv.find((a) => a.startsWith('--speed=')) ?? '--speed=1').slice(8)) || 1
const out = join(shotsDir(), 'fire-film')
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

const { base, stop } = await startApp('editor', PORT)
const browser = await chromium.launch()

/** The burn is 24 simulated seconds; at 0.25× that is 96 of wall clock. */
const SECONDS = Math.ceil(24 / speed) + 2

for (const origin of ['center', 'corner']) {
  const dir = join(out, `${origin}-raw`)
  const context = await browser.newContext({
    viewport: { width: 1200, height: 800 },
    recordVideo: { dir, size: { width: 1200, height: 800 } },
  })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(`${base}/fx-lab/?ui=0&play=1&t=0&origin=${origin}&speed=${speed}`, {
    waitUntil: 'networkidle',
  })
  await page.waitForFunction(() => window.__FXLAB__?.ready === true, null, { timeout: 180_000 })
  // Wall clock on purpose: this is a recording of the page running, so the
  // thing being waited for IS elapsed time. Everything else in this repo is
  // frame-driven because it is waiting for a frame to be finished.
  await page.waitForTimeout(SECONDS * 1000)
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
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-vf', 'scale=1200:-2', '-crf', '20', mp4])
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
