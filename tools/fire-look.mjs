#!/usr/bin/env node
/**
 * Photograph the fire at every moment the spec has a reference for, and lay
 * each shot beside the still it is meant to look like.
 *
 * §14.2 of `paperlab-fx-fire-spec.md`. It exists because the first fire
 * passed every test in this directory and looked cheap: `test:damage` asks
 * whether a burning sheet is warmer than a cold one, and a radial gradient
 * answers yes. No assertion was ever going to catch that. What catches it is
 * a contact sheet — this render, that photograph, next to each other, at the
 * same moment of the same burn — and then somebody's eyes.
 *
 * So most of what it does is take pictures. It also runs the §14.3 checks
 * that have something to check yet — they catch the old failure mode, not
 * ugliness — and fails if one does. **Passing it is still not "done".**
 * §14.4: a step is done when Noor says so.
 *
 *   pnpm test:fire-look            every phase, plus three crops on the front
 *   pnpm test:fire-look --phase=peak   just one
 *
 * The moments come from the page rather than from here — `/fx-lab` publishes
 * `window.__FXLAB__.phases`, measured off the simulation in `burn.ts` — so
 * this file cannot photograph a "peak" that the burn stopped having.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'
import { root, shotsDir, startApp } from './harness.mjs'
import { NO_REFS, fireRefsDir } from './fx-refs.mjs'

const PORT = 5197
/** 3:2, like every reference. A comparison between two aspect ratios is a comparison of croppings. */
const VIEWPORT = { width: 1200, height: 800 }

const argv = process.argv.slice(2)
const only = (argv.find((a) => a.startsWith('--phase=')) ?? '').slice(8)

const refs = fireRefsDir()
if (!refs) {
  console.error(NO_REFS)
  process.exit(1)
}

const out = join(shotsDir(), 'fire-look')
mkdirSync(out, { recursive: true })

const { base, stop } = await startApp('editor', PORT)
const browser = await chromium.launch({
  // SwiftShader in CI, where there is no GPU. The pictures differ from a
  // laptop's; what they are for — is the scorch a gradient, is the rim pink —
  // does not.
  args: process.env.CI ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [],
})

/**
 * One photograph of the stage.
 *
 * A fresh page each time, and `?ui=0` so the canvas is exactly the viewport:
 * nothing carries over between shots, and no shot depends on how wide the
 * panel happened to render.
 */
async function photograph(query, file) {
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 })
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))
  try {
    // On the flat sheet, for the reason `fire-budget.mjs` gives: a hanging
    // cloth settles on wall-clock frames, so two loads are not the same
    // picture, and these checks compare loads pixel for pixel.
    await page.goto(`${base}/fx-lab/?ui=0&physics=flat&camera=static&${query}`, { waitUntil: 'networkidle' })
    // Frame-driven, never timed: CI renders about five times slower than the
    // laptop, and a wall-clock wait there photographs an unfinished frame.
    await page.waitForFunction(() => window.__FXLAB__?.ready === true, null, { timeout: 180_000 })
    const state = await page.evaluate(() => window.__FXLAB__)
    const shot = await page
      .locator('canvas')
      .first()
      .screenshot(file ? { path: join(out, file) } : {})
    if (errors.length) throw new Error(errors.join('\n'))
    return { state, shot }
  } finally {
    await page.close()
  }
}

/**
 * Two of §14.3's checks, measured and PRINTED rather than asserted.
 *
 * They are the two the first fire failed. "No pink" (§13.3): red added to
 * white paper makes pink, which is why `Never_this.png` reads salmon. "The
 * glow must be brighter than the whitest paper" (§4.3): it cannot be, while
 * the glow is a colour blended into the surface rather than a value that
 * blooms.
 *
 * Not assertions yet because they would both fail today by design, and a gate
 * that fails on the day it is written is a gate nobody runs. Steps 2 and 4
 * turn them into `check()`s.
 */
