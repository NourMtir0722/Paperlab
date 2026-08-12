import { Paper, stocks, type StockName } from 'paperlab'
import { Live } from '../Live'
import { Snippet } from '../Snippet'

/**
 * Stock is the one choice that changes everything downstream — colour, sheen,
 * how ink sits, whether light comes through. Same sheet and same words on
 * every card, so the material is the only variable.
 */

const NOTE: Record<StockName, string> = {
  printer: 'Office white. The neutral default.',
  thermal: 'Receipt paper: warm, faintly banded, grey-black ink.',
  kraft: 'Brown packing paper, rough and opaque.',
  newsprint: 'Cheap, greyed, and thin enough to read through.',
  vellum: 'Translucent — put a light behind it and it glows.',
  'photo-gloss': 'Smooth and specular. Photographs live here.',
  sticker: 'Glossy white adhesive back; nothing shows through.',
}

export function Stocks() {
  return (
    <section id="stocks">
      <h2>Stocks</h2>
      <p className="lede">
        Seven named papers. A stock is a bundle of material and surface defaults — picking paper at a print
        shop — and every individual control still overrides it.
      </p>

      <div className="grid">
        {Object.values(stocks).map((stock) => (
          <article className="card" key={stock.id}>
            <Live idle={stock.id}>
              <Paper
                stock={stock.id}
                content={{ type: 'text', text: `${stock.label}\n\nthe quick brown fox`, size: 44 }}
                physics="float"
              />
            </Live>
            <h3>{stock.id}</h3>
            <p className="describe">{NOTE[stock.id] ?? stock.label}</p>
            <p className="meta">
              roughness {stock.roughness} · translucency {stock.translucency} · ink{' '}
              <span className="swatch" style={{ background: stock.inkColor }} /> {stock.inkColor}
            </p>
          </article>
        ))}
      </div>

      <Snippet code={`<Paper stock="vellum" content={{ type: 'text', text: 'read through me' }} />`} />
    </section>
  )
}
