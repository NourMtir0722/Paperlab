import { PaperField, getLayout, listLayouts } from 'paperlab'
import { Live } from '../Live'
import { Snippet } from '../Snippet'
import { Params } from '../Params'
import { describeSchema } from '../schemaDoc'
import { demoTiles } from '../demoTiles'

/**
 * Every layout names a place paper actually sits. They are pure functions —
 * index in, pose out — which is why a new one is about thirty lines and the
 * shortest rung on the contribution ladder.
 */

const TILES = demoTiles(12)

/** A layout arranges a particular kind of paper; a few want their own. */
const SETUP: Record<string, { count: number; preset: string }> = {
  sheet: { count: 10, preset: 'postage-stamp' },
  book: { count: 8, preset: 'typed-note' },
  accordion: { count: 8, preset: 'typed-note' },
  colonnade: { count: 7, preset: 'hanging-poster' },
}

const NOTE: Record<string, string> = {
  ring: 'A carousel you orbit. The field default.',
  fan: 'Held cards, splayed from one corner.',
  spread: 'Laid out flat, side by side, like prints on a table.',
  pile: 'Dropped in a stack, each sheet a little off true.',
  rack: 'A magazine rack — overlapping, front-facing, leaning back.',
  wall: 'A grid, hung. The gallery.',
  spill: 'Knocked over and scattered across the floor.',
  sweep: 'A long arc, as if fanned across a desk in one motion.',
  book: 'Bound at a spine, pages opening.',
  accordion: 'Concertina-folded — one continuous strip zig-zagging.',
  colonnade: 'Banners hung down an avenue. The one built to arrange along a walk.',
  sheet: 'Rows and columns on a shared backing — a block of stamps.',
}

export function Layouts() {
  return (
    <section id="layouts">
      <h2>Layouts</h2>
      <p className="lede">
        <code>&lt;PaperField&gt;</code> renders many sheets in a single instanced draw call. The layout
        decides where each one goes — and sets a per-sheet <em>bias</em>, so one draw call can still bend
        every sheet differently. Layouts receive the field's sheet size, so the contact ones arrange by real
        edges rather than guesses.
      </p>

      <div className="grid pair">
        {listLayouts().map((id) => {
          const layout = getLayout(id)
          const setup = SETUP[id]
          const count = setup?.count ?? 12
          return (
            <article className="card" key={id}>
              <Live idle={id} height={280}>
                <PaperField
                  layout={id}
                  preset={setup?.preset ?? 'photo-print'}
                  {...(setup ? { papers: Array.from({ length: count }, () => ({})) } : { images: TILES })}
                  motion={{ driver: 'autoplay', speed: 0.35 }}
                  entrance={{ type: 'rise' }}
                />
              </Live>
              <h3>{id}</h3>
              <p className="describe">{NOTE[id] ?? layout.label}</p>
              <Params rows={describeSchema(layout.optionsSchema)} />
            </article>
          )
        })}
      </div>

      <Snippet
        code={`<PaperField
  images={['/a.jpg', '/b.jpg', '/c.jpg']}
  preset="photo-print"
  layout="wall"
  layoutOptions={{ columns: 3 }}
  motion={{ driver: 'drag' }}
  entrance={{ type: 'rise', stagger: 0.06 }}
/>`}
      />
      <p className="note">
        Don't hand-place a camera for a field — <code>&lt;PaperField&gt;</code> fits its own to whatever the
        layout posed.
      </p>
    </section>
  )
}
