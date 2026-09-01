import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { createReadStream, cpSync, existsSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Whether this is the /hands pass.
 *
 * The page is built SEPARATELY from the editor, with its own base, so the
 * route is self-contained: `/hands` should not be quietly reading its
 * JavaScript out of `/editor/assets`, and the ordinary `pnpm build` should not
 * carry 12 MB of wasm for a page it is not emitting. Two passes over the same
 * app, which is cheaper than a fourth workspace package that would duplicate
 * this config to change one line of it.
 */
const HANDS_BUILD = process.env.PAPERLAB_HANDS === '1'

/** Where `pnpm hands:setup` puts the tracker's wasm. */
const HANDS_ASSETS = fileURLToPath(new URL('./.hands', import.meta.url))

const TYPES: Record<string, string> = {
  '.js': 'text/javascript',
  '.wasm': 'application/wasm',
  '.task': 'application/octet-stream',
}

/**
 * Serve the hand tracker's wasm and models at `/hands/*`.
 *
 * They are 35 MB and they are not in git, so they are not in `public/` either:
 * Vite copies that directory into `dist` for EVERY build, whether or not the
 * page using it was one of the entry points, and `hands.html` is dev-only.
 * That put 36 MB of models into a 4 MB deploy for a page nobody could reach.
 *
 * So: a middleware in dev, and a copy at build time, both at `<page>/tracker`
 * so the page can resolve them against its own URL and work at either.
 */
function handsAssets(): Plugin {
  return {
    name: 'paperlab-hands-assets',
    configureServer(server) {
      server.middlewares.use('/hands/tracker', (req, res, next) => {
        // `normalize` then a prefix check: the path comes off a URL and this
        // is a file server, so `..` is the whole attack surface.
        const file = resolve(HANDS_ASSETS, `.${normalize(req.url ?? '/')}`)
        if (!file.startsWith(HANDS_ASSETS) || !existsSync(file) || !statSync(file).isFile()) {
          return next()
        }
        res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream')
        res.setHeader('Content-Length', String(statSync(file).size))
        createReadStream(file).pipe(res)
      })
    },
    closeBundle() {
      if (!HANDS_BUILD || !existsSync(HANDS_ASSETS)) return
      cpSync(HANDS_ASSETS, join(fileURLToPath(new URL('./dist-hands', import.meta.url)), 'hands/tracker'), {
        recursive: true,
      })
    },
  }
}

export default defineConfig({
  // The editor ships under /editor on the public site; '/' for local dev.
  base: process.env.PAPERLAB_BASE ?? '/',
  plugins: [react(), handsAssets()],
  build: {
    outDir: HANDS_BUILD ? 'dist-hands' : 'dist',
    rollupOptions: {
      // A DIRECTORY with an index, not `hands.html`: `/hands` is a route and
      // `/hands.html` is a file someone left lying around. It also makes the
      // dev URL and the deployed one the same, which is what lets the page
      // resolve its wasm against `document.baseURI` and be right both times.
      // Every other harness stays dev-only and is listed in neither.
      input: HANDS_BUILD
        ? { hands: fileURLToPath(new URL('./hands/index.html', import.meta.url)) }
        : { index: fileURLToPath(new URL('./index.html', import.meta.url)) },
    },
  },
  resolve: {
    alias: {
      // Consume the library's source directly (still through its public API)
      // so editor dev needs no library build step.
      // `paperlab/stage` MUST come first: these keys are prefix-matched in
      // order, so a bare `paperlab` rule would rewrite the subpath into
      // `.../src/index.ts/stage` and fail to resolve.
      'paperlab/stage': fileURLToPath(new URL('../../packages/paperlab/src/stage.ts', import.meta.url)),
      paperlab: fileURLToPath(new URL('../../packages/paperlab/src/index.ts', import.meta.url)),
    },
    dedupe: ['react', 'react-dom', 'three', '@react-three/fiber', '@react-three/drei', 'zustand'],
  },
})
