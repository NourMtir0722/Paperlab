import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  // Served from the site root by default; the Pages deploy sets this to the
  // repo subpath (or leaves it '/' behind a custom domain).
  base: process.env.PAPERLAB_BASE ?? '/',
  plugins: [react()],
  resolve: {
    alias: {
      // Consume the library's source directly (through its public API) so
      // playground dev needs no library build step.
      // `paperlab/stage` MUST come first: these keys are prefix-matched in
      // order, so a bare `paperlab` rule would rewrite the subpath into
      // `.../src/index.ts/stage` and fail to resolve.
      'paperlab/stage': fileURLToPath(new URL('../../packages/paperlab/src/stage.ts', import.meta.url)),
      paperlab: fileURLToPath(new URL('../../packages/paperlab/src/index.ts', import.meta.url)),
    },
    dedupe: ['react', 'react-dom', 'three', '@react-three/fiber', '@react-three/drei'],
  },
})
