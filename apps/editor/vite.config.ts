import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Consume the library's source directly (still through its public API)
      // so editor dev needs no library build step.
      paperlab: fileURLToPath(new URL('../../packages/paperlab/src/index.ts', import.meta.url)),
    },
    // zustand deliberately not deduped: leva pins zustand v4 (default-export
    // `shallow`), the app uses v5 — each keeps its own copy.
    dedupe: ['react', 'react-dom', 'three', '@react-three/fiber', '@react-three/drei'],
  },
})
