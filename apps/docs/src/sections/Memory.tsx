import { Paper, getStock, stockNames } from 'paperlab'
import { Live } from '../Live'
import { Snippet } from '../Snippet'

/**
 * Memory is the one page here that documents an absence being fixed.
 *
 * Every other section shows a thing the library can draw. This one shows a
 * thing it used to forget: a deformer is a pure function of its options, so
 * the same sheet folded and unfolded came back pristine. The demonstration
 * has to be the pair — the fold, and what is left of it — because either one
 * alone is just a bent rectangle.
 */

/** The two lines `letter-fold` bends, as creases of increasing depth. */
const tri = (depth: number) => [
  { angle: 270, offset: 1.4 / 6, depth },
  { angle: 90, offset: 1.4 / 6, depth: depth * 0.85 },
]

const LETTER = { type: 'text', text: 'folded once,\nand it shows', size: 40 } as const

export function Memory() {
  return (
    <section id="memory">
      <h2>Memory</h2>
      <p className="lede">
        Paper is plastic where cloth is elastic. Fold it and the fold stays — so a sheet carries the creases
        it has been folded along, whether or not it is folded now. Creases are recorded by folding the paper
        and they are ordinary config: they save into a preset and travel down a share link.
      </p>

      <div className="grid">
        <article className="card">
          <Live idle="flat">
            <Paper stock="printer" content={LETTER} memory={{ creases: [] }} physics="float" />
          </Live>
          <h3>never folded</h3>
          <p className="describe">
            A sheet with nothing behind it. This is what every paper in the library looked like after being
            folded flat and opened again, which is the thing this section exists to stop being true.
          </p>
        </article>

        <article className="card">
          <Live idle="creased">
            <Paper stock="printer" content={LETTER} memory={{ creases: tri(13) }} physics="float" />
          </Live>
          <h3>folded once</h3>
          <p className="describe">
            Two creases, thirteen degrees. A crease bends the sheet as well as marking it — the flaps sit open
            at the angle the fibres gave up at.
          </p>
        </article>

        <article className="card">
          <Live idle="well creased">
            <Paper stock="kraft" content={LETTER} memory={{ creases: tri(28) }} physics="float" />
          </Live>
          <h3>folded hard, in kraft</h3>
          <p className="describe">
            Same two lines on stock that holds a crease. Kraft's <code>takesSet</code> is{' '}
            {getStock('kraft').takesSet} against vellum's {getStock('vellum').takesSet}: thick and fibrous
            paper takes a set and keeps it, coated and translucent paper springs most of the way back.
          </p>
        </article>

        <article className="card">
          <Live idle="folding">
            <Paper preset="letter-fold" physics="none" autoplay />
          </Live>
          <h3>making one</h3>
          <p className="describe">
            Let it fold and open. A fold that closes past 45° at a line that stays put leaves a crease; one
            whose line <em>travels</em> leaves nothing, which is why paper coming off a roll is bent at the
            floor rather than creased along it.
          </p>
        </article>
      </div>

      <p className="describe">
        <code>set</code> overrides the stock's own <code>takesSet</code>, so leaving it out lets the paper
        decide. <code>memory={'{{ set: 0 }}'}</code> is the opt-out — perfectly elastic paper, which is how
        every sheet behaved before this existed. Stocks, most to least retentive:{' '}
        {[...stockNames]
          .sort((a, b) => getStock(b).takesSet - getStock(a).takesSet)
          .map((name) => `${name} ${getStock(name).takesSet}`)
          .join(' · ')}
        .
      </p>

      <Snippet
        code={`<Paper
  preset="letter-fold"
  memory={{
    set: 0.6,                    // how much of a fold this paper keeps (default: the stock's)
    creases: [                   // and the creases it already has, up to four
      { angle: 270, offset: 0.23, depth: 13 },
      { angle: 90, offset: 0.23, depth: 11 },
    ],
  }}
  onCrease={(creases) => save(creases)}   // fires when folding leaves a new one
/>`}
      />
    </section>
  )
}
