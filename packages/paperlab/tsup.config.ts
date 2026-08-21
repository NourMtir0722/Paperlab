import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/stage.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  external: [
    'react',
    'react-dom',
    'three',
    '@react-three/fiber',
    '@react-three/drei',
    'gsap',
    // Only `paperlab/stage` names these, and only it may.
    '@react-three/postprocessing',
    'postprocessing',
  ],
})
