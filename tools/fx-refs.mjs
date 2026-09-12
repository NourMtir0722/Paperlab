/**
 * Where the fire references live.
 *
 * `paperlab-fx-fire-spec.md` says what fire must look like, and every claim in
 * it points at an image in `fx-refs/fire/` beside it. Those images are 20 MB
 * of AI-generated stills. They are not in this repo, for the same reason the
 * plan they sit beside is not: they are the argument for the work, not the
 * work, and a library that ships at 38 KB gzipped does not want 20 MB of
 * research in its history.
 *
 * So they are resolved rather than vendored. The default is where the spec
 * actually lives — `../plans/fx-refs`, beside `paperlab-fx-plan.md` — and
 * `PAPERLAB_FX_REFS` overrides it for anyone whose checkout is somewhere
 * else. Nothing here fetches anything; if the directory is not there, the
 * things that need it say so in one sentence rather than rendering a page of
 * broken images.
 *
 * Imported by BOTH `vite.config.ts` (which serves them to `/fx-lab` in dev)
 * and `tools/fire-look.mjs` (which lays them beside the captures), so the two
 * can never look in different places.
 */
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { root } from './harness.mjs'

/** The directory holding one folder per effect. */
export function fxRefsDir() {
  return process.env.PAPERLAB_FX_REFS ?? resolve(root, '..', 'plans', 'fx-refs')
}

/** The fire stills themselves, or null if they are not on this machine. */
export function fireRefsDir() {
  const dir = resolve(fxRefsDir(), 'fire')
  return existsSync(dir) ? dir : null
}

/** The one sentence to print when they are missing. */
export const NO_REFS =
  `the fire references are not at ${resolve(fxRefsDir(), 'fire')}.\n` +
  'They live beside paperlab-fx-fire-spec.md — set PAPERLAB_FX_REFS to the fx-refs\n' +
  'directory that holds them.'
