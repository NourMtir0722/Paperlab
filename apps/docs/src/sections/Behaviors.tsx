import {
  Paper,
  getBehavior,
  listBehaviors,
  type BehaviorConfigInput,
  type ContentConfigInput,
  type SheetConfig,
} from 'paperlab'
import { Live } from '../Live'
import { Snippet } from '../Snippet'
import { describeSchema } from '../schemaDoc'
import { Params } from '../Params'

/**
 * Behaviors are the layer designers actually touch: three to five
 * human-named params ('tightness', not 'cylinderRadius') over a stack of
 * pure deformers. The params table is walked out of each behavior's own zod
 * schema, so a community behavior documents itself the moment it registers.
 */

/**
 * A behavior needs the right sheet under it — an unroll on a square is a
 * shrug. Kept under ~1.6 units tall on purpose: `<Paper>` frames with a fixed
 * camera, so a taller sheet crops out of every card no matter how tall the
 * card is. Same ratios, smaller paper.
 */
const SHEET: Record<string, Partial<SheetConfig>> = {
  unroll: { width: 0.6, height: 1.56 },
  'letter-fold': { width: 1, height: 1.4 },
  hang: { width: 1.2, height: 1.54 },
  fall: { width: 1.1, height: 1.4 },
  flight: { width: 0.9, height: 1.2 },
}

const CONTENT: ContentConfigInput = {
  type: 'text',
  text: 'The sheet is real\ngeometry. Every\nparam below bends it.',
  size: 46,
}

/** What the motion is *of* — the thing a params table cannot tell you. */
const NOTE: Record<string, string> = {
  peel: 'A corner lifts and curls back on itself. The hero move.',
  unroll: 'A receipt coming off the roll — tight at the top, flattening as it runs.',
  flip: 'A page turning about its spine.',
  'letter-fold': 'A tri-fold, creased where a letter creases.',
  hang: 'Pinned along the top edge and rippling. Sag is gravity, wind is the room.',
  fly: 'A note in the air, fluttering along a curve.',
  fall: 'A dropped sheet, curling as it goes.',
  carry: 'Held at one point and drooping from it — the pinch does the work.',
  flight: 'Free paper travelling across the whole scene on the wind.',
}

export function Behaviors() {
  return (
    <section id="behaviors">
      <h2>Behaviors</h2>
      <p className="lede">
        One <code>behavior</code> per paper, discriminated on <code>type</code>. Each expands to a deformer
        stack underneath; you tune the named params and the stack follows. The scrubber a transport drives is
        the behavior's own <code>progress</code> param.
      </p>

      <div className="grid pair">
        {listBehaviors().map((id) => {
          const behavior = getBehavior(id)
          const params = describeSchema(behavior.optionsSchema)
          return (
            <article className="card" key={id}>
              <Live idle={id}>
                <Paper
                  sheet={SHEET[id]}
                  stock="printer"
                  content={CONTENT}
                  behavior={{ type: id, ...behavior.defaults } as BehaviorConfigInput}
                  autoplay
                />
              </Live>
              <h3>{id}</h3>
              <p className="describe">{NOTE[id] ?? behavior.label}</p>
              <Params rows={params} />
              <p className="meta">
                plays <code>{behavior.progressParam}</code> over {behavior.duration}s · {behavior.loopMode}
              </p>
              <details>
                <summary>code</summary>
                <Snippet code={`<Paper behavior={{ type: '${id}' }} autoplay />`} />
              </details>
            </article>
          )
        })}
      </div>
    </section>
  )
}
