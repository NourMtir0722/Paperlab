import { Paper, getDeformer, listDeformers, type DeformerInstanceConfigInput } from 'paperlab'
import { Live } from '../Live'
import { Snippet } from '../Snippet'
import { Params } from '../Params'
import { describeSchema } from '../schemaDoc'

/**
 * The layer under the behaviors. Anyone writing a raw `deformers` stack had
 * nothing to read — the behaviors were documented and the seven pure
 * functions they expand into were not.
 */

/** Defaults are tuned for use inside a behavior; a few need turning up to read alone. */
const SHOW: Record<string, Record<string, unknown>> = {
  roll: { angle: 90, boundary: -0.1, radius: 0.1, thickness: 0.03 },
  curl: { corner: 'bottom-right', amount: 0.6, radius: 0.25 },
  bend: { curvature: 0.8, angle: 0 },
  fold: { angle: 90, offset: 0.15, foldAngle: 110, radius: 0.06 },
  wave: { amplitude: 0.09, wavelength: 0.4, speed: 0.9, angle: 75 },
  drape: { amplitude: 0.3, folds: 6, falloff: 1.2, irregular: 0.5, gather: 0.6, pinnedEdge: 'top' },
  crumple: { amount: 0.75, scale: 3, pull: 0.4, seed: 2 },
}

const NOTE: Record<string, string> = {
  roll: 'Winds the sheet onto a cylinder from one edge, arc-length exact — a rolled receipt is genuinely the same length of paper.',
  curl: 'Lifts one corner and curls it back over itself.',
  bend: 'A gentle arc about the sheet’s centre. What keeps a print from reading as a rectangle.',
  fold: 'A hinge across the sheet, with a rounded crease rather than a mathematical one.',
  wave: 'Travelling ripple. The only time-driven deformer — a stack containing it re-deforms every frame.',
  drape: 'Hanging folds gathered along a pinned edge, irregular by design. What makes a banner a banner.',
  crumple: 'An irregular network of creases with flat facets between them — paper that has been handled.',
}

export function Deformers() {
  return (
    <section id="deformers">
      <h2>Deformers</h2>
      <p className="lede">
        Underneath every behavior is a stack of these: pure vertex functions, applied in order, each one
        taking a flat sheet position and returning a bent one. A behavior is a curated bundle of them with
        human names on top. You can skip the behavior and write the stack yourself — that is the Advanced
        fork, and editing it in the editor forks the behavior for real.
      </p>
      <p className="note">
        Every one ships <strong>twice</strong>: a JS implementation that runs the hero path on the CPU, and a
        GLSL twin that runs the field path on the GPU, held identical by a golden-vector parity gate. That is
        the rule that makes one instanced draw call able to bend twenty sheets differently and still match
        what a single <code>&lt;Paper&gt;</code> does. Change one half and CI fails until you change the
        other.
      </p>

      <div className="grid pair">
        {listDeformers().map((id) => {
          const deformer = getDeformer(id)
          const options = SHOW[id] ?? (deformer.defaults as Record<string, unknown>)
          const stack = [{ type: id, options }] as DeformerInstanceConfigInput[]
          return (
            <article className="card" key={id}>
              <Live idle={id}>
                <Paper
                  stock="printer"
                  content={{
                    type: 'text',
                    text: `${id}\n\nthe sheet is the\nsame paper either way`,
                    size: 40,
                  }}
                  deformers={stack}
                />
              </Live>
              <h3>{id}</h3>
              <p className="describe">{NOTE[id] ?? deformer.label}</p>
              <Params rows={describeSchema(deformer.optionsSchema)} />
              <p className="meta">
                needs {deformer.geometry?.minSegments ?? 2}+ segments
                {deformer.animated ? ' · re-deforms every frame' : ''}
                {deformer.glsl?.strength ? ` · bias scales ${deformer.glsl.strength}` : ''}
              </p>
            </article>
          )
        })}
      </div>

      <Snippet
        code={`<Paper
  deformers={[
    { type: 'crumple', options: { amount: 0.6, scale: 3 } },
    { type: 'bend', options: { curvature: 0.3, angle: 35 } },
  ]}
/>`}
      />
      <p className="note">
        Order is the whole thing — each deformer reads the position the one before it produced. Crush the flat
        sheet, then curl the crushed sheet; the other way round would crease a curved sheet as if it were
        still flat. A raw stack overrides the preset’s <code>behavior</code> entirely.
      </p>
    </section>
  )
}
