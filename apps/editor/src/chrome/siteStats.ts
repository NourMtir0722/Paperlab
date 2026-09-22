/**
 * The site's public numbers, as `tools/site-stats.mjs` writes them at deploy.
 *
 * Read at runtime from the site root rather than baked into the bundle, so the
 * daily rebuild only has to rewrite one small file's worth of truth. In dev
 * there is no such file and every number is simply absent: the card still
 * shows, with its links, and nothing is invented to fill it.
 *
 * `/lab-notes/` is a plain page and reads the same file with its own few
 * lines of script; the label logic there matches `visitsLabel` below.
 */
export type SiteStats = {
  visits: { count: number; from: string; days: number } | null
  downloads: number | null
}

const count = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null)

/** Anything that is not the shape the script writes reads as "no number". */
export function parseSiteStats(raw: unknown): SiteStats {
  const body = (raw ?? {}) as Record<string, unknown>
  const v = body.visits as Record<string, unknown> | null | undefined
  const visits =
    v && count(v.count) !== null && typeof v.from === 'string' && count(v.days) !== null
      ? { count: v.count as number, from: v.from, days: v.days as number }
      : null
  return { visits, downloads: count(body.downloads) }
}

/**
 * What the visit figure covers. Cloudflare only counts from the day its beacon
 * went on the site, so until it has thirty days behind it the label says
 * where the count starts instead of claiming a month it does not have.
 */
export function visitsLabel(visits: { from: string; days: number }): string {
  if (visits.days >= 30) return 'visits, last 30 days'
  const since = new Date(`${visits.from}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
  return `visits since ${since}`
}

export const formatCount = (n: number) => n.toLocaleString('en-US')
