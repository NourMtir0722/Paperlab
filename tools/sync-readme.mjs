#!/usr/bin/env node
/**
 * Generates the npm-facing README from the repo one.
 *
 * They were two hand-maintained copies, and the copy lost: by the time
 * anyone noticed, npm's page was missing a layout rename, all of stage
 * mode, and every moving image. npmjs.com cannot resolve repo-relative
 * paths, which is the only reason a second file exists at all — so derive
 * it instead of remembering it.
 *
 * Runs as part of `pnpm --filter paperlab build`, so a published tarball
 * cannot carry a stale page.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// Images resolve against the custom domain rather than raw.githubusercontent.
// A published README is frozen at its version forever, and a raw URL carries
// the GitHub username in it — so renaming the account would break every image
// on every release already sitting on npm. The domain outlives the username.
// The workflow copies docs/media to /media on the site to make these resolve.
const MEDIA = 'https://paperlab.nawwara.studio/media'
const BLOB = 'https://github.com/NourMtir0722/Paperlab/blob/main'

const source = readFileSync(resolve(root, 'README.md'), 'utf8')

const absolute = source
  // Images resolve against the site's /media; anything else against blob.
  .replace(
    /!\[([^\]]*)\]\((?!https?:)([^)]+)\)/g,
    (_, alt, path) => `![${alt}](${MEDIA}/${path.replace(/^docs\/media\//, '')})`,
  )
  .replace(/(?<!!)\[([^\]]+)\]\((?!https?:|#)([^)]+)\)/g, (_, text, path) => `[${text}](${BLOB}/${path})`)

const out = resolve(root, 'packages/paperlab/README.md')
const previous = (() => {
  try {
    return readFileSync(out, 'utf8')
  } catch {
    return ''
  }
})()

if (previous === absolute) {
  console.log('README in sync')
} else {
  writeFileSync(out, absolute)
  console.log(`README regenerated → ${out.replace(`${root}/`, '')}`)
}
