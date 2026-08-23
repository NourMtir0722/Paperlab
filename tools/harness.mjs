/**
 * What every harness in this folder was copying.
 *
 * There are ten scripts here and each one begins the same way: spawn a Vite
 * dev server for one of the apps, poll it until it answers, launch Chromium,
 * and remember to kill the server on the way out. That block was pasted ten
 * times, which is how it came to have a bug in ten places — the poll loop
 * fell through silently after thirty seconds, so a dev server that never
 * started produced a Playwright navigation error against a dead port instead
 * of the one sentence that would have explained it.
 *
 * Nothing here is clever. It is the boilerplate, written once, with the
 * failure modes handled where they can be handled once too.
 */
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The repo root, from anywhere in `tools/`. */
export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Where every harness writes its images. Gitignored, and the same place for
 * all of them so a run's output is somewhere you can find it.
 */
export function shotsDir() {
  const dir = resolve(root, '.shots')
  mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Boot one of the apps and wait until it actually answers.
 *
 * `app` is the workspace name without the scope — 'editor', 'playground',
 * 'docs'. Returns the base URL and a `stop()`, and registers `stop` on
 * process exit so an aborted run does not leave a server holding the port.
 *
 * Throws with the port in the message if the server never comes up, which is
 * the whole reason this is a function: the loop it replaces gave up quietly
 * and let the caller fail later, somewhere less informative.
 */
export async function startApp(app, port, { timeoutMs = 30_000 } = {}) {
  const server = spawn('pnpm', ['--filter', `@paperlab/${app}`, 'exec', 'vite', '--port', String(port)], {
    stdio: 'pipe',
    cwd: root,
  })

  // Vite's own output is the only diagnostic when the server refuses to
  // start — a port already held, a config that does not parse — so keep it
  // and print it if the wait times out.
  let log = ''
  server.stdout?.on('data', (chunk) => {
    log += chunk
  })
  server.stderr?.on('data', (chunk) => {
    log += chunk
  })

  let stopped = false
  const stop = () => {
    if (stopped) return
    stopped = true
    server.kill('SIGTERM')
  }
  process.on('exit', stop)

  const base = `http://localhost:${port}`
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      await fetch(base)
      return { base, stop, server }
    } catch {
      await new Promise((r) => setTimeout(r, 250))
    }
  }
  stop()
  throw new Error(
    `the ${app} dev server never answered on ${base} within ${timeoutMs / 1000}s.\n` +
      `vite said:\n${log || '  (nothing)'}`,
  )
}

/**
 * Which renderer to ask Chromium for.
 *
 * The default was never a choice anyone made: bare headless Chromium hands
 * out **SwiftShader**, its CPU rasterizer, and these harnesses used to label
 * that "native GPU" because they reported the flag they had been given rather
 * than the driver that answered.
 *
 * `--gpu` asks ANGLE for the platform backend and actually gets it, headless
 * — Metal on macOS, and the equivalent elsewhere. Both are worth having:
 * `--soft` is the weak-machine floor to design against, `--gpu` is what a
 * visitor with a laptop will see. Every perf run prints which one answered,
 * measured off `WEBGL_debug_renderer_info` rather than off these flags, so a
 * number can never be read as the other again.
 */
export function rendererArgs(argv = process.argv) {
  if (argv.includes('--gpu')) {
    return [
      '--use-angle=metal',
      '--enable-gpu',
      '--ignore-gpu-blocklist',
      // Without these the frame time IS the refresh interval and every case
      // reads 8.3 ms on a 120 Hz panel, which measures the display rather
      // than the scene. Uncapped, the number is what the frame actually
      // costs — which is the only form of it worth comparing anything to.
      '--disable-gpu-vsync',
      '--disable-frame-rate-limit',
    ]
  }
  if (argv.includes('--soft')) {
    return ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  }
  return []
}

/** What was asked for, in words, for the line above a table of numbers. */
export function rendererRequested(argv = process.argv) {
  if (argv.includes('--gpu')) return 'the platform GPU'
  if (argv.includes('--soft')) return 'swiftshader (CPU — weak-machine floor)'
  return 'default (whatever Chromium picks — usually SwiftShader)'
}

/**
 * Median and p95 of a frame-time sample, in ms.
 *
 * p95 rather than max: one hitch is a garbage collection, and a harness that
 * reports it as the number makes every run incomparable to the last.
 */
export function frameStats(frames) {
  const sorted = frames.slice().sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]
  return { median, p95: sorted[Math.floor(sorted.length * 0.95)], fps: 1000 / median }
}
