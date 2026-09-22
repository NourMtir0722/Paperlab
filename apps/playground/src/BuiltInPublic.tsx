import { useEffect, useState } from 'react'

/**
 * Where the sibling routes are, from wherever this app is mounted: `/` in dev
 * and `/playground/` once deployed. The same derivation the editor's chrome
 * makes, and the reason neither app hard-codes the domain.
 */
const SITE = import.meta.env.BASE_URL.replace(/playground\/?$/, '')

/**
 * The line at the foot of the playground: who makes paperlab, its one public
 * number, and the way to the roadmap and the sponsoring section.
 *
 * The editor says this as a card in a rail it has to spare. Here the scene IS
 * the screen and the chrome floats over it, so the same three facts are one
 * row instead — and on a phone it is the only shape that fits without taking
 * the scene's room.
 *
 * The number is read at runtime from the site's own stats.json, absent in dev
 * and absent if the deploy could not get it. Nothing is invented to fill it.
 */
export function BuiltInPublic() {
  const downloads = useDownloads()

  return (
    <div className="built-in-public">
      <a className="bip-maker" href="https://x.com/noormtir" target="_blank" rel="noreferrer">
        <img src={`${import.meta.env.BASE_URL}noor.jpg`} alt="" width={22} height={22} />
        Built in public by <strong>@noormtir</strong>
      </a>
      {downloads !== null && (
        <span className="bip-stat">
          <b>{downloads.toLocaleString('en-US')}</b> npm downloads
        </span>
      )}
      <a className="bip-link" href={`${SITE}lab-notes/#roadmap`}>
        Roadmap
      </a>
      <a className="bip-link" href={`${SITE}lab-notes/#sponsor`}>
        Sponsor paperlab
      </a>
    </div>
  )
}

function useDownloads() {
  const [downloads, setDownloads] = useState<number | null>(null)
  useEffect(() => {
    let live = true
    fetch(`${SITE}stats.json`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        const value = (body as { downloads?: unknown } | null)?.downloads
        if (live && typeof value === 'number' && Number.isFinite(value)) setDownloads(value)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])
  return downloads
}
