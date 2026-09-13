#!/usr/bin/env node
/**
 * What the fire must MEASURE, in the frame, on every commit.
 *
 * `tools/fire-look.mjs` photographs the burn beside the stills it is meant to
 * look like, and that is the half only eyes can do. It also cannot run in CI
 * and never will: the references are 20 MB of stills deliberately kept out of
 * this repo (`tools/fx-refs.mjs`), so the one gate on how fire looks is a
 * thing somebody remembers to run.
 *
 * This is the half that does not need them. Every check below compares the
 * frame to ITSELF — the same burn with one thing switched off — so there is
 * nothing to resolve, nothing to download, and no reason it cannot run beside
 * `test:damage`.
 *
 * It exists because of a specific hole. All twelve of `fire-look`'s checks
 * passed while the review scored the result 3.5/10, and they passed because
 * every one of them asks "did nothing change that should not have" — post
 * leaves an unburnt sheet alone, heat lights only the rim, paper never blooms.
 * None asked whether the fire was any good. These do, in the two ways a
 * machine can: is the fire actually brighter than the paper (measured by
 * whether bloom has anything to do), and is the black stage still black.
 *
 * The burn's own numbers — spread in mm/s, the char band, how long it lives —
 * are NOT here. They are properties of the simulation with no renderer in
 * them, so they are unit tests: `apps/editor/src/harness/pace.test.ts`.
 *
 *   pnpm test:fire-budget
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { shotsDir, startApp } from './harness.mjs'

const PORT = 5198
/** 3:2, the references' shape — kept so a frame here is the frame `fire-look` shoots. */
const VIEWPORT = { width: 1200, height: 800 }

const out = join(shotsDir(), 'fire-budget')
mkdirSync(out, { recursive: true })

const { base, stop } = await startApp('editor', PORT)
const browser = await chromium.launch({
  args: process.env.CI ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [],
})

