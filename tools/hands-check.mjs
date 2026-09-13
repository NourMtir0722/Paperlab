#!/usr/bin/env node
/**
 * Does the fire really reach the paper?
 *
 * `/hands` is one feature now: a sheet of paper and a way to set it alight.
 * Everything else it used to do — the grab, the score, the fold, the tear,
 * the paint — is gone, so what is left to be wrong about is the ignition, and
 * there are three ways in:
 *
 *   · a MATCH, which is a pinch held still in free air,
 *   · a LIGHTER, which is a flame the camera can see anywhere in the frame,
 *   · and the panel's button, for a machine with no camera at all.
 *
 * All three end in the same place — `flameRef`, the one spot on the sheet the
 * library's `DamageField` is being ignited at — and this drives all three and
 * watches the paper.
 *
 * A webcam cannot be automated and the tracking is not the risky part. So the
 * hands here are scripted landmarks and the lighter is a PAINTED frame of
 * pixels, handed to the same detector the camera feeds. The camera itself is
 * still started once, for real, because that is the only way to prove the
 * wasm and the models load from this origin rather than a CDN.
 *
 * The lighter's two cases are the point of it: a warm flickering patch lights
 * the paper, and a warm STEADY one — a desk lamp, a window, a candle-coloured
 * bulb — must not. A page that sets itself on fire under a lamp is worse than
 * one that never lights.
 *
 * Run: `pnpm test:hands` (add --gpu for the platform renderer).
 */
import { chromium } from 'playwright'
import { rendererArgs, startApp } from './harness.mjs'
import { ensureHandsAssets } from './hands-assets.mjs'

const PORT = 5187
/**
 * How long to wait for the cloth to stop moving.
 *
 * This is a WALL-CLOCK number guarding a FRAME-DRIVEN simulation, which is
 * the whole reason it needs saying out loud. The sheet comes to rest after
 * roughly the same number of steps everywhere; how long that takes is
 * whatever the machine's renderer can manage. This harness has run in a
 * 65-second pass on a laptop and an 11-minute one under `--soft` on the same
 * laptop — same SwiftShader, ten times the wall clock — and a CI runner sits
 * somewhere in between. 30 seconds was enough for the first and not the
 * second, which is not a fact about the sim.
 *
 * So it is generous on purpose. Nothing waits the full duration when the
 * sheet settles promptly; the number only costs anything on the run that was
 * going to fail anyway, and the job's own timeout is the real backstop.
 */
const SETTLE_MS = 150_000
/**
 * How long to let a gesture's CONSEQUENCE arrive before calling it absent.
 *
 * Shorter than SETTLE_MS on purpose: this is not waiting for a sheet to fall
 * quiet, it is waiting for a rebuild or a throw that a working page does in a
 * handful of frames. If one has not landed in half a minute it is broken, not
 * slow, and the check should say so.
 */
const CATCH_UP_MS = 30_000
/** No query to speak of: the page has one feature and no knobs. */
const URL_PATH = '/hands/'
const ASPECT = 4 / 3

/**
 * The frame the painted lighter is handed to the detector in.
 *
 * The page samples the camera at 160×120 and this matches it, so the share of
 * the frame a patch covers here is the share it would cover live.
 */
const FRAME = { width: 160, height: 120 }

const installScriptedHand = () => {
  const ASPECT = 4 / 3

  window.__scriptedHand__ = (cx, cy, reach, gap, roll = 0) => {
    const PALM = 0.2
    const hand = Array.from({ length: 21 }, () => ({ x: cx, y: cy, z: 0 }))
    // (cx, cy) is the PINCH POINT — the midpoint the pointer is aimed from —
    // and the rest of the hand is built backwards from it so that a pose can
    // be moved around the frame without changing what it means.
    const indexTip = cy + (gap * PALM) / 2
    const wrist = indexTip + reach[0] * PALM
    hand[0] = { x: cx, y: wrist, z: 0 }
    hand[9] = { x: cx, y: wrist - PALM, z: 0 } // middle knuckle: the palm ruler
    hand[8] = { x: cx, y: indexTip, z: 0 }
    hand[4] = { x: cx, y: cy - (gap * PALM) / 2, z: 0 } // thumb tip
    for (const [i, tip] of [12, 16, 20].entries()) {
      hand[tip] = { x: cx, y: wrist - reach[i + 1] * PALM, z: 0 }
    }
    if (roll === 0) return hand
    // Turn the whole hand about its wrist. Every landmark above is on the
    // vertical through the wrist, so a rotation is one formula — and because
    // x is divided by the aspect on the way in, every distance the gesture
    // layer measures comes out unchanged. Only the ROLL moves.
    const radians = (roll * Math.PI) / 180
    return hand.map((point) => {
      const height = wrist - point.y
      return {
        x: cx - (Math.sin(radians) * height) / ASPECT,
        y: wrist - Math.cos(radians) * height,
        z: 0,
      }
    })
  }

  /** One hand, labelled — which is how the page tells two of them apart. */
  window.__hand__ = (cx, cy, pose, side = 'Right', roll = 0) => ({
    landmarks: window.__scriptedHand__(cx, cy, pose.reach, pose.gap, roll),
    handedness: side,
  })
}
/**
 * Poses, in palm lengths per finger plus a thumb-to-index gap. These mirror
 * `hands.fixtures.ts`, which is where the same poses are asserted in unit
 * tests — the numbers agreeing is the point.
 *
 * Only three survive the trim, and only one of them means anything to the
 * fire: a match is a PINCH, held. The other two are here to prove it is not
 * mistaken for a fist or an open hand, which is the whole difference between
 * a page that lights when you meant it to and one that lights when you did
 * not.
 */