async function measure(png) {
  const page = await browser.newPage()
  try {
    return await page.evaluate(
      async (src) => {
        const image = new Image()
        image.src = src
        await image.decode()
        const canvas = document.createElement('canvas')
        canvas.width = image.width
        canvas.height = image.height
        const context = canvas.getContext('2d')
        context.drawImage(image, 0, 0)
        const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
        let pink = 0
        let lit = 0
        let brightest = 0
        let paper = 0
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i] / 255
          const g = data[i + 1] / 255
          const b = data[i + 2] / 255
          const max = Math.max(r, g, b)
          const min = Math.min(r, g, b)
          if (max < 0.04) continue // the black stage
          lit++
          brightest = Math.max(brightest, max)
          // Paper: bright and nearly neutral. The whitest of it is what a glow
          // has to beat to read as light rather than as paint.
          if (max - min < 0.06) paper = Math.max(paper, max)
          if (max - min > 0.15) {
            const d = max - min
            let hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
            hue = (((hue * 60) % 360) + 360) % 360
            if (hue >= 300 && hue <= 355) pink++
          }
        }
        return { pink: pink / Math.max(1, lit), brightest, paper }
      },
      `data:image/png;base64,${png.toString('base64')}`,
    )
  } finally {
    await page.close()
  }
}

