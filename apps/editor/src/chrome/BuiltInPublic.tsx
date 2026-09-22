import { useEffect, useState } from 'react'
import { SITE } from './site'
import { type SiteStats, formatCount, parseSiteStats, visitsLabel } from './siteStats'

/**
 * The card at the foot of the left rail, in every mode: who makes paperlab,
 * its public numbers, and links to the roadmap and the sponsoring section.
 *
 * It sticks to the foot of the rail rather than riding the end of it. The rail
 * scrolls, and a card that scrolls with it is a card a laptop only ever sees
 * half of: the modes with long lists (presets, the field's slots) push it past
 * the bottom edge, and the one thing on the screen pointing at the roadmap and
 * the sponsoring section was the thing hidden. On a short screen the sentence
 * goes and the rest stays, which is the part that is a link.
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
        <img src={`${import.meta.env.BASE_URL}noor.jpg`} alt="" width={28} height={28} />
        <span>
          I'm <strong>@noormtir</strong> ↗<small>I made paperlab</small>
        </span>
      </a>
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
      <p>paperlab grows one piece at a time. See what's next, or put your tool in the build.</p>
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
