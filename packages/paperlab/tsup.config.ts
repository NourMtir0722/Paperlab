import { defineConfig } from 'tsup'

/**
 * The peers and the one dependency every build leaves alone.
 *
 * `three-custom-shader-material` is the exception, and only for CJS — see the
 * second config.
 */
const external = [
  'react',
  'react-dom',
  'three',
  '@react-three/fiber',
  '@react-three/drei',
  'gsap',
  // Only `paperlab/stage` names these, and only it may — and it reaches them
  // through a dynamic import, so that `optional` in `peerDependenciesMeta` is
  // true rather than aspirational. See `src/stage/GradeLazy.tsx`.
  '@react-three/postprocessing',
  'postprocessing',
]

const entry = ['src/index.ts', 'src/stage.ts']

/**
 * Two configs rather than one `format: ['esm', 'cjs']`, for exactly one
 * reason, and it is not a preference.
 *
 * `three-custom-shader-material@6.4.0` — the current and latest release —
 * declares `"type": "module"` and points its `require` condition at
 * `three-custom-shader-material.cjs.js`: a CommonJS file with a `.js`
 * extension, inside a package that has just told Node every `.js` file is
 * ESM. Node believes the package. So `require('three-custom-shader-material')`
 * throws `ReferenceError: require is not defined in ES module scope`, and
 * because the library names that specifier from its own CJS build, so does
 * `require('paperlab')` and `require('paperlab/stage')`. Both published CJS
 * entry points have been unloadable for as long as that dependency has been
 * on this version.
 *
 * Nothing in the workspace could see it: the repo is ESM throughout, and
 * `publint` and `arethetypeswrong` read manifests rather than loading the
 * files. `pnpm test:consumer` loads them, which is why it exists.
 *
 * A patch would fix this repo and nobody else — consumers install that
 * dependency from the registry, unpatched — so the fix has to be in what
 * Paperlab ships. Inlining the dependency into the CJS build removes the
 * `require` of it altogether.
 *
 * ESM keeps it external deliberately. It is not broken there, an ESM consumer
 * who also uses the package should get one copy rather than two, and there is
 * no reason for the healthy half of the audience to carry ~5 KB gzipped for a
 * bug that cannot reach them.
 */
export default defineConfig([
  {
    entry,
    format: ['esm'],
    dts: true,
    sourcemap: true,
    clean: true,
    external,
  },
  {
    entry,
    format: ['cjs'],
    dts: true,
    sourcemap: true,
    // The ESM pass above cleaned; a second clean would delete it.
    clean: false,
    external,
    noExternal: ['three-custom-shader-material'],
  },
])
