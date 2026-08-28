import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { listPresets } from 'paperlab'
import { listStagePresets } from 'paperlab/stage'

/**
 * The README counts its own presets, and nothing checked the number.
 *
 * It claimed fifteen paper presets while the library shipped sixteen. That
 * file is the npm page — generated into the published tarball and frozen
 * there — so a wrong number outlives the release that introduced it. Adding a
 * preset is the moment the sentence goes stale, and adding a preset is
 * exactly when nobody is re-reading prose.
 *
 * Same argument as the generated-README gate: a claim nothing verifies is a
 * claim that drifts. It lives here rather than in the library because the
 * library has no `@types/node` on purpose, and this needs to read a file.
 */
const README = resolve(import.meta.dirname, '../../../../README.md')

describe('the README counts', () => {
  it('states the number of presets the library actually has', () => {
    const readme = readFileSync(README, 'utf8')
    const claim = readme.match(/(\d+) paper presets and (\d+) stage presets/)
    expect(claim, 'the README no longer states its preset counts — update this test with it').not.toBeNull()

    const [, paper, stage] = claim as RegExpMatchArray
    expect(
      { paper: Number(paper), stage: Number(stage) },
      `README.md says "${claim?.[0]}" — fix it, then \`pnpm build\` to regenerate packages/paperlab/README.md`,
    ).toEqual({ paper: listPresets().length, stage: listStagePresets().length })
  })
})
