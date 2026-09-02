#!/usr/bin/env node
/**
 * Do hand-made gestures really reach the paper?
 *
 * The hands harness rests on one claim per gesture, and the load-bearing one
 * is the first: a `PointerEvent` the page dispatched itself drives the cloth
 * grab exactly as a mouse does, INCLUDING the pointer capture that keeps a
 * drag alive once it leaves the sheet. That claim is cheap to assert and
 * expensive to be wrong about — if capture silently fails, the paper lets go
 * the moment your hand passes the edge, and the whole approach has to be
 * rebuilt around a real library API instead.
 *
 * A webcam cannot be automated, and the tracking is not the risky part. So
 * this drives `window.__HANDS__` with scripted hands and watches the sheet.
 *
 * Two passes for the grab, because "the vertices moved" proves nothing on its
 * own — a cloth sim moves on its own. The control pass sweeps an OPEN hand
 * across the paper and must leave it alone; the grab pass pinches and drags
 * the same path and must drag the paper with it. The verdict is the ratio.
 *
 * Everything after that asserts the same shape of thing for one more gesture:
 * that it lands on the library feature it claims, and on no other.
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
/** Wind off: something is trying to measure a drag, and wind is noise. */
const URL_PATH = '/hands/?wind=0'
const ASPECT = 4 / 3

/**
 * A hand, as MediaPipe would report it, holding a pinch of `gap` at (cx, cy).
 *
 * Installed into the page rather than written here because `page.evaluate`
 * runs in the browser and cannot close over this file — and three inlined
 * copies of a landmark layout is three places for it to drift.
 *
 * Only the four landmarks the adapter reads are meaningful. The palm is a
 * fixed 0.20 tall, so the aperture is exactly `gap / 0.2`, which is what lets
 * this script name apertures instead of guessing at them.
 */
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
 */
const POSES = {
  palm: { reach: [2, 2, 2, 2], gap: 1.5 },
  pinch: { reach: [1.5, 2, 2, 2], gap: 0.2 },
  point: { reach: [2, 1, 1, 1], gap: 1 },
  fistLight: { reach: [1.2, 1.2, 1.2, 1.2], gap: 0.2 },
  fistTight: { reach: [1, 1, 1, 1], gap: 0.2 },
  // Deliberately between every threshold, so a scan can move the pointer
  // around the sheet without the paper interpreting it as anything.
  neutral: { reach: [1.5, 1.5, 1.5, 1.5], gap: 0.6 },
}

