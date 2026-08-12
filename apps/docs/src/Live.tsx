import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * A card holds a WebGL context only while you can see it.
 *
 * This page is forty-odd live canvases and a browser gives you about sixteen
 * before it starts quietly killing the oldest — which shows up as blank cards
 * further down rather than as an error anyone would notice. So each card
 * mounts its scene when it scrolls into view and drops it when it leaves, and
 * the page never holds more than a screenful.
 *
 * The margin is generous on purpose: the paper should already be moving by
 * the time it reaches your eye, not pop in under it.
 */
export function Live({
  children,
  height = 240,
  idle = 'paper',
}: {
  children: ReactNode
  height?: number
  idle?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(([entry]) => setVisible(Boolean(entry?.isIntersecting)), {
      rootMargin: '300px 0px',
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div className="live" ref={ref} style={{ height }}>
      {visible ? children : <span className="live-idle">{idle}</span>}
    </div>
  )
}

/**
 * The same, but it waits to be asked. A stage is a whole room — figure,
 * cyclorama, a colonnade of banners — and five of them autoloading would
 * make the page cost more than the library does.
 */
export function LiveOnDemand({
  children,
  height = 320,
  label,
}: {
  children: ReactNode
  height?: number
  label: string
}) {
  const [on, setOn] = useState(false)
  return (
    <div className="live" style={{ height }}>
      {on ? (
        children
      ) : (
        <button type="button" className="live-load" onClick={() => setOn(true)}>
          <span className="live-load-icon">▶</span>
          <span>Walk {label}</span>
        </button>
      )}
    </div>
  )
}
