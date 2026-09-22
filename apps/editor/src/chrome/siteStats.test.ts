import { describe, expect, it } from 'vitest'
import { parseSiteStats, visitsLabel } from './siteStats'

describe('parseSiteStats', () => {
  it('reads what tools/site-stats.mjs writes', () => {
    expect(
      parseSiteStats({
        updated: '2026-09-22T05:17:00Z',
        visits: { count: 1234, from: '2026-09-23', to: '2026-09-27', days: 5 },
        downloads: 2326,
      }),
    ).toEqual({ visits: { count: 1234, from: '2026-09-23', days: 5 }, downloads: 2326 })
  })

  it('drops a source the script skipped, and never invents one', () => {
    expect(parseSiteStats({ visits: null, downloads: 2326 })).toEqual({ visits: null, downloads: 2326 })
    expect(parseSiteStats(null)).toEqual({ visits: null, downloads: null })
    expect(parseSiteStats({ downloads: '2326', visits: { count: 3 } })).toEqual({
      visits: null,
      downloads: null,
    })
  })
})

describe('visitsLabel', () => {
  it('claims thirty days only once it has them', () => {
    expect(visitsLabel({ from: '2026-09-23', days: 5 })).toBe('visits since Sep 23')
    expect(visitsLabel({ from: '2026-10-01', days: 30 })).toBe('visits, last 30 days')
  })
})