const POSES = {
  palm: { reach: [2, 2, 2, 2], gap: 1.5 },
  pinch: { reach: [1.5, 2, 2, 2], gap: 0.2 },
  fistTight: { reach: [1, 1, 1, 1], gap: 0.2 },
  // Deliberately between every threshold, so a scan can move a hand around
  // the sheet without the page reading a gesture into it.
  neutral: { reach: [1.5, 1.5, 1.5, 1.5], gap: 0.6 },
}

// The page serves the tracker's wasm and models itself, so they have to be
// on disk before the server starts. Idempotent, and the reason this harness
// no longer needs a CDN to be up in order to pass.
await ensureHandsAssets()

const { base, stop } = await startApp('editor', PORT)
/**
 * A synthetic camera.
 *
 * Everything below drives `window.__HANDS__` with scripted hands and never
 * touches the webcam, which is the right way round — a webcam cannot be
 * automated and the tracking is not the part that can break. But it left the
 * MODEL LOADING path completely unexercised, and that path is now the whole
 * of what `pnpm hands:setup` is for. Chromium's fake device makes
 * `getUserMedia` answer with a test pattern, so the page can be started for
 * real, the wasm and both models can be loaded from disk exactly as a viewer
 * would load them, and the check that nothing came from a third-party origin
 * can mean something. (It did not, before this: with no camera, nothing was
 * ever fetched at all, and the check passed with the CDN URLs restored.)
 */
