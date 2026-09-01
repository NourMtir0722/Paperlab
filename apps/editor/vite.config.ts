import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { createReadStream, cpSync, existsSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Where `pnpm hands:setup` puts the tracker's wasm and models. */
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
 * So: a middleware in dev, and a copy at build time only if `hands.html` is
 * genuinely being built. If that page ever ships, this is already correct.
 */
function handsAssets(): Plugin {
  let willBuildHands = false
  return {
    name: 'paperlab-hands-assets',
    configResolved(config) {
      const input = config.build.rollupOptions.input
      const entries =
        typeof input === 'string' ? [input] : Array.isArray(input) ? input : Object.values(input ?? {})
      willBuildHands = entries.some((entry) => String(entry).includes('hands.html'))
    },
    configureServer(server) {
      server.middlewares.use('/hands', (req, res, next) => {
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
      if (!willBuildHands || !existsSync(HANDS_ASSETS)) return
      cpSync(HANDS_ASSETS, join(fileURLToPath(new URL('./dist', import.meta.url)), 'hands'), {
        recursive: true,
      })
    },
  }
}

export default defineConfig({
  // The editor ships under /editor on the public site; '/' for local dev.
  base: process.env.PAPERLAB_BASE ?? '/',
  plugins: [react(), handsAssets()],
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
