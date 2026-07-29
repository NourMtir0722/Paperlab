import { useEffect, useState } from 'react'
import type { PaperConfig } from '../config/schema'
import { getStock } from '../core/stock'
import { receiptTotals, type ReceiptContent } from '../content/receipt'

/**
 * Accessibility layer: reduced-motion handling, a hidden DOM mirror so the
 * paper's content exists for screen readers and find-in-page, and a no-WebGL
 * DOM fallback.
 */

export function usePrefersReducedMotion(override?: boolean): boolean {
  const [system, setSystem] = useState(
    () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
  )
  useEffect(() => {
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!query) return
    const onChange = () => setSystem(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  return override ?? system
}

let webglSupport: boolean | null = null

export function supportsWebGL(): boolean {
  if (webglSupport !== null) return webglSupport
  try {
    const canvas = document.createElement('canvas')
    webglSupport = Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'))
  } catch {
    webglSupport = false
  }
  return webglSupport
}

/** Human-readable text equivalent of a paper's content. */
export function contentText(config: PaperConfig): string {
  const content = config.content
  if (content.type === 'text') return content.text
  if (content.type === 'image') return content.alt ?? 'An image printed on paper.'
  if (content.type === 'receipt') {
    const totals = receiptTotals(content as ReceiptContent)
    const items = content.items.map((i) => `${i.name} ${i.price.toFixed(2)}`).join(', ')
    return `Receipt from ${content.store}: ${items}. Total ${totals.total.toFixed(2)}. ${content.footer}`
  }
  return 'A blank sheet of paper.'
}

const visuallyHidden: React.CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
}

/** Hidden DOM twin of the 3D paper — screen readers read it, ctrl-F finds it. */
export function PaperMirror({ config }: { config: PaperConfig }) {
  return (
    <div style={visuallyHidden} aria-hidden={false}>
      {contentText(config)}
    </div>
  )
}

/** No WebGL: the paper renders flat — content on a stock-tinted card. */
export function PaperFallback({ config }: { config: PaperConfig }) {
  const stock = getStock(config.stock)
  const isImage = config.content.type === 'image'
  return (
    <div
      role="img"
      aria-label={contentText(config)}
      style={{
        width: '100%',
        height: '100%',
        display: 'grid',
        placeItems: 'center',
        background: 'transparent',
      }}
    >
      <div
        style={{
          aspectRatio: `${config.sheet.width} / ${config.sheet.height}`,
          maxWidth: '80%',
          maxHeight: '90%',
          background: stock.color,
          color: stock.inkColor,
          boxShadow: '0 6px 24px rgba(0,0,0,0.25)',
          padding: '8%',
          overflow: 'hidden',
          fontFamily: config.content.type === 'receipt' ? 'ui-monospace, monospace' : 'Georgia, serif',
          whiteSpace: 'pre-wrap',
          fontSize: 14,
        }}
      >
        {isImage && config.content.type === 'image' ? (
          <img
            src={config.content.src}
            alt={config.content.alt ?? ''}
            style={{ width: '100%', height: '100%', objectFit: 'cover', margin: '-8%' }}
          />
        ) : (
          contentText(config)
        )}
      </div>
    </div>
  )
}
