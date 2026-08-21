import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  // The reference ships under /docs on the public site; '/' for local dev.
  base: process.env.PAPERLAB_BASE ?? '/',
  plugins: [react()],
  resolve: {
    alias: {
      // Consume the library's source directly (through its public API) so
      // docs dev needs no library build step — and so the catalogue is
      // reading the registries this repo actually has.
      // `paperlab/stage` MUST come first: these keys are prefix-matched in
      // order, so a bare `paperlab` rule would rewrite the subpath into
      // `.../src/index.ts/stage` and fail to resolve.
      'paperlab/stage': fileURLToPath(new URL('../../packages/paperlab/src/stage.ts', import.meta.url)),
      paperlab: fileURLToPath(new URL('../../packages/paperlab/src/index.ts', import.meta.url)),
    },
    dedupe: ['react', 'react-dom', 'three', '@react-three/fiber', '@react-three/drei'],
  },
})
