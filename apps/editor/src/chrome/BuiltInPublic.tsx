import { useEffect, useState } from 'react'
import { SITE } from './site'
import { type SiteStats, formatCount, parseSiteStats, visitsLabel } from './siteStats'

/**
 * The card at the foot of the left rail, in every mode: who makes paperlab,
 * its public numbers, and links to the roadmap and the sponsoring section.
 *
 * The photo ships with the site rather than loading from X, so the rail never
 * asks a third party for anything.
 *
 * Both links go to /lab-notes/, one page holding the roadmap and the
 * sponsoring section: the hash says which comes first, and the other follows
 * it.
 */
export function BuiltInPublic() {
  const stats = useSiteStats()
  const rows: [string, string][] = []
  if (stats?.visits) rows.push([formatCount(stats.visits.count), visitsLabel(stats.visits)])
  if (stats?.downloads != null) rows.push([formatCount(stats.downloads), 'npm downloads'])

  return (
    <section className="built-in-public" aria-label="Built in public">
      <a className="maker" href="https://x.com/noormtir" target="_blank" rel="noreferrer">
        <img src={`${import.meta.env.BASE_URL}noor.jpg`} alt="" width={36} height={36} />
        <span>
          I'm <strong>@noormtir</strong> ↗<small>I made paperlab</small>
        </span>
      </a>
      <h2>Built in public</h2>
      {rows.length > 0 && (
        <dl>
          {rows.map(([value, label]) => (
            <div key={label}>
              <dt>{value}</dt>
              <dd>{label}</dd>
            </div>
          ))}
        </dl>
      )}
      <p>paperlab grows one piece at a time. See what I'm building next, or put your tool in the build.</p>
      <div className="built-in-public-links">
        <a href={`${SITE}lab-notes/#sponsor`}>Sponsor paperlab</a>
        <a href={`${SITE}lab-notes/#roadmap`}>Roadmap</a>
      </div>
    </section>
  )
}

function useSiteStats() {
  const [stats, setStats] = useState<SiteStats | null>(null)
  useEffect(() => {
    let live = true
    fetch(`${SITE}stats.json`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => live && setStats(parseSiteStats(body)))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])
  return stats
}