const browser = await chromium.launch({
  args: [...rendererArgs(), '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
})
const page = await browser.newPage({ viewport: { width: 1100, height: 800 } })

const problems = []
/**
 * Every origin the page reached for that was not its own.
 *
 * Exactly one is allowed, and which one is the whole point. The model WEIGHTS
 * come from Google because Google publishes no licence for them and hosting
 * them here would be redistribution under terms nobody can read. The wasm does
 * NOT — it is executable code in a page holding a camera stream, and it is
 * Apache-2.0, so it is served from our own origin. Anything else at all,
 * including MediaPipe's own telemetry endpoint, is a failure.
 */
const MODEL_HOST = 'https://storage.googleapis.com'
const offsite = new Set()
page.on('request', (request) => {
  const url = request.url()
  if (!/^https?:/.test(url)) return
  const origin = new URL(url).origin
  if (origin !== new URL(base).origin) offsite.add(origin)
})
page.on('pageerror', (error) => problems.push(String(error)))
page.on('console', (message) => {
  if (message.type() === 'error') problems.push(message.text())
})

try {
  await page.addInitScript(installScriptedHand)
  await page.goto(`${base}${URL_PATH}`)
  await page.waitForFunction(() => window.__HANDS__?.vertices(), null, { timeout: 30_000 })

  // ── Start the camera for real, once. ─────────────────────────────────────
  // Not to track anything — the fake device shows a test pattern with no
  // hands in it — but to prove the wasm loads from this origin and the models
  // load at all, the way a viewer would load them.
  //
  // Waited on the BUTTON, which is the only thing on the page that changes
  // only when the tracker is genuinely live. The obvious-looking waits are
  // both vacuous: the readout says "hand" whether or not a camera is running,
  // and "(model loading)" is absent before a camera starts as well as after
  // the model arrives. Both passed instantly, the stop click then found no
  // button, and the camera came up in the middle of the scripted gestures —
  // where the detection loop calls the same `step()` sixty times a second
  // with no hands in frame and resets every gesture between one scripted
  // frame and the next. Thirteen unrelated checks failed and none of them was
  // broken.
  /**
   * Wait for the page to actually RENDER a number of frames.
   *
   * The other half of the same correction. `until` fixed the measurements —
   * read until the reading is the one being waited for — and left the INPUT
   * pacing alone: a gesture was fed one landmark set every 24 or 30
   * milliseconds, which is a stand-in for "once per frame" that stops being
   * one the moment a frame costs more than 30 ms. On a loaded laptop or a CI
   * runner it silently becomes two or three gesture frames per rendered
   * frame, so the sheet sees a hand that moved three times as fast as the one
   * the numbers were tuned against — and a flick threshold measured in palm
   * widths per second fires when nobody flicked.
   *
   * Counting `requestAnimationFrame` instead makes the harness feed the page
   * at exactly the rate the page can consume, on any machine. It is also
   * strictly faster where there is headroom: a frame at 120 Hz no longer
   * waits out a 30 ms sleep.
   *
   * The timeout is a backstop for a tab that has stopped painting entirely —
   * a throttled background tab returns no frames at all, and waiting forever
   * for one is how a harness hangs instead of failing.
   */
  const frames = (count = 1) =>
    page.evaluate(
      (n) =>
        new Promise((resolve, reject) => {
          let seen = 0
          let stall = 0
          // Per FRAME, not per call. A slow renderer can take far longer than
          // five seconds to draw eighty frames and is still drawing; a tab
          // that has stopped painting draws none at all. Only the second is a
          // failure — and it has to FAIL: the first version resolved with
          // however many frames it had and every caller carried on as if it
          // had waited, which is the wall-clock bug in a new coat.
          const arm = () => {
            clearTimeout(stall)
            stall = setTimeout(
              () => reject(new Error(`rendering stopped after ${seen} of ${n} frames`)),
              5000,
            )
          }
          const tick = () => {
            if (++seen >= n) {
              clearTimeout(stall)
              resolve(seen)
            } else {
              arm()
              requestAnimationFrame(tick)
            }
          }
          arm()
          requestAnimationFrame(tick)
        }),
      count,
    )

  const live = page.getByRole('button', { name: 'stop the camera' })
  await page.getByRole('button', { name: 'start the camera' }).click()
  let cameraError = ''
  try {
    await live.waitFor({ state: 'visible', timeout: 120_000 })
  } catch {
    cameraError =
      (await page
        .locator('.hud .error')
        .textContent()
        .catch(() => '')) || 'never went live'
  }
  const cameraLive = cameraError === ''
  // The face model loads after the hands do, and the page works without it —
  // so it gets its own wait rather than holding up the one above.
  const blowReady = cameraLive
    ? await page
        .waitForFunction(() => !document.body.textContent?.includes('(model loading)'), null, {
          timeout: 120_000,
        })
        .then(() => true)
        .catch(() => false)
    : false
  // Stopping is not optional, for the reason above.
  //
  // And it gets the same deadline as starting, not a quarter of it. This click
  // lands the moment the face model arrives, which is the moment the page runs
  // its FIRST face inference — a cold one, on the CPU where a runner has no
  // GPU, in one long task on the main thread. The click waits behind it. On a
  // CI runner that has taken longer than 15 s often enough to fail about one
  // run in two, with the button found, visible, and the click never
  // acknowledged. A deadline, not a pause: a page that never answers still
  // fails here, just later.
  if (cameraLive) {
    await live.click({ timeout: 120_000 })
    await page.getByRole('button', { name: 'start the camera' }).waitFor({ timeout: 120_000 })
  }
  await frames(31)

  const vertices = () => page.evaluate(() => window.__HANDS__.vertices())
  const release = () => page.evaluate((a) => window.__HANDS__.drive(null, a), ASPECT)

  /**
   * A fresh sheet, through the page's own hook rather than its button.
   *
   * The button only appears once a frame has noticed the sheet burning, and
   * a lit match that touches the paper now COMMITS a flame there — so right
   * after the match checks the sheet may be alight with no button on the
   * panel yet, and a click that found nothing to press left it burning into
   * the next section, where the sheet never came to rest.
   */
  const freshSheet = () => page.evaluate(() => window.__HANDS__.fresh())

  /** The largest distance any vertex travelled between two readings. */
  const moved = (before, after) => {
    let max = 0
    for (let i = 0; i < after.length && i < before.length; i++) {
      max = Math.max(max, Math.abs(after[i] - before[i]))
    }
    return max
  }

  /**
   * Wait for the sheet to fall and go to sleep. Anything measured before it
   * settles is the sim's own motion wearing the result's clothes — and the
   * edge scan further down needs a sheet that is where it is going to stay.
   */
  const settle = async () => {
    try {
      await page.waitForFunction(
        () => {
          const now = window.__HANDS__.vertices()
          const before = window.__SETTLE__
          window.__SETTLE__ = now
          if (!before || before.length !== now.length) return false
          let max = 0
          for (let i = 0; i < now.length; i++) max = Math.max(max, Math.abs(now[i] - before[i]))
          window.__SETTLE_MAX__ = max
          return max < 1e-4
        },
        null,
        { timeout: SETTLE_MS, polling: 250 },
      )
    } catch {
      // A bare Playwright TimeoutError names the line and nothing else, which
      // on a machine you cannot attach a debugger to is one round trip per
      // question. Say how close it got instead: a max still far above the
      // threshold means the sheet is genuinely in motion, and a max hovering
      // just above it means this wait is short rather than the sim broken.
      const max = await page.evaluate(() => window.__SETTLE_MAX__ ?? Number.NaN)
      throw new Error(
        `the sheet never came to rest: still moving ${max.toExponential(2)} per poll after ` +
          `${SETTLE_MS / 1000}s (needs < 1e-4). Slower hardware needs longer — raise SETTLE_MS.`,
      )
    }
  }

  await settle()

  /**
   * Read until the reading is the one being waited for, then return it.
   *
   * This replaced `waitForTimeout(n)` immediately followed by a measurement.
   * Those numbers were wall-clock stand-ins for "the sim has caught up", and
   * they were tuned by watching one machine: the sheet needs a number of
   * FRAMES to rebuild at a new size or to fall off its pins, and how long
   * those take is the renderer's business. A CI runner got 160 ms of a slower
   * clock, measured a sheet that had not moved yet, and reported three
   * unrelated gestures as broken while the gesture layer was reading them
   * perfectly — the resize even computed its 1.64x correctly.
   *
   * There is no wall clock left in this file. Measurements wait on `until`,
   * everything else counts rendered frames with `frames`, and the only
   * durations remaining are DEADLINES — ceilings on how long a thing may take
   * before it is called broken, which is what a timeout should have been all
   * along.
   *
   * It does NOT weaken anything. The deadline is a ceiling, not a pass: a
   * thing that never happens still fails, and the last reading is returned
   * either way so the check prints the number it actually saw.
   */
  const until = async (read, done, ms = CATCH_UP_MS) => {
    const deadline = Date.now() + ms
    let value = await read()
    while (!done(value) && Date.now() < deadline) {
      await frames(2)
      value = await read()
    }
    return value
  }
  /**
   * Where the sheet actually is, in camera coordinates.
   *
   * Everything below has to aim AT the paper — score a line across it, take
   * hold of an edge — and hard-coding those numbers would be writing down
   * where the sheet rendered on the day this was authored. So sweep a
   * neutral pose across the frame and ask the page where each position
   * landed on the surface.
   *
   * Several heights, not one: a draped sheet can present its left edge at a
   * steep angle at one height and face-on at another, and a grab has to start
   * on an edge or there is nothing to tear. Only the middle of the sheet
   * counts, so that the nearest edge to a scan hit is a SIDE rather than the
   * top or the bottom.
   */
  const scanSurface = async () => {
    await settle()
    return page.evaluate(
      ([pose, a, margin]) => {
        // `marks.nearestEdge`, inlined — the scan has to pick points the PAGE
        // will agree are on an edge, or a grab aimed at one arms with no edge
        // and the gesture silently does nothing. Picking by smallest `u` and
        // hoping was how this drifted: after a drag the sheet's widest point
        // at mid height stopped being anywhere near its side.
        const sideOf = (uv) => {
          const d = [
            ['left', uv.u],
            ['right', 1 - uv.u],
            ['bottom', uv.v],
            ['top', 1 - uv.v],
          ]
          let best = null
          for (const c of d) if (c[1] < margin && (best === null || c[1] < best[1])) best = c
          // And never a corner: a pinch that lands in one PEELS the sheet
          // rather than taking hold of it, so an edge grab aimed at a corner
          // never grabs anything and the tear it was meant to make cannot
          // happen. `marks.CORNER_MARGIN`, which is deliberately roomier.
          if (uv.u < 0.26 || uv.u > 0.74) {
            if (uv.v < 0.26 || uv.v > 0.74) return null
          }
          return best?.[0] ?? null
        }
        let left = null
        let right = null
        let mid = null
        let corner = null
        let hits = 0
        for (const camY of [0.28, 0.35, 0.42, 0.5, 0.58, 0.65, 0.72]) {
          for (let camX = 0.12; camX <= 0.88; camX += 0.004) {
            const uv = window.__HANDS__.drive([window.__hand__(camX, camY, pose)], a).uv
            if (!uv) continue
            hits++
            const side = sideOf(uv)
            if (side === 'left' && (left === null || uv.u < left.u)) left = { camX, camY, u: uv.u }
            if (side === 'right' && (right === null || uv.u > right.u)) right = { camX, camY, u: uv.u }
            // Somewhere in the middle, for anything that must grab the sheet
            // without being near enough to an edge to tear it off.
            const off = Math.hypot(uv.u - 0.5, uv.v - 0.5)
            if (mid === null || off < mid.off) mid = { camX, camY, u: uv.u, off }
            // And the corner furthest into the bottom-left, for the one
            // gesture that is a pinch aimed somewhere particular.
            const toCorner = Math.hypot(uv.u, uv.v)
            if (corner === null || toCorner < corner.d) {
              corner = { camX, camY, u: uv.u, v: uv.v, d: toCorner }
            }
          }
          window.__HANDS__.drive(null, a)
        }
        return mid ? { left, right, mid, corner, hits } : null
      },
      [POSES.neutral, ASPECT, 0.18],
    )
  }
  const surface = await scanSurface()

  if (!surface) throw new Error('the scan never hit the sheet — is it rendering?')

  // ── The three poses the fire can tell apart. ─────────────────────────────
  // A match arms on `gesture.name === 'pinch'` and on nothing else, so these
  // three readings are the whole of what stands between the page and lighting
  // itself every time a hand closes.
  const named = await page.evaluate(
    ([poses, a]) => {
      // The reader debounces, so a pose has to be held to take effect.
      const read = (pose, frames = 5) => {
        let last
        for (let i = 0; i < frames; i++) {
          last = window.__HANDS__.drive([window.__hand__(0.5, 0.5, pose)], a)
        }
        window.__HANDS__.drive(null, a)
        return { name: last.gesture.name, aperture: last.gesture.aperture, curl: last.gesture.curl }
      }
      return { pinch: read(poses.pinch), palm: read(poses.palm), fist: read(poses.fistTight) }
    },
    [POSES, ASPECT],
  )

  // ── Blow. A puckered mouth drives `cloth.wind`, live and in place. ───────
  // The one parameter here that is CONTINUOUS: the sim reads it every frame
  // and wakes on a change, so the sheet lifts without a rebuild. Which is
  // also what makes it testable — the page is started with the wind at zero,
  // so a sheet that moves is a sheet that was blown at.
  //
  // It is also half of the fire: the same breath that lifts the sheet cools
  // the burn and blows a held match out. If the wind never reaches the cloth,
  // the blow-out below is measuring nothing.
  await release()
  await settle()
  const stillShape = await vertices()
  const rested = (await release()).blow
  const gale = await page.evaluate((a) => {
    let last
    for (let i = 0; i < 80; i++) last = window.__HANDS__.drive(null, a, { pucker: 1 })
    return last.blow
  }, ASPECT)
  const blown = await until(
    async () => moved(stillShape, await vertices()),
    (distance) => distance > 0.02,
  )
  const calmed = await page.evaluate((a) => {
    let last
    for (let i = 0; i < 80; i++) last = window.__HANDS__.drive(null, a, null)
    return last.blow
  }, ASPECT)
  // ── The match. A pinch held still in free air; a closing hand is not one. ─
  // On an injected clock, where a frame is exactly 16 ms whatever the machine
  // is doing: the dwell is a DURATION, and a `page.evaluate` round trip is
  // not one. None of this needs the fire to advance, so it runs inside one
  // evaluate — the field only steps on rendered frames.
  await freshSheet()
  await frames(12)
  await settle()
  const aim = ((await scanSurface()) ?? surface).mid

  const flame = await page.evaluate(
    ([poses, a, at]) => {
      let now = 100_000
      /** One frame of the injected clock. 16 ms, like a screen. */
      const tick = () => {
        now += 16
        return now
      }
      const hand = (x, y, pose, face = null) =>
        window.__HANDS__.drive([window.__hand__(x, y, pose)], a, face, tick())
      // Clear the tracker's own samples before taking over the clock: they
      // were taken from wall time and would all be in the future.
      window.__HANDS__.drive(null, a)

      // A hand that moves is not a match, however pinched it is. This is the
      // case the dwell exists for — a pinch is briefly part of every gesture.
      for (let i = 0; i <= 8; i++) hand(0.65 - i * 0.04, 0.17, poses.pinch)
      const moving = hand(0.33, 0.17, poses.pinch).match
      window.__HANDS__.drive(null, a)

      // Then the same pinch, held still in free air. Not a match yet after
      // twelve frames — under 200 ms — and one after another twenty.
      let early = 'none'
      for (let i = 0; i < 12; i++) early = hand(0.62, 0.15, poses.pinch).match
      for (let i = 0; i < 20; i++) hand(0.62, 0.15, poses.pinch)
      const lit = hand(0.62, 0.15, poses.pinch).match

      // Carried over the paper, the flame lands ON the paper: `at` is where
      // the sheet is being lit, which is what the field is ignited with.
      let touching = null
      for (let i = 0; i < 10; i++) touching = hand(at.camX, at.camY, poses.pinch).at
      // And the page is SHOWING the hand it is reading.
      const drawn = window.__HANDS__.marks().hand

      // Blowing puts it out, and it stays out while the hand stays shut —
      // otherwise blowing a flame out would not mean anything.
      let blown = 'lit'
      for (let i = 0; i < 8; i++) blown = hand(0.62, 0.15, poses.pinch, { pucker: 1 }).match
      for (let i = 0; i < 40; i++) hand(0.62, 0.15, poses.pinch)
      const relit = hand(0.62, 0.15, poses.pinch).match

      // Put the breath down before leaving the injected clock behind. The
      // blow above is still in the cloth's wind, and a sheet in a gale never
      // comes to rest — every measurement after this one waits for it to.
      for (let i = 0; i < 80; i++) window.__HANDS__.drive(null, a)
      const undrawn = window.__HANDS__.marks().hand
      return { moving, early, lit, touching, drawn, undrawn, blown, relit }
    },
    [POSES, ASPECT, aim],
  )

  // ── The lighter. A flame the camera can see, with no hand in it at all. ──
  // The detector is handed painted frames rather than a webcam, for the same
  // reason the hands are scripted. What is painted matters: a flame is bright,
  // warm in the order red-green-blue, and — the part that does the work —
  // never still. The lamp below is the same patch painted at the same size
  // every frame, which is exactly what a desk lamp looks like to a camera.
  await freshSheet()
  await frames(12)
  await settle()
  const seenAt = ((await scanSurface()) ?? surface).mid

  /**
   * Paint `count` frames and hand each to the page, returning what it said
   * about the last one.
   *
   * `wobble` is the flicker, as a fraction of the patch's radius. At 0 the
   * patch is identical frame to frame; a real flame's pixel count wanders by
   * a few percent, which is the whole difference the detector reads.
   */
  const show = (spot, { wobble = 0.12, count = 8, radius = 7, colour = [255, 150, 40] } = {}) =>
    page.evaluate(
      ([at, frame, o, seed]) => {
        const { width, height } = frame
        const pixels = new Uint8Array(width * height * 4)
        let saw = false
        for (let f = 0; f < o.count; f++) {
          pixels.fill(0)
          // A flame does not change colour as it flickers, it changes SIZE.
          const r = o.radius * (1 + o.wobble * Math.sin(f * 1.7 + seed))
          const cx = at.x * width
          const cy = at.y * height
          for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
              if (Math.hypot(x - cx, y - cy) > r) continue
              const i = (y * width + x) * 4
              pixels[i] = o.colour[0]
              pixels[i + 1] = o.colour[1]
              pixels[i + 2] = o.colour[2]
              pixels[i + 3] = 255
            }
          }
          saw = window.__HANDS__.sees(pixels, width, height)
        }
        return saw
      },
      [spot, FRAME, { wobble, count, radius, colour }, Math.random() * 6],
    )

  // Where the flame is in the FRAME is where the paper catches — the same
  // mapping a hand goes through, so the sheet's own mid point is a spot that
  // must land on it.
  const spot = { x: seenAt.camX, y: seenAt.camY }
  // A lamp first, and for long enough that the hold is satisfied twice over:
  // bright, warm, and utterly still.
  const lamp = await show(spot, { wobble: 0, count: 14 })
  const afterLamp = (await release()).at
  // Then a dark room, to clear the detector's memory of the lamp.
  const dark = await show({ x: 0.5, y: 0.5 }, { radius: 0, count: 12 })
  // And then a lighter.
  const flicker = await show(spot, { count: 14 })
  const boxed = (await page.evaluate(() => window.__HANDS__.marks())).fire
  const bannered = await page.locator('.banner').count()
  const aimed = (await release()).at
  const litByFlame = await until(
    () => page.evaluate((a) => window.__HANDS__.drive(null, a), ASPECT),
    (f) => f.front > 0 && f.particles > 0,
  )
  // Take it out of frame. What has caught goes on burning — that is what a
  // fire does — but nothing is lighting fresh paper any more.
  const goneDark = await show({ x: 0.5, y: 0.5 }, { radius: 0, count: 12 })
  const unaimed = (await release()).at
  // …and what caught goes on burning with the lighter gone. The sighting
  // committed a flame to the paper and the fire runs from there: this is the
  // difference between a detector that aims a flame and one that lights one.
  await frames(30)
  const burningOn = await page.evaluate((a) => window.__HANDS__.drive(null, a), ASPECT)

  // ── The burn. From the panel's button: no hand, no camera, real frames. ──
  // Last, because it burns the sheet and nothing after it would be measuring
  // the same paper. The fire advances on the RENDER clock, which is what lets
  // a machine with no camera light the page at all.
  await freshSheet()
  await frames(12)
  await settle()
  const beforeBurn = await vertices()
  await page.getByRole('button', { name: 'strike a match' }).click()
  const readFire = () => page.evaluate((a) => window.__HANDS__.drive(null, a), ASPECT)
  const caught = await until(readFire, (f) => f.front > 0 && f.particles > 0)
  const eaten = await until(readFire, (f) => f.remaining < 0.995)
  // And the sheet MOVES as it burns: the coupling inside the library shortens
  // the paper the field has charred and breaks what it has taken away. The
  // sheet was asleep before the match — `settle` above — so nothing else is
  // moving it.
  const burnMoved = moved(beforeBurn, await vertices())

  const capture = problems.filter((p) => /PointerCapture|NotFoundError/i.test(p))

  console.log('')
  console.log('  hands — one sheet of paper, and three ways to set it alight')
  console.log(`  ${'─'.repeat(58)}`)
  console.log(
    `  camera and models      ${cameraLive ? 'loaded' : `FAILED — ${cameraError}`}${blowReady ? ' · face model too' : ''}`,
  )
  console.log(`  pinch pose reads       ${named.pinch.name}  (aperture ${named.pinch.aperture.toFixed(2)})`)
  console.log(`  open pose reads        ${named.palm.name}  (aperture ${named.palm.aperture.toFixed(2)})`)
  console.log(
    `  fist pose reads        ${named.fist.name}  (aperture ${named.fist.aperture.toFixed(2)}, curl ${named.fist.curl.toFixed(2)})`,
  )
  console.log(`  wind, rest → blow → off  ${rested.toFixed(2)} → ${gale.toFixed(2)} → ${calmed.toFixed(2)}`)
  console.log(`  sheet moved, blown at  ${blown.toFixed(4)}`)
  console.log(
    `  match, moving vs held  ${flame.moving} vs ${flame.lit} · over the paper ${flame.touching ? `u=${flame.touching.u.toFixed(2)}` : 'nowhere'}`,
  )
  console.log(`  and blown out          ${flame.blown}${flame.relit === 'lit' ? ' · RELIT' : ' · stays out'}`)
  console.log(
    `  lighter, lamp vs flame ${lamp ? 'SEEN' : 'ignored'} vs ${flicker ? 'seen' : 'MISSED'} · dark ${dark ? 'SEEN' : 'ignored'}`,
  )
  console.log(
    `  and it aims the fire   ${aimed ? `u=${aimed.u.toFixed(2)} v=${aimed.v.toFixed(2)}` : 'nowhere'} → ${unaimed ? 'STILL AIMED' : 'let go when it left'}`,
  )
  console.log(
    `  flame burns the paper  front ${litByFlame.front.toFixed(4)} · ${litByFlame.particles} in the air · with it gone, front ${burningOn.front.toFixed(4)}`,
  )
  console.log(
    `  drawn on the page      hand ${flame.drawn ? 'yes' : 'NO'} (gone with it ${flame.undrawn ? 'NO' : 'yes'}) · fire box ${boxed ? 'yes' : 'NO'} · banner ${bannered ? 'yes' : 'NO'}`,
  )
  console.log(
    `  struck match burns     front ${caught.front.toFixed(4)} · ${caught.particles} in the air · paper ${(eaten.remaining * 100).toFixed(1)}% · sheet moved ${burnMoved.toFixed(4)}`,
  )
  console.log('')

  let failed = 0
  const check = (ok, label, detail) => {
    console.log(`  ${ok ? '✓' : '✗'} ${label}${ok ? '' : ` — ${detail}`}`)
    if (!ok) failed++
  }

  check(named.pinch.name === 'pinch', 'a pinch is named a pinch', named.pinch.name)
  check(named.palm.name === 'palm', 'an open hand is named a palm', named.palm.name)
  // The one the aperture alone gets wrong: a fist closes the thumb onto the
  // index just as tightly as a pinch does.
  check(
    named.fist.name === 'fist' && named.fist.aperture < 0.45,
    'a fist is not mistaken for a pinch',
    `${named.fist.name} at ${named.fist.aperture} palms`,
  )
  check(gale > 0.5, 'blowing at the paper raises the wind', `wind only reached ${gale}`)
  check(blown > 0.02, 'and the sheet moves because of it', `moved ${blown}`)
  check(calmed <= rested + 1e-9, 'the wind drops again when the blowing stops', `left at ${calmed}`)
  check(flame.moving !== 'lit', 'a pinch that travels is not a match', 'a passing hand lit one')
  check(flame.early !== 'lit', 'a pinch is not a match until it has been held still', 'it lit straight away')
  check(flame.lit === 'lit', 'a pinch held still in free air is a match', `it reached ${flame.lit}`)
  check(
    Boolean(flame.touching),
    'and carrying it over the sheet is what lights the sheet',
    'the flame touched nothing',
  )
  check(flame.drawn, 'the hand is drawn over the page while it is tracked', 'no hand on the overlay')
  check(!flame.undrawn, 'and it leaves the overlay with the hand', 'a hand still drawn with none in frame')
  check(flame.blown !== 'lit', 'blowing puts the flame out', 'it stayed lit through a blow')
  check(flame.relit !== 'lit', 'and it stays out until the hand opens', 'it relit on its own')
  check(!lamp, 'a steady warm light is not a flame', 'a desk lamp would set the page alight')
  check(!dark, 'and neither is a dark room', 'it saw a flame in an empty frame')
  check(flicker, 'a flickering one is', 'the camera never saw the lighter')
  check(!afterLamp, 'so a lamp aims nothing at the paper', 'the lamp lit the sheet')
  check(Boolean(aimed), 'and a lighter aims the fire where it is held', 'the flame landed nowhere')
  check(
    litByFlame.front > 0 && litByFlame.particles > 0,
    'a flame the camera can see sets the paper burning',
    `front ${litByFlame.front} · ${litByFlame.particles} particles`,
  )
  check(boxed, 'a flame the camera found is boxed on the page', 'no box round the flame')
  check(bannered > 0, 'and a banner says the fire was detected', 'no banner')
  check(
    burningOn.front > 0 || burningOn.remaining < litByFlame.remaining,
    'what caught goes on burning with the lighter gone',
    `front ${burningOn.front} · ${(burningOn.remaining * 100).toFixed(1)}% left`,
  )
  check(
    goneDark === false && !unaimed,
    'and taking it out of frame stops it lighting fresh paper',
    'the page went on igniting from where the flame used to be',
  )
  check(
    caught.front > 0,
    'a match struck from the panel sets the paper burning',
    `the front never caught (front ${caught.front})`,
  )
  check(
    caught.particles > 0,
    'and the burn throws embers and smoke into the air',
    `${caught.particles} particles`,
  )
  check(eaten.remaining < 0.995, 'the fire eats the paper', `${(eaten.remaining * 100).toFixed(1)}% left`)
  check(
    burnMoved > 0.01,
    'and the sheet moves as it burns — the coupling reaches the cloth',
    `moved only ${burnMoved}`,
  )
  check(capture.length === 0, 'no synthetic-pointer errors on the page', capture[0] ?? '')
  const strangers = [...offsite].filter((origin) => origin !== MODEL_HOST)
  check(
    strangers.length === 0,
    'the page reaches no third-party origin but the model host',
    strangers.join(', '),
  )
  // Named separately because it is the one that was actually happening, and a
  // rule about "third parties" is easy to loosen without noticing this went
  // with it. MediaPipe POSTs a usage log with an API key from inside the task
  // runner; the page's CSP is what stops it.
  check(
    ![...offsite].some((origin) => origin.includes('odml')),
    'and never MediaPipe’s telemetry endpoint',
    [...offsite].join(', '),
  )
  check(
    [...offsite].every((origin) => !origin.includes('jsdelivr') && !origin.includes('unpkg')),
    'the wasm comes from this origin, not a CDN',
    [...offsite].join(', '),
  )

  const other = problems.filter((p) => !capture.includes(p))
  if (other.length) {
    console.log('')
    console.log('  console errors:')
    for (const problem of other.slice(0, 5)) console.log(`    ${problem}`)
  }

  console.log('')
  if (failed) {
    console.log(`  ${failed} check${failed === 1 ? '' : 's'} failed.`)
    process.exitCode = 1
  } else {
    console.log('  Three ways to light it: a match in hand, a lighter in frame, a button on the panel.')
  }
} finally {
  await browser.close()
  stop()
}
