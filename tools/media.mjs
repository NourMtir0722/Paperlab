#!/usr/bin/env node
/**
 * Records the README's moving assets.
 *
 * Paperlab sells motion, and the README sold it with still photographs — a
 * PNG of paper looks like paper, not like paper that moves. This renders a
 * preset headless and steps its progress one exact frame at a time rather
 * than screen-recording it, so the loop is deterministic: no dropped frames,
 * no compositor jitter, identical output on any machine.
 *
 *   pnpm media                          # every asset in the README
 *   pnpm media --only=receipt-unroll    # just one
 *   pnpm media --list                   # what it can make
 *
 * Writes a GIF (README-safe — GitHub does not render <video> in markdown)
 * and an MP4 (for Product Hunt, X, and anywhere that takes real video).
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
import { root, startApp } from './harness.mjs'

const PORT = 5204
const outDir = resolve(root, 'docs/media')
const tmpDir = resolve(root, '.media-frames')

/**
 * `pingpong` plays the motion forward then back, so the loop closes without
 * a jump cut. `loop` runs 0→1 for motion that is already cyclic.
 */
const ASSETS = {
  // `cam` is not decoration: a 2.6-unit receipt does not fit the 2.1 units a
  // 40° lens sees at z=2.9, so the default framing walks it out of frame
  // halfway through its own unroll.
  'receipt-unroll': {
    mode: 'paper',
    preset: 'receipt-unroll',
    width: 720,
    height: 900,
    cam: '0,-0.15,4.6',
    play: 'pingpong',
  },
  'hero-peel': {
    mode: 'paper',
    preset: 'hero-peel',
    width: 900,
    height: 700,
    cam: '0,0.2,3.1',
    play: 'pingpong',
  },
  'page-flip': {
    mode: 'paper',
    preset: 'page-flip',
    width: 900,
    height: 700,
    cam: '0,0.2,3.2',
    play: 'pingpong',
  },
  'letter-fold': {
    mode: 'paper',
    preset: 'letter-fold',
    width: 900,
    height: 700,
    cam: '0,0.15,3.2',
    play: 'pingpong',
  },
  'field-ring': {
    mode: 'field',
    preset: 'photo-print',
    layout: 'ring',
    width: 1000,
    height: 640,
    cam: '0,1.1,6.8',
    play: 'loop',
  },
  'stage-nave': { mode: 'stage', preset: 'nave', width: 1000, height: 640, play: 'loop' },
}

const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.split('=').slice(1).join('=') : fallback
}

if (argv.includes('--list')) {
  console.log(Object.keys(ASSETS).join('\n'))
  process.exit(0)
}
if (spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status !== 0) {
  console.error('ffmpeg is required: brew install ffmpeg')
  process.exit(1)
}

const only = flag('only')
const frames = Number(flag('frames', 48))
const fps = Number(flag('fps', 24))
/** GIFs drop to half rate — it halves the file for motion this slow. */
const gifFps = Number(flag('gif-fps', 12))
const wanted = only ? { [only]: ASSETS[only] } : ASSETS
if (only && !ASSETS[only]) {
  console.error(`unknown asset "${only}" — try --list`)
  process.exit(1)
}

const { base, stop } = await startApp('editor', PORT)

mkdirSync(outDir, { recursive: true })
const browser = await chromium.launch()
const problems = []

try {
  for (const [name, spec] of Object.entries(wanted)) {
    rmSync(tmpDir, { recursive: true, force: true })
    mkdirSync(tmpDir, { recursive: true })

    const page = await browser.newPage({
      viewport: { width: spec.width, height: spec.height },
      deviceScaleFactor: 2,
    })
    page.on('console', (m) => m.type() === 'error' && problems.push(`${name}: ${m.text()}`))
    page.on('pageerror', (e) => problems.push(`${name}: ${e}`))

    const query = new URLSearchParams({ mode: spec.mode, preset: spec.preset })
    if (spec.layout) query.set('layout', spec.layout)
    if (spec.cam) query.set('cam', spec.cam)
    if (spec.fov) query.set('fov', String(spec.fov))
    await page.goto(`${base}/media.html?${query}`, { waitUntil: 'networkidle' })
    await page.waitForFunction(() => window.__MEDIA__?.ready === true, { timeout: 30_000 })
    // Fonts and textures land well after `ready`, and in field mode a dozen
    // sheets share one content atlas that uploads in pieces — capture too
    // early and half the gallery is blank grey rectangles that read as
    // broken images.
    await page.waitForFunction(() => document.fonts.ready.then(() => true), { timeout: 15_000 })
    await page.waitForTimeout(spec.mode === 'paper' ? 1500 : 4000)

    process.stdout.write(`${name} `)
    for (let i = 0; i < frames; i++) {
      const t = i / frames
      const progress = spec.play === 'pingpong' ? 1 - Math.abs(1 - 2 * t) : t
      await page.evaluate((p) => window.__MEDIA__.set(p), progress)
      // One rAF for React to commit and three.js to draw the new pose.
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
      await page.screenshot({ path: resolve(tmpDir, `f${String(i).padStart(4, '0')}.png`) })
      process.stdout.write('.')
    }
    await page.close()

    const gif = resolve(outDir, `${name}.gif`)
    const mp4 = resolve(outDir, `${name}.mp4`)
    const input = ['-y', '-framerate', String(fps), '-i', resolve(tmpDir, 'f%04d.png')]

    // The GIF is capped well below the capture size and the MP4 is not. A
    // GIF cannot inter-frame compress, so a 1000px 48-frame loop lands near
    // 6 MB — which is a README nobody on a phone waits for. The MP4 of the
    // same loop is ~700 KB at full width, so quality lives there.
    const gifWidth = Math.min(spec.gifWidth ?? 640, spec.width)
    const gifFilters = `fps=${gifFps},scale=${gifWidth}:-1:flags=lanczos`
    // Two-pass palette: one shared 256-colour palette across the whole loop,
    // because per-frame palettes make paper crawl with dither noise.
    run('ffmpeg', [...input, '-vf', `${gifFilters},palettegen=stats_mode=diff`, resolve(tmpDir, 'pal.png')])
    run('ffmpeg', [
      ...input,
      '-i',
      resolve(tmpDir, 'pal.png'),
      '-lavfi',
      `${gifFilters}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3`,
      '-loop',
      '0',
      gif,
    ])
    run('ffmpeg', [
      ...input,
      '-vf',
      `fps=${fps},scale=${spec.width}:-1:flags=lanczos,format=yuv420p`,
      '-movflags',
      '+faststart',
      '-crf',
      '20',
      mp4,
    ])
    console.log(` → ${name}.gif + .mp4`)
  }
} finally {
  await browser.close()
  rmSync(tmpDir, { recursive: true, force: true })
  stop()
}

if (problems.length) {
  console.error(`\nconsole errors (${problems.length}):`)
  for (const p of problems.slice(0, 10)) console.error(`  ${p}`)
  process.exitCode = 1
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] })
  if (r.status !== 0) {
    console.error(`\n${cmd} failed:\n${r.stderr?.toString().split('\n').slice(-12).join('\n')}`)
    process.exit(1)
  }
}