let failed = 0
const check = (ok, label, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${ok || !detail ? '' : ` — ${detail}`}`)
  if (!ok) failed++
}

/** One photograph of the stage, frame-driven — CI is about five times slower. */
async function shot(query, file) {
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 })
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))
  try {
    // On the flat sheet. The lab hangs its sheet as cloth now, and a live
    // cloth settles on wall-clock frames: on CI's software renderer 60 frames
    // is half a second of it, so two loads photograph it at two different
    // moments of settling — and every budget here compares two loads pixel
    // for pixel. These measure the fire's light, not how the paper drapes.
    await page.goto(`${base}/fx-lab/?ui=0&physics=flat&${query}`, { waitUntil: 'networkidle' })
    await page.waitForFunction(() => window.__FXLAB__?.ready === true, null, { timeout: 180_000 })
    const state = await page.evaluate(() => window.__FXLAB__)
    const png = await page
      .locator('canvas')
      .first()
      .screenshot(file ? { path: join(out, file) } : {})
    if (errors.length) throw new Error(errors.join('\n'))
    return { png, state }
  } finally {
    await page.close()
  }
}

/** Run `body` over the decoded pixels of one or two PNGs, in a page. */
async function pixels(pngs, body) {
  const page = await browser.newPage()
  try {
    return await page.evaluate(
      async ([sources, source]) => {
        const load = async (src) => {
          const image = new Image()
          image.src = src
          await image.decode()
          const canvas = document.createElement('canvas')
          canvas.width = image.width
          canvas.height = image.height
          const context = canvas.getContext('2d')
          context.drawImage(image, 0, 0)
          return {
            data: context.getImageData(0, 0, canvas.width, canvas.height).data,
            w: canvas.width,
            h: canvas.height,
          }
        }
        const frames = []
        for (const s of sources) frames.push(await load(s))
        // eslint-disable-next-line no-new-func
        return new Function('frames', `return (${source})(frames)`)(frames)
      },
      [pngs.map((png) => `data:image/png;base64,${png.toString('base64')}`), body.toString()],
    )
  } finally {
    await page.close()
  }
}

/** Everything a fire puts in the frame besides the sheet's own shading. */
const QUIET = 'match,flames,fluid,light,embers,smoke,ash'

console.log('\nfire, measured against itself\n')

const boot = await shot('t=0', 'boot.png')
const peakAt = boot.state.phases.find((p) => p.id === 'peak').at
console.log(`  peak at ${peakAt}s, tier ${boot.state.tier}\n`)

// 1. Bloom has something to do.
//
// The one number that says the fire is brighter than the paper. It cannot be
// read off the frame directly — the tone curve saturates, so the brightest
// fire and the brightest paper both photograph at about 1.0, which is exactly
// why "brightest / paper 0.996 / 0.957" sat in the gate's output for weeks
// while the flames were half the brightness they needed to be. What CAN be
// measured is the consequence: bloom only touches what clears the threshold,
// so how much of the frame it changes IS how much of the frame is fire.
const peak = await shot(`t=${peakAt}`, 'peak.png')
const noBloom = await shot(`t=${peakAt}&bloom=0`, 'peak-no-bloom.png')
const bloomShare = await pixels([peak.png, noBloom.png], (frames) => {
  const [a, b] = frames
  let moved = 0
  for (let i = 0; i < a.data.length; i += 4) {
    const d = Math.max(
      Math.abs(a.data[i] - b.data[i]),
      Math.abs(a.data[i + 1] - b.data[i + 1]),
      Math.abs(a.data[i + 2] - b.data[i + 2]),
    )
    if (d > 8) moved++
  }
  return moved / (a.data.length / 4)
})
// 0.5%, not the 2% this was written with. That bar was set while bloom
// touched 17.6% of the frame — when the whole inside of every flame was
// over-exposed, the look that was then rejected as "too much white inside".
// A real flame over-exposes only at its hottest root (Flame_base.png: 0.9% of
// its pixels near-white), and a bar that demands a large bloomed area demands
// that white back. What this check exists to catch is the original failure:
// flames that never clear the threshold at all, which measured 0.01-0.07%.
// 0.5% sits seven times above that.
check(
  bloomShare >= 0.005,
  `the fire is bright enough to bloom — it changes ${(bloomShare * 100).toFixed(2)}% of the frame (want ≥ 0.5%)`,
  'bloom barely touches the fire, so the flames are not clearing the threshold. Raise what they EMIT, never the threshold',
)

// 2. …and not so bright that it takes the room with it.
//
// The other end of the same setting, and the one that has no upper bound in
// any existing check. Raising the flames' emission to clear the threshold and
// leaving bloom at the strength it was tuned at while they were UNDER it lit
// the whole black stage olive — a fire in a photographer's studio, not a
// sheet on black. Measured on the corners, which are stage and nothing else.
const stage = await pixels([peak.png], (frames) => {
  const [f] = frames
  const box = Math.round(Math.min(f.w, f.h) * 0.12)
  let sum = 0
  let n = 0
  for (const [x0, y0] of [
    [0, 0],
    [f.w - box, 0],
    [0, f.h - box],
    [f.w - box, f.h - box],
  ]) {
    for (let y = y0; y < y0 + box; y++) {
      for (let x = x0; x < x0 + box; x++) {
        const i = (y * f.w + x) * 4
        sum += (f.data[i] + f.data[i + 1] + f.data[i + 2]) / 3
        n++
      }
    }
  }
  return sum / n
})
check(
  stage < 12,
  `the stage behind it is still black — ${stage.toFixed(1)} of 255 in the corners (want < 12)`,
  'the bloom of a large bright area is tinting the whole background',
)

// 3. No pink (§13.3).
//
// Red light added to cream paper is the failure the whole spec opens with,
// and `Never_this.png` is a picture of it.
const pink = await pixels([peak.png], (frames) => {
  const [f] = frames
  let lit = 0
  let pinkish = 0
  for (let i = 0; i < f.data.length; i += 4) {
    const r = f.data[i] / 255
    const g = f.data[i + 1] / 255
    const b = f.data[i + 2] / 255
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    if (max < 0.15 || max - min < 0.04) continue
    lit++
    let h = 0
    if (max === r) h = ((g - b) / (max - min)) * 60
    else if (max === g) h = ((b - r) / (max - min)) * 60 + 120
    else h = ((r - g) / (max - min)) * 60 + 240
    if (h < 0) h += 360
    if (h >= 300 && h <= 355) pinkish++
  }
  return lit ? pinkish / lit : 0
})
check(
  pink < 0.005,
  `no pink — ${(pink * 100).toFixed(2)}% of the lit frame in 300–355° (want < 0.5%)`,
  'red light on cream paper',
)

// 4. Paper never blooms — the invariant the threshold exists for, kept here
// too so this file can stand alone as the CI gate.
for (const lighting of ['studio', 'window']) {
  const q = `t=${peakAt}&off=heat,${QUIET}&lighting=${lighting}`
  const on = await shot(q)
  const off = await shot(`${q}&bloom=0`)
  check(
    on.png.equals(off.png),
    `paper never blooms under ${lighting}`,
    'the threshold is below something on the sheet',
  )
}

// 5. The flames carry detail finer than the solver's grid.
//
// "Butter" has a number: the energy in a frame at fine spatial scales. A
// flame that has been advected into a smooth blob has almost none, and no
// check could see the difference — the review had to say "tongues and tips
// blur into butter" and hope. Measured as the mean absolute difference
// between neighbouring pixels over the region the fire is in, against the
// same frame with the fire switched off, so the sheet's own texture does not
// count toward it.
const fireOnly = await pixels([peak.png, (await shot(`t=${peakAt}&off=fluid`)).png], (frames) => {
  const [a, b] = frames
  let energy = 0
  let n = 0
  for (let y = 1; y < a.h - 1; y++) {
    for (let x = 1; x < a.w - 1; x++) {
      const i = (y * a.w + x) * 4
      // Only where the flames actually are.
      const differs =
        Math.abs(a.data[i] - b.data[i]) +
        Math.abs(a.data[i + 1] - b.data[i + 1]) +
        Math.abs(a.data[i + 2] - b.data[i + 2])
      if (differs < 24) continue
      const here = (a.data[i] + a.data[i + 1] + a.data[i + 2]) / 3
      const right = (a.data[i + 4] + a.data[i + 5] + a.data[i + 6]) / 3
      const down = (a.data[i + a.w * 4] + a.data[i + a.w * 4 + 1] + a.data[i + a.w * 4 + 2]) / 3
      energy += Math.abs(here - right) + Math.abs(here - down)
      n++
    }
  }
  return { energy: n ? energy / n : 0, area: n / (a.w * a.h) }
})
check(
  fireOnly.area > 0.005,
  `the flames are in the frame — ${(fireOnly.area * 100).toFixed(2)}% of it (want > 0.5%)`,
  'nothing to measure detail on',
)
check(
  fireOnly.energy > 1.2,
  `and they carry detail finer than the grid — ${fireOnly.energy.toFixed(2)} levels between neighbours (want > 1.2)`,
  'the flames are smooth blobs: advection has smeared away everything the solver resolved',
)

writeFileSync(join(out, 'README.md'), `Measured budgets, not pictures. See tools/fire-budget.mjs.\n`)
console.log(`\n.shots/fire-budget — ${failed ? `${failed} failed.` : 'all budgets met.'}`)

await browser.close()
await stop()
process.exit(failed ? 1 : 0)