let failed = 0
const check = (ok, label, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${ok ? '' : ` — ${detail}`}`)
  if (!ok) failed++
}

/**
 * How far apart two photographs are: the share of pixels that moved by more
 * than two levels in any channel, and the mean move.
 *
 * Two levels, not zero, only where the pictures come from DIFFERENT pipelines
 * — the post pass renders through a half-float target with its own MSAA, and
 * an antialiased edge is allowed to land a level differently. Where both come
 * from the same pipeline the checks below use exact equality instead.
 */
async function distance(a, b) {
  const page = await browser.newPage()
  try {
    return await page.evaluate(
      async ([x, y]) => {
        const load = async (src) => {
          const image = new Image()
          image.src = src
          await image.decode()
          const canvas = document.createElement('canvas')
          canvas.width = image.width
          canvas.height = image.height
          const context = canvas.getContext('2d')
          context.drawImage(image, 0, 0)
          return context.getImageData(0, 0, canvas.width, canvas.height).data
        }
        const [p, q] = [await load(x), await load(y)]
        let moved = 0
        let sum = 0
        for (let i = 0; i < p.length; i += 4) {
          const d = Math.max(
            Math.abs(p[i] - q[i]),
            Math.abs(p[i + 1] - q[i + 1]),
            Math.abs(p[i + 2] - q[i + 2]),
          )
          sum += d
          if (d > 2) moved++
        }
        return { moved: moved / (p.length / 4), mean: sum / (p.length / 4) }
      },
      [a, b].map((png) => `data:image/png;base64,${png.toString('base64')}`),
    )
  } finally {
    await page.close()
  }
}

/**
 * The band of type at the top of the sheet in the lab's wide camera — as far
 * from the burn as the sheet goes. Tied to that camera; move it and re-aim.
 */
const TOP_OF_SHEET = { x: 440, y: 105, width: 360, height: 120 }

/** Mean red minus mean blue over a region, 0..255 — how warm it is. */
async function warmth(png, clip) {
  const page = await browser.newPage()
  try {
    return await page.evaluate(
      async ({ src, clip }) => {
        const image = new Image()
        image.src = src
        await image.decode()
        const canvas = document.createElement('canvas')
        canvas.width = image.width
        canvas.height = image.height
        const context = canvas.getContext('2d')
        context.drawImage(image, 0, 0)
        const { data } = context.getImageData(clip.x, clip.y, clip.width, clip.height)
        let sum = 0
        for (let i = 0; i < data.length; i += 4) sum += data[i] - data[i + 2]
        return sum / (data.length / 4)
      },
      { src: `data:image/png;base64,${png.toString('base64')}`, clip },
    )
  } finally {
    await page.close()
  }
}

/**
 * Where two photographs differ, against where the void is.
 *
 * `moved` counts pixels that changed by more than two levels; `outside`
 * counts the ones with no near-black pixel of `voidPng` within `radius` —
 * i.e. light that landed away from the edge of a hole. The black stage around
 * the sheet counts as void too, which is harmless: nothing is lit out there.
 */
async function nearVoid(a, b, voidPng, radius) {
  const page = await browser.newPage()
  try {
    return await page.evaluate(
      async ([x, y, z, r]) => {
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
            w: image.width,
            h: image.height,
          }
        }
        const [p, q, v] = [await load(x), await load(y), await load(z)]
        const { w, h } = p
        // A distance field would be tidier; a box search is plenty at 1200 × 800.
        const dark = new Uint8Array(w * h)
        for (let i = 0; i < w * h; i++) {
          const k = i * 4
          dark[i] = Math.max(v.data[k], v.data[k + 1], v.data[k + 2]) < 8 ? 1 : 0
        }
        let moved = 0
        let outside = 0
        // The second frame again, with every stray pixel painted magenta, so
        // a failure says where as well as how many.
        const marked = new ImageData(new Uint8ClampedArray(q.data), w, h)
        for (let yy = 0; yy < h; yy++) {
          for (let xx = 0; xx < w; xx++) {
            const k = (yy * w + xx) * 4
            const d = Math.max(
              Math.abs(p.data[k] - q.data[k]),
              Math.abs(p.data[k + 1] - q.data[k + 1]),
              Math.abs(p.data[k + 2] - q.data[k + 2]),
            )
            if (d <= 2) continue
            moved++
            let near = false
            for (let dy = -r; dy <= r && !near; dy++) {
              const ny = yy + dy
              if (ny < 0 || ny >= h) continue
              for (let dx = -r; dx <= r; dx++) {
                const nx = xx + dx
                if (nx >= 0 && nx < w && dark[ny * w + nx]) {
                  near = true
                  break
                }
              }
            }
            if (!near) {
              outside++
              marked.data.set([255, 0, 255, 255], k)
            }
          }
        }
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        canvas.getContext('2d').putImageData(marked, 0, 0)
        return { moved, outside, marked: canvas.toDataURL('image/png') }
      },
      [...[a, b, voidPng].map((png) => `data:image/png;base64,${png.toString('base64')}`), radius],
    )
  } finally {
    await page.close()
  }
}

/**
 * §14.3's checks that step 2 makes checkable. Each is paired with a control,
 * because a comparison that cannot fail proves nothing.
 */
async function gate(peakAt, look) {
  console.log('\nthe §14.3 checks that apply so far')
  // Everything a fire puts in the frame besides the sheet's own shading —
  // the scripted match included, which stands on the sheet from t = 0 and
  // would otherwise be the only thing an "unburnt sheet" check measured.
  // ONE `off` per query: the lab reads the first and ignores the rest, and a
  // check written with two once turned nothing off and could not fail.
  const quiet = 'match,flames,fluid,light,embers,smoke,ash'
  const shot = async (query) => (await photograph(query, null)).shot

  // The render has to be repeatable, or every "identical" below is noise.
  const peak = await shot(`t=${peakAt}`)
  check(
    peak.equals(await shot(`t=${peakAt}`)),
    'the same frame photographs the same twice',
    'not deterministic',
  )

  // Post identity: the pass must not change a sheet with no fire on it. Two
  // rigs — `noir` because its exposure is 1.05, and the composer takes the
  // renderer's tone curve AND its exposure away; a pass that put back one
  // and not the other would pass on studio (exposure 1) alone.
  for (const lighting of ['studio', 'noir']) {
    const on = await shot(`t=0&off=${quiet}&lighting=${lighting}`)
    const off = await shot(`t=0&off=${quiet}&lighting=${lighting}&post=0`)
    const d = await distance(on, off)
    check(
      d.moved < 0.005 && d.mean < 0.5,
      `post on and off draw the same unburnt sheet under ${lighting} ` +
        `(${(d.moved * 100).toFixed(2)}% of pixels moved, mean ${d.mean.toFixed(2)} levels)`,
      'the pass changes paper it has no business touching',
    )
  }

  // Heat emits ONLY at the ember line (§5.3, §13.2). Bloom and particles off,
  // so what is compared is the sheet's own light and nothing else: turning
  // heat on may change pixels only within a few of the hole's edge. The band
  // is measured off the same frame with the heat off — its near-black pixels
  // are the void — and 8 px is ~3.5 mm of A4 at this camera: ash lip plus
  // the widest ember line, with room for antialiasing.
  const cold = await shot(`t=${peakAt}&bloom=0&off=heat,${quiet}`)
  const hot = await shot(`t=${peakAt}&bloom=0&off=${quiet}`)
  // How far heat may light from the void: the ember zone the look sets —
  // the ash lip plus the widest bead, and half a millimetre of antialiasing —
  // at this camera's ~2.3 px a millimetre. 8 px at the spec's numbers; wider
  // only as far as the tuned look is wider, never as a margin of its own.
  const zoneMm = look ? look.lipWidth + look.emberWidth + 0.5 : 3.5
  const radius = Math.max(8, Math.ceil((zoneMm * 8) / 3.5))
  const edge = await nearVoid(cold, hot, cold, radius)
  if (edge.outside > 0) {
    writeFileSync(join(out, 'ember-stray.png'), Buffer.from(edge.marked.split(',')[1], 'base64'))
    console.log('  stray heat marked magenta → ember-stray.png')
  }
  check(
    edge.moved > 0,
    `the ember line is there — heat lights ${edge.moved} pixels at the peak`,
    'heat changes nothing, so the check below is blind',
  )
  check(
    edge.outside === 0,
    `and only at the edge of the hole — ${edge.outside} lit pixels further than ${radius} px from the void`,
    'heat is lighting paper away from the edge, which is the painted glow again',
  )

  // Paper never blooms (§7). With the heat off as well as the particles,
  // nothing on the sheet emits — so bloom on and bloom off must be the same
  // picture, at the peak (scorched, charred, holed, ash-lipped paper as well
  // as clean), under `studio` and under `window`, which lights paper
  // brightest and is the preset that set the threshold.
  for (const lighting of ['studio', 'window']) {
    for (const t of [0, peakAt]) {
      const q = `t=${t}&off=heat,${quiet}&lighting=${lighting}`
      check(
        (await shot(q)).equals(await shot(`${q}&bloom=0`)),
        `paper never blooms under ${lighting}, at ${t}s`,
        'the threshold is below something on the sheet',
      )
    }
  }

  // Fire is a light (§4.8, §13.13): it has to reach the whole sheet — Hero.png
  // warms it to the top edge. Measured in the band of type at the top of the
  // sheet, far from the burn, with the flames and particles off so the light
  // is the only thing that differs.
  const lit = await shot(`t=${peakAt}&off=match,flames,fluid,embers,smoke,ash`)
  const unlit = await shot(`t=${peakAt}&off=${quiet}`)
  const warmer = (await warmth(lit, TOP_OF_SHEET)) - (await warmth(unlit, TOP_OF_SHEET))
  check(
    warmer > 1,
    `the fire lights the whole sheet — the top of it is warmer by ${warmer.toFixed(1)} (red over blue)`,
    'a fire that lights nothing around it looks pasted on',
  )
  // …and paper it lights still never blooms: the light is bright, it is not
  // allowed to push paper past the threshold that means "this is fire".
  const litPaper = `t=${peakAt}&off=heat,match,flames,fluid,embers,smoke,ash`
  check(
    (await shot(litPaper)).equals(await shot(`${litPaper}&bloom=0`)),
    'and paper in the fire light never blooms',
    'the fire light pushes paper past the bloom threshold',
  )

  // …and the control: bloom is actually on. Embers are authored past 1.0,
  // so at the peak they are the thing that must bloom.
  check(
    !peak.equals(await shot(`t=${peakAt}&bloom=0`)),
    'and the fire blooms — the pass is really running',
    'bloom on and off match with embers in frame, so the checks above are blind',
  )
}

const pairs = []
let measured = null

try {
  // The phase table, from the page. Loaded once, before anything is shot.
  const first = await photograph('t=0', 'boot.png')
  const phases = first.state.phases.filter((p) => !only || p.id === only)
  console.log(`\n${phases.length} phase${phases.length === 1 ? '' : 's'}, tier ${first.state.tier}\n`)

  for (const phase of phases) {
    const file = `${phase.id}.png`
    const { state, shot } = await photograph(`t=${phase.at}`, file)
    const gone = (1 - state.stats.remaining) * 100
    console.log(
      `  ${phase.id.padEnd(9)} ${String(phase.at).padStart(5)}s  → ${file}   ${gone.toFixed(1)}% of the sheet gone`,
    )
    if (phase.gap) console.log(`             ⚠ ${phase.gap}`)
    pairs.push([join(out, file), `${phase.id} · ${phase.at}s · the render`])
    pairs.push([resolve(refs, phase.reference), `${phase.reference} · ${phase.shows}`])
    if (phase.id === 'peak') measured = await measure(shot)
  }

  // The close crops, aimed at the rim the burn actually has — the page picks
  // them off its own field, so they cannot drift onto clean paper.
  const crops = []
  if (!only || only === 'peak') {
    const peak = first.state.phases.find((p) => p.id === 'peak')
    const at = await photograph(`t=${peak.at}`, 'peak-again.png')
    for (const crop of at.state.crops) {
      const file = `ember-${crop.id}.png`
      await photograph(`t=${peak.at}&view=close&u=${crop.u}&v=${crop.v}`, file)
      console.log(`  crop ${crop.id.padEnd(6)} u ${crop.u.toFixed(3)} v ${crop.v.toFixed(3)}  → ${file}`)
      crops.push([join(out, file), `${crop.id} · ${crop.label}`])
      crops.push([resolve(refs, crop.reference), crop.reference])
    }
  }

  /** One sheet per set of pairs: render, reference, render, reference. */
  const sheet = (tiles, file, title) => {
    if (tiles.length === 0) return
    const result = spawnSync(
      'node',
      [
        join(root, 'tools/contact-sheet.mjs'),
        `--out=${join(out, file)}`,
        '--cols=2',
        '--width=1500',
        ...tiles.map(([path, label]) => `${path}=${label}`),
      ],
      { stdio: 'inherit', cwd: root },
    )
    if (result.status !== 0) throw new Error(`contact sheet ${title} failed`)
  }

  console.log()
  sheet(pairs, 'phases.jpg', 'phases')
  sheet(crops, 'edge.jpg', 'the edge')

  await gate(first.state.phases.find((p) => p.id === 'peak').at, first.state.look)

  if (measured) {
    console.log('\nmeasured at the peak — printed, not asserted, until step 4:')
    console.log(`  pink (hue 300–355°)   ${(measured.pink * 100).toFixed(2)}% of the lit frame`)
    console.log(
      `  brightest / paper     ${measured.brightest.toFixed(3)} / ${measured.paper.toFixed(3)}` +
        `   §4.3 wants the fire above the whitest paper`,
    )
  }

  const index = [
    '# fire-look',
    '',
    'Renders of the scripted burn in `/fx-lab`, each beside the still it is judged against.',
    '',
    '- `phases.jpg` — §9, moment by moment',
    '- `edge.jpg` — three crops on the burning edge',
    '',
    'Before claiming a step done: write, per capture, what differs from its reference,',
    'using §4 and §13 as the checklist. Then Noor reviews. (§14.4)',
    '',
  ].join('\n')
  writeFileSync(join(out, 'README.md'), index)

  console.log(`\n${out.replace(`${root}/`, '')} — open phases.jpg and edge.jpg.`)
  if (failed) {
    console.error(`${failed} check${failed === 1 ? '' : 's'} failed.`)
    process.exitCode = 1
  }
  console.log('Passing is not done: write what differs from each reference, then Noor decides. (§14.4)')
} finally {
  await browser.close()
  stop()
}
