import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Every app paints something before its bundle arrives.
 *
 * All three are a single React bundle over a megabyte of three.js, and until
 * it parses there is nothing in `#root`. Measured on a cold cache over
 * throttled 4G, each one showed a **completely blank page for the best part
 * of two seconds** — and blank is worse than slow, because a visitor cannot
 * tell a heavy scene from a broken link.
 *
 * The fix is markup and inline CSS inside `#root`, so it is on screen with
 * the first byte and `createRoot().render()` replaces it on mount. It costs
 * no request and no JavaScript, which is exactly why it is easy to delete by
 * accident while tidying an `index.html` — nothing in the build, the types or
 * the unit suite would notice, and the failure only shows up on a cold cache
 * on a slow connection, which is not how anyone develops.
 *
 * So this checks the shape rather than the words: the shell is present, it is
 * INSIDE `#root` (outside it, React never clears it and it covers the app
 * forever), and its styles are inline rather than in a stylesheet the browser
 * has to go and fetch first.
 *
 * It lives in this app for the same reason `docsDrift` does: it reads files
 * off disk, and a browser library has no business gaining `@types/node` for a
 * test.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const APPS = ['playground', 'editor', 'docs']

describe('the first paint is in the document', () => {
  for (const app of APPS) {
    const file = `apps/${app}/index.html`
    const html = readFileSync(resolve(root, file), 'utf8')

    it(`${app} ships a boot shell`, () => {
      expect(html, `${file} has no .boot shell — a cold load is a blank page`).toContain('class="boot"')
    })

    it(`${app} puts it inside #root, so React replaces it`, () => {
      const open = html.indexOf('<div id="root"')
      const close = html.indexOf('</div>', html.indexOf('class="boot"'))
      expect(open, file).toBeGreaterThan(-1)
      expect(html.indexOf('class="boot"'), file).toBeGreaterThan(open)
      // And `#root` is not self-closed around it.
      expect(html.slice(open, close), file).not.toContain('<div id="root"></div>')
    })

    it(`${app} styles it inline, not from a stylesheet it has to fetch`, () => {
      const style = html.slice(0, html.indexOf('</head>'))
      expect(style, `${file}: .boot styles are not in the document head`).toContain('.boot')
    })

    it(`${app} says something, rather than spinning at the visitor`, () => {
      // A bare spinner is a blank page with a decoration on it. The line has
      // to explain why the wait exists.
      const line = /<p class="boot-line">([^<]+)<\/p>/.exec(html)?.[1] ?? ''
      expect(line.trim().length, `${file} has no boot line`).toBeGreaterThan(30)
    })

    it(`${app} holds the shell back so a warm cache never flashes it`, () => {
      // A load that mounts in 150ms should show nothing at all.
      const delay = /animation:\s*boot-in[^;]*?(\d+)ms\s+forwards/.exec(html)
      expect(delay, `${file}: boot-in has no delay`).not.toBeNull()
      expect(Number(delay![1]), file).toBeGreaterThanOrEqual(150)
    })
  }
})