/** Camera-space start and end of the sweep, chosen to end OFF the sheet. */
const FROM = { x: 0.5, y: 0.5 }
const TO = { x: 0.255, y: 0.29 }
const STEPS = 24

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
  if (cameraLive) {
    await live.click({ timeout: 15_000 })
    await page.getByRole('button', { name: 'start the camera' }).waitFor({ timeout: 15_000 })
  }
  await page.waitForTimeout(500)

  const vertices = () => page.evaluate(() => window.__HANDS__.vertices())
  const release = () => page.evaluate((a) => window.__HANDS__.drive(null, a), ASPECT)

  /** How big the sheet is right now, along each axis, in local units. */
  const extent = () =>
    page.evaluate(() => {
      const v = window.__HANDS__.vertices()
      const lo = [Infinity, Infinity, Infinity]
      const hi = [-Infinity, -Infinity, -Infinity]
      for (let i = 0; i < v.length; i += 3) {
        for (let axis = 0; axis < 3; axis++) {
          lo[axis] = Math.min(lo[axis], v[i + axis])
          hi[axis] = Math.max(hi[axis], v[i + axis])
        }
      }
      return { x: hi[0] - lo[0], y: hi[1] - lo[1], z: hi[2] - lo[2] }
    })

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
   * This replaces `waitForTimeout(n)` immediately followed by a measurement.
   * Those numbers were wall-clock stand-ins for "the sim has caught up", and
   * they were tuned by watching one machine: the sheet needs a number of
   * FRAMES to rebuild at a new size or to fall off its pins, and how long
   * those take is the renderer's business. A CI runner got 160 ms of a slower
   * clock, measured a sheet that had not moved yet, and reported three
   * unrelated gestures as broken while the gesture layer was reading them
   * perfectly — the resize even computed its 1.64x correctly.
   *
   * It does NOT weaken anything. The deadline is a ceiling, not a pass: a
   * thing that never happens still fails, and the last reading is returned
   * either way so the check prints the number it actually saw.
   */
  const until = async (read, done, ms = CATCH_UP_MS) => {
    const deadline = Date.now() + ms
    let value = await read()
    while (!done(value) && Date.now() < deadline) {
      await page.waitForTimeout(100)
      value = await read()
    }
    return value
  }

  /** Sweep FROM → TO holding one pose, returning how far the sheet moved. */
  const sweep = async (pose) => {
    const before = await vertices()
    for (let step = 0; step <= STEPS; step++) {
      const t = step / STEPS
      await page.evaluate(
        ([x, y, p, a]) => window.__HANDS__.drive([window.__hand__(x, y, p)], a),
        [FROM.x + (TO.x - FROM.x) * t, FROM.y + (TO.y - FROM.y) * t, pose, ASPECT],
      )
      await page.waitForTimeout(24)
    }
    const after = await vertices()
    // Let go and let it settle again, so the next pass starts from rest.
    await release()
    await page.waitForTimeout(1200)
    return moved(before, after)
  }

  const untouched = await sweep(POSES.palm)
  const dragged = await sweep(POSES.pinch)

  // ── Flick. A snap of the fingers throws a watercolour at the sheet. ───────
  // Driven on an injected clock rather than on wall time: a flick is DEFINED
  // by how fast it is, and a page.evaluate round trip is however long the
  // machine feels like taking.
  //
  // ABOVE the sheet, not across it, and that is the gesture rather than a
  // convenience: the same snap with the paper in your hand throws the PAPER.
  // A brush is flicked at the page from beside it.
  const flicked = await page.evaluate(
    ([poses, a]) => {
      const before = window.__HANDS__.drive(null, a, null, 0).washes
      for (let i = 0; i <= 4; i++) {
        window.__HANDS__.drive([window.__hand__(0.65 - i * 0.04, 0.17, poses.pinch)], a, null, i * 20)
      }
      const after = window.__HANDS__.drive([window.__hand__(0.45, 0.17, poses.palm)], a, null, 100)
      window.__HANDS__.drive(null, a)
      return { before, after: after.washes }
    },
    [POSES, ASPECT],
  )

  // And the same motion made slowly, which must NOT paint: a drag and a flick
  // are the same pinch opening, and speed is the whole of the difference.
  const dawdled = await page.evaluate(
    ([poses, a]) => {
      const before = window.__HANDS__.drive(null, a, null, 1000).washes
      for (let i = 0; i <= 4; i++) {
        window.__HANDS__.drive([window.__hand__(0.65 - i * 0.04, 0.17, poses.pinch)], a, null, 1000 + i * 400)
      }
      const after = window.__HANDS__.drive([window.__hand__(0.45, 0.17, poses.palm)], a, null, 3000)
      window.__HANDS__.drive(null, a)
      return { before, after: after.washes }
    },
    [POSES, ASPECT],
  )

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

  /** Hold a pose at one spot for a few frames. */
  const hold = async (pose, at = { x: 0.5, y: 0.5 }, frames = 6, roll = 0) => {
    let result
    for (let i = 0; i < frames; i++) {
      result = await page.evaluate(
        ([p, x, y, r, a]) => window.__HANDS__.drive([window.__hand__(x, y, p, 'Right', r)], a),
        [pose, at.x, at.y, roll, ASPECT],
      )
      await page.waitForTimeout(30)
    }
    return result
  }

  /** Trace a pose from one camera position to another. */
  const trace = async (pose, from, to, steps = 20) => {
    let result
    for (let step = 0; step <= steps; step++) {
      const t = step / steps
      result = await page.evaluate(
        ([p, x, y, a]) => window.__HANDS__.drive([window.__hand__(x, y, p)], a),
        [pose, from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t, ASPECT],
      )
      await page.waitForTimeout(24)
    }
    return result
  }

  // ── Score. Draw a line with a fingertip, then stop pointing to commit. ────
  // Aimed by scanning, and scanned AGAIN between the two. A crease deforms
  // the sheet now that a simulation can host a shape — it used to be shading
  // only — so the first score moves the target for the second, and a fixed
  // pair of coordinates hit the paper once and the air after that.
  const beforeScore = (await release()).creases
  const scoreAt = ((await scanSurface()) ?? surface).mid
  await trace(
    POSES.point,
    { x: scoreAt.camX + 0.06, y: scoreAt.camY },
    { x: scoreAt.camX - 0.06, y: scoreAt.camY },
  )
  const scored = await hold(POSES.palm)
  await page.waitForTimeout(300)

  // A second score, to prove they accumulate rather than replace.
  const scoreAgainAt = ((await scanSurface()) ?? surface).mid
  await trace(
    POSES.point,
    { x: scoreAgainAt.camX, y: scoreAgainAt.camY + 0.06 },
    { x: scoreAgainAt.camX, y: scoreAgainAt.camY - 0.06 },
  )
  const scoredTwice = await hold(POSES.palm)
  await page.waitForTimeout(300)

  // ── The dial. An open palm, turned, changes what the paper is made of. ────
  const beforeDial = (await hold(POSES.palm, { x: 0.5, y: 0.5 }, 5)).stock
  // Raising the hand must change nothing: an open palm also means "put the
  // paper back", and a dial that reads an absolute angle would swap the stock
  // every time somebody came out of a crush.
  const raised = (await hold(POSES.palm, { x: 0.5, y: 0.5 }, 5, 0)).stock
  const turned = (await hold(POSES.palm, { x: 0.5, y: 0.5 }, 6, 40)).stock
  await release()

  // ── Rip. Two hands, pulling apart, along the perforation. ────────────────
  // Before the tear, deliberately: a rip barely moves the sheet — the holding
  // hand sits still at the centre and the pulling hand never drives the
  // pointer — where a tear drags it most of the way across the frame and
  // leaves it hanging somewhere the next scan has to go looking for it.
  // The gesture the second hand exists for: one hand holds the sheet, the
  // other takes the far side of a dotted line and pulls it away. The sim has
  // one grab, so only the first hand is holding anything — which is exactly
  // why this is reachable today and two-handed STRETCHING is not.
  const ripEdges = (await scanSurface()) ?? surface
  if (!ripEdges.right) throw new Error('the scan found no right edge to rip')
  const ripAt = { x: ripEdges.right.camX, y: ripEdges.right.camY }
  const away = ripAt.x > 0.5 ? 1 : -1
  const ripped = await (async () => {
    let result
    const steps = 22
    for (let step = 0; step <= steps; step++) {
      // Three frames on the spot first, so both pinches are past the reader's
      // debounce before either hand moves.
      const t = Math.max(0, (step - 3) / (steps - 3))
      result = await page.evaluate(
        ([x, y, p, a]) =>
          window.__HANDS__.drive(
            [window.__hand__(0.5, 0.5, p, 'Left'), window.__hand__(x, y, p, 'Right')],
            a,
          ),
        [ripAt.x + away * 0.34 * t, ripAt.y - 0.18 * t, POSES.pinch, ASPECT],
      )
      await page.waitForTimeout(24)
    }
    await release()
    await page.waitForTimeout(400)
    return result
  })()

  // ── Tear. Take hold of an edge and pull until it gives. ───────────────────
  // Scanned again: the scores and the rip happened in between, and a grab
  // aimed at where the edge USED to be lands in the middle of the sheet.
  const edges = (await scanSurface()) ?? ripEdges
  if (!edges.left) throw new Error('the scan found no left edge to tear')
  const tearAt = { x: edges.left.camX, y: edges.left.camY }
  const tornResult = await trace(POSES.pinch, tearAt, { x: tearAt.x - 0.42, y: tearAt.y - 0.3 }, 26)
  await hold(POSES.palm)
  await page.waitForTimeout(400)

  // ── Fold. Close your hand and the sheet folds along the line it was ──────
  //    scored on. Two creases were scored above, so this is what a fist does
  //    here — and it is only reachable because a simulation can host a shape:
  //    the fold runs over the drape rather than replacing it.
  const beforeFold = await vertices()
  // A light fist rather than a tight one: a sheet folded the whole 180° is
  // doubled flat against itself, and the point of the next check is to grab
  // it, not to find out where a closed sheet went.
  const folding = await hold(POSES.fistLight)
  await page.waitForTimeout(400)
  const folded = await vertices()
  const foldMoved = moved(beforeFold, folded)
  // Still cloth underneath, so still grabbable — the thing the mode swap used
  // to make impossible. Aimed by scanning for the sheet, because a fold moves
  // it and the middle of the frame is no longer the middle of the paper.
  const onFolded = await scanSurface()
  if (onFolded) {
    const at = { x: onFolded.mid.camX, y: onFolded.mid.camY }
    // Four frames on the spot before moving: the reader debounces a pinch,
    // and a hand that has already left the sheet by the time the pointer goes
    // down grabs nothing at all.
    await hold(POSES.pinch, at, 4)
    await trace(POSES.pinch, at, { x: at.x - 0.05, y: at.y - 0.05 }, 10)
  }
  await page.waitForTimeout(200)
  const draggedFolded = onFolded ? moved(folded, await vertices()) : 0
  const unfolded = await hold(POSES.palm)
  await page.waitForTimeout(400)

  // ── Crush. With nothing scored, a fist crumples instead. ─────────────────
  await page.evaluate(() => document.querySelector('.hud .ghost')?.click())
  await page.waitForTimeout(200)
  await settle()
  const lightFist = await hold(POSES.fistLight)
  await page.waitForTimeout(300)
  const lightShape = await vertices()
  const tightFist = await hold(POSES.fistTight)
  await page.waitForTimeout(300)
  const tightShape = await vertices()
  const squeeze = moved(lightShape, tightShape)
  const backToCloth = await hold(POSES.palm)

  // ── Blow. A puckered mouth drives `cloth.wind`, live and in place. ───────
  // The one parameter here that is CONTINUOUS: the sim reads it every frame
  // and wakes on a change, so the sheet lifts without a rebuild. Which is
  // also what makes it testable — the page is started with the wind at zero,
  // so a sheet that moves is a sheet that was blown at.
  await release()
  await settle()
  const stillShape = await vertices()
  const rested = (await release()).wind
  const gale = await page.evaluate((a) => {
    let last
    for (let i = 0; i < 80; i++) last = window.__HANDS__.drive(null, a, { pucker: 1 })
    return last.wind
  }, ASPECT)
  await page.waitForTimeout(900)
  const blownShape = await vertices()
  const blown = moved(stillShape, blownShape)
  const calmed = await page.evaluate((a) => {
    let last
    for (let i = 0; i < 80; i++) last = window.__HANDS__.drive(null, a, null)
    return last.wind
  }, ASPECT)

  // ── Resize, in cloth. Two open hands, and the drape survives it. ─────────
  // `sheet.width/height` are a GEOMETRY dependency: changing them builds a
  // new mesh and a new sim, and a new sim used to start flat — so a hanging
  // sheet snapped rigid the moment it was resized. `ClothSim.adopt` carries
  // the particles over now, and this is the check that says so from outside
  // the library. It has to be measured against a sheet that is ACTUALLY
  // draped, and a pinned sheet in still air is perfectly planar — so the
  // wind goes up first and stays up.
  const blowHard = () =>
    page.evaluate((a) => {
      for (let i = 0; i < 80; i++) window.__HANDS__.drive(null, a, { pucker: 1 })
    }, ASPECT)

  /** Hold two open palms `gap` apart in camera units, for `frames` frames. */
  const spread = (gap, frames, blowing) =>
    page.evaluate(
      ([g, n, p, a, b]) => {
        let last
        for (let i = 0; i < n; i++) {
          last = window.__HANDS__.drive(
            [
              window.__hand__(0.5 - g / 2, 0.5, p.palm, 'Left'),
              window.__hand__(0.5 + g / 2, 0.5, p.palm, 'Right'),
            ],
            a,
            b ? { pucker: 1 } : null,
          )
        }
        return { scale: last.scale, squeeze: last.squeeze, hands: last.hands }
      },
      [gap, frames, POSES, ASPECT, blowing],
    )

  const stopBlowing = () =>
    page.evaluate((a) => {
      for (let i = 0; i < 80; i++) window.__HANDS__.drive(null, a, null)
    }, ASPECT)

  await blowHard()
  await page.waitForTimeout(1300)
  // And then the wind OFF, with the sheet still swinging. This is what makes
  // the check binary rather than a judgement about magnitudes: with nothing
  // pushing on it, a sheet that snapped flat has no way back to a drape, so
  // the failing reading is zero rather than a smaller number that has to be
  // argued about. (It was argued about. The wind rebuilt the depth in 160 ms
  // and the check passed with the carry-over deleted.)
  await stopBlowing()
  const draped = await extent()
  // Five frames to get both palms past the reader's debounce and anchor the
  // span, then three at the new width — one rebuild, not twelve.
  await spread(0.3, 5, false)
  const grown = await spread(0.6, 3, false)
  const resized = await until(extent, (e) => e.x > draped.x * 1.4)
  await release()

  // ── Resize, as a shape. The case that was always free. ───────────────────
  // A deformer is a pure function of its options, so a rebuild is invisible:
  // the crush redraws at the new size with nothing lost. Also the check that
  // two open palms are a RESIZE rather than the single open palm that means
  // "put the paper back" — otherwise this could not happen at all.
  await hold(POSES.fistTight)
  await page.waitForTimeout(300)
  const crushedBig = await extent()
  await spread(0.6, 5, false)
  const shrunk = await spread(0.3, 3, false)
  const crushedSmall = await until(extent, (e) => e.x < crushedBig.x * 0.75)
  await release()

  // ── Peel. A pinch that lands on a CORNER curls it instead of dragging it. ─
  // The same pose as a grab, aimed somewhere particular. Which is the whole
  // answer to a vocabulary that ran out of hand shapes: paper is indexed by
  // where you take hold of it.
  await page.evaluate(() => document.querySelector('.hud .ghost')?.click())
  await page.waitForTimeout(200)
  const corners = await scanSurface()
  const cornerAt = corners?.corner ? { x: corners.corner.camX, y: corners.corner.camY } : null
  let peeling = null
  let peelMoved = 0
  if (cornerAt) {
    const flat = await vertices()
    await hold(POSES.pinch, cornerAt, 5)
    // Lift it away from the sheet. The pointer must stay UP throughout — a
    // peeling hand is not a grabbing hand, or the two fight over one corner.
    peeling = await trace(POSES.pinch, cornerAt, { x: cornerAt.x + 0.16, y: cornerAt.y - 0.16 }, 14)
    await page.waitForTimeout(300)
    peelMoved = moved(flat, await vertices())
    await hold(POSES.palm)
    await page.waitForTimeout(300)
  }

  // ── Throw. The same snap of the fingers, with the paper in your hand. ─────
  // Last, because it takes the sheet off the wall and leaves it there.
  await page.evaluate(() => document.querySelector('.hud .ghost')?.click())
  await page.waitForTimeout(200)
  await settle()
  const hanging = await vertices()
  const thrown = await page.evaluate(
    ([poses, a]) => {
      const at = (t, x, y, pose) => window.__HANDS__.drive([window.__hand__(x, y, pose)], a, null, t)
      // Take hold in the middle and hold on for a while — a throw does not
      // read the duration, only the speed at the moment of release.
      // Clear the tracker before taking over the clock: its samples are from
      // wall time and would all be in the future.
      window.__HANDS__.drive(null, a)
      const held = []
      for (let i = 0; i < 8; i++) held.push(at(i * 100, 0.5, 0.5, poses.pinch).holding)
      // Then whip it away and let go.
      for (let i = 0; i <= 4; i++) at(800 + i * 20, 0.5 - i * 0.04, 0.5 - i * 0.02, poses.pinch)
      const last = at(900, 0.3, 0.4, poses.palm)
      window.__HANDS__.drive(null, a)
      return { thrown: last.thrown, held }
    },
    [POSES, ASPECT],
  )
  const flew = await until(
    async () => moved(hanging, await vertices()),
    (distance) => distance > 0.3,
  )

  // Sanity: the scripted hand really is on the two sides of the threshold,
  // and the gesture layer names each pose the way the unit tests say it does.
  const named = await page.evaluate(
    ([poses, a]) => {
      // The reader debounces, so a pose has to be held to take effect.
      const read = (pose, frames = 5) => {
        let last
        for (let i = 0; i < frames; i++) {
          last = window.__HANDS__.drive([window.__hand__(0.5, 0.5, pose)], a)
        }
        window.__HANDS__.drive(null, a)
        return { name: last.frame.name, aperture: last.frame.aperture, curl: last.frame.curl }
      }
      // Two hands, and which one the page decides is holding the paper.
      const two = () => {
        let last
        for (let i = 0; i < 5; i++) {
          last = window.__HANDS__.drive(
            [
              window.__hand__(0.35, 0.5, poses.pinch, 'Left'),
              window.__hand__(0.65, 0.5, poses.point, 'Right'),
            ],
            a,
          )
        }
        window.__HANDS__.drive(null, a)
        return { hands: last.hands, roles: last.roles, acting: last.frame.name }
      }
      return {
        pinch: read(poses.pinch),
        palm: read(poses.palm),
        fist: read(poses.fistTight),
        point: read(poses.point),
        two: two(),
      }
    },
    [POSES, ASPECT],
  )

  const capture = problems.filter((p) => /PointerCapture|NotFoundError/i.test(p))

  console.log('')
  console.log('  hands — scripted gestures against the paper')
  console.log(`  ${'─'.repeat(58)}`)
  console.log(
    `  camera and models      ${cameraLive ? 'loaded' : `FAILED — ${cameraError}`}${blowReady ? ' · face model too' : ''}`,
  )
  console.log(`  pinch pose reads       ${named.pinch.name}  (aperture ${named.pinch.aperture.toFixed(2)})`)
  console.log(`  open pose reads        ${named.palm.name}  (aperture ${named.palm.aperture.toFixed(2)})`)
  console.log(
    `  fist pose reads        ${named.fist.name}  (aperture ${named.fist.aperture.toFixed(2)}, curl ${named.fist.curl.toFixed(2)})`,
  )
  console.log(`  point pose reads       ${named.point.name}`)
  console.log(
    `  two hands              ${named.two.hands} up · holding ${named.two.roles.hold} · acting ${named.two.roles.act} (${named.two.acting})`,
  )
  console.log(`  sheet moved, open hand ${untouched.toFixed(4)}`)
  console.log(`  sheet moved, pinching  ${dragged.toFixed(4)}`)
  console.log(`  creases after scoring  ${beforeScore} → ${scored.creases} → ${scoredTwice.creases}`)
  console.log(
    `  washes, flick vs drag  flick ${flicked.before} → ${flicked.after} · drag ${dawdled.before} → ${dawdled.after}`,
  )
  console.log(`  stock, raised → turned ${beforeDial} → ${raised} → ${turned}`)
  console.log(`  torn edges             ${tornResult.torn.join(', ') || 'none'}`)
  console.log(
    `  ripped edges           ${ripped.ripped.join(', ') || 'none'}  (act hand at u=${ripEdges.right.u.toFixed(3)})`,
  )
  console.log(
    `  fold along the score   ${folding.squeeze} to ${folding.fold}° · moved ${foldMoved.toFixed(4)} · dragged while folded ${draggedFolded.toFixed(4)}`,
  )
  console.log(`  crush, light vs tight  ${squeeze.toFixed(4)} (${tightFist.squeeze})`)
  console.log(`  wind, rest → blow → off  ${rested.toFixed(2)} → ${gale.toFixed(2)} → ${calmed.toFixed(2)}`)
  console.log(`  sheet moved, blown at  ${blown.toFixed(4)}`)
  console.log(
    `  resized in cloth       ${draped.x.toFixed(2)} → ${resized.x.toFixed(2)} wide at ${grown.scale}× · drape ${draped.z.toFixed(3)} → ${resized.z.toFixed(3)}`,
  )
  console.log(
    `  resized as a shape     ${crushedBig.x.toFixed(2)} → ${crushedSmall.x.toFixed(2)} wide at ${shrunk.scale}× · ${shrunk.squeeze}`,
  )
  console.log(
    `  peel a corner          ${peeling ? `${peeling.peel} · moved ${peelMoved.toFixed(4)} · pointer ${peeling.pointer?.down ? 'down' : 'up'}` : 'no corner found'}`,
  )
  console.log(`  thrown off its pins    ${thrown.thrown} · sheet moved ${flew.toFixed(4)}`)
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
  check(untouched < 0.02, 'an open hand sweeps over the paper without moving it', `moved ${untouched}`)
  check(dragged > 0.2, 'a pinch takes hold and drags the paper with it', `moved only ${dragged}`)
  check(
    dragged > untouched * 10,
    'the pinch is what moved it, not the sim',
    `pinch ${dragged} vs open ${untouched}`,
  )
  check(named.point.name === 'point', 'a pointing finger is named a point', named.point.name)
  check(
    named.two.hands === 2 && named.two.roles.hold === 'Left' && named.two.roles.act === 'Right',
    'one hand holds the paper while the other one acts',
    JSON.stringify(named.two),
  )
  check(scored.creases === beforeScore + 1, 'scoring a line leaves one crease', `got ${scored.creases}`)
  check(
    scoredTwice.creases === beforeScore + 2,
    'a second score adds to the first rather than replacing it',
    `got ${scoredTwice.creases}`,
  )
  check(
    flicked.after === flicked.before + 1,
    'a flick throws one wash onto the sheet',
    `got ${flicked.after}`,
  )
  check(
    dawdled.after === dawdled.before,
    'the same travel made slowly is a drag, and paints nothing',
    `got ${dawdled.after}`,
  )
  check(raised === beforeDial, 'raising an open palm does not change the stock', `${beforeDial} → ${raised}`)
  check(turned !== raised, 'turning it does', `still ${turned}`)
  check(
    tornResult.torn.length > 0,
    'pulling hard on an edge tears it',
    `nothing torn (grabbed at u=${edges.left.u.toFixed(3)})`,
  )
  check(
    ripped.ripped.length > 0,
    'two hands pulling apart rip along the perforation',
    `nothing ripped (act hand at u=${ripEdges.right.u.toFixed(3)})`,
  )
  check(
    ripped.ripped.every((edge) => !tornResult.torn.includes(edge)),
    'an edge is torn one way or the other, never both',
    `${ripped.ripped.join(', ')} vs ${tornResult.torn.join(', ')}`,
  )
  check(
    folding.squeeze === 'fold' && folding.fold >= 90,
    'a fist on a scored sheet folds it along the line',
    `${folding.squeeze} at ${folding.fold}°`,
  )
  check(foldMoved > 0.05, 'and the fold actually moves the paper', `moved ${foldMoved}`)
  check(
    draggedFolded > 0.05,
    'a folded sheet is still cloth, and still grabbable',
    onFolded ? `a pinch moved it ${draggedFolded}` : 'the scan lost the sheet after folding it',
  )
  check(unfolded.squeeze === 'none', 'an open palm lets go of the fold', unfolded.squeeze)
  check(lightFist.squeeze === 'crush', 'a fist on an unmarked sheet crushes it instead', lightFist.squeeze)
  check(tightFist.squeeze === 'crush', 'and holds it there while the fist holds', tightFist.squeeze)
  check(squeeze > 0.01, 'squeezing harder crushes it further', `light and tight differ by ${squeeze}`)
  check(backToCloth.squeeze === 'none', 'an open palm puts the paper back', backToCloth.squeeze)
  check(gale > 0.5, 'blowing at the paper raises the wind', `wind only reached ${gale}`)
  check(blown > 0.02, 'and the sheet moves because of it', `moved ${blown}`)
  check(calmed <= rested + 1e-9, 'the wind drops again when the blowing stops', `left at ${calmed}`)
  check(
    grown.scale > 1.4 && resized.x > draped.x * 1.4,
    'two open hands, spread, make the sheet bigger',
    `${grown.scale}× took ${draped.x} to ${resized.x}`,
  )
  // The whole of B2, from outside the library: a rebuild that starts flat
  // reads zero here, and a sheet that keeps its drape reads about the old
  // depth times the scale.
  check(
    resized.z > draped.z * grown.scale * 0.5,
    'and the drape survives the rebuild instead of snapping flat',
    `depth ${draped.z} → ${resized.z} at ${grown.scale}×`,
  )
  check(
    shrunk.squeeze === 'crush',
    'two open palms resize the sheet rather than putting it back',
    `the squeeze went to ${shrunk.squeeze}`,
  )
  check(
    crushedSmall.x < crushedBig.x * 0.75,
    'a crushed sheet resizes too, because a deformer is a pure function',
    `${crushedBig.x} → ${crushedSmall.x}`,
  )
  check(
    Boolean(peeling?.peel),
    'a pinch on a corner peels it rather than dragging it',
    peeling ? `peel was ${peeling.peel}` : 'the scan found no corner to aim at',
  )
  check(peelMoved > 0.02, 'and lifting the hand curls the corner back', `moved ${peelMoved}`)
  check(
    Boolean(peeling) && !peeling?.pointer?.down,
    'a peeling hand never takes hold, so the two do not fight',
    'the pointer went down on a corner',
  )
  check(thrown.thrown === true, 'a flick with the sheet in hand throws it off its pins', 'still pinned')
  check(flew > 0.3, 'and the sheet actually leaves', `it moved ${flew}`)
  check(capture.length === 0, 'pointer capture survives a synthetic pointer', capture[0] ?? '')
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
    console.log('  Gestures reach the paper: hold it, score it, paint it, tear it, crush it, blow it.')
  }
} finally {
  await browser.close()
  stop()
}
