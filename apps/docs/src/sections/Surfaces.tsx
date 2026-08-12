import { Paper, type SurfaceConfigInput } from 'paperlab'
import { Live } from '../Live'
import { Snippet } from '../Snippet'

/**
 * Surface effects are fragment-side, composed in registration order into one
 * shader program. They are most of the difference between "a texture on a
 * rectangle" and "paper" — and each one serializes as a number or a small
 * object, which is the test that got them in.
 */

const EFFECTS: { key: keyof SurfaceConfigInput; title: string; note: string; surface: SurfaceConfigInput }[] =
  [
    {
      key: 'grain',
      title: 'grain',
      note: 'Fiber noise. Nothing else makes a flat white sheet stop looking like a plane.',
      surface: { grain: 0.85 },
    },
    {
      key: 'aging',
      title: 'aging',
      note: 'Yellowing and foxing spots — paper that has been somewhere.',
      surface: { aging: 0.8, grain: 0.5 },
    },
    {
      key: 'deckle',
      title: 'deckle',
      note: 'A torn edge, alpha-punched along an fbm-gnawed boundary with a lightened fiber band.',
      surface: { deckle: { edges: ['bottom', 'right'], roughness: 0.8 }, grain: 0.4 },
    },
    {
      key: 'creaseLines',
      title: 'creaseLines',
      note: 'The shading companion to a fold — where the sheet has been creased, whether or not it is folded now.',
      surface: { creaseLines: { angle: 0, positions: [1 / 3, 2 / 3], strength: 0.9 }, grain: 0.3 },
    },
    {
      key: 'perforation',
      title: 'perforation',
      note: 'Stamp perforation. Tear one off a sheet field and the edges facing its neighbours flip to torn on their own.',
      surface: { perforation: { edges: 'all', holeRadius: 0.03, spacing: 0.09 } },
    },
    {
      key: 'translucency',
      title: 'translucency',
      note: 'Light coming through from behind. Distinct from opacity — newsprint is opaque and still glows on a lightbox.',
      surface: { translucency: 0.9 },
    },
  ]

export function Surfaces() {
  return (
    <section id="surfaces">
      <h2>Surface</h2>
      <p className="lede">
        Stocks contribute surface defaults; anything you set explicitly wins, per effect. All of these compose
        — a vintage note is aging plus grain plus a deckled top and bottom.
      </p>

      <div className="grid">
        {EFFECTS.map((effect) => (
          <article className="card" key={String(effect.key)}>
            <Live idle={effect.title}>
              <Paper
                stock={effect.key === 'translucency' ? 'vellum' : 'printer'}
                content={{ type: 'text', text: 'paper has a\nsurface, and the\nsurface is data', size: 44 }}
                surface={effect.surface}
                physics="float"
              />
            </Live>
            <h3>{effect.title}</h3>
            <p className="describe">{effect.note}</p>
          </article>
        ))}
      </div>

      <Snippet
        code={`<Paper
  stock="newsprint"
  surface={{
    grain: 0.6,
    aging: 0.55,
    deckle: { edges: ['top', 'bottom'], roughness: 0.4 },
  }}
/>`}
      />
    </section>
  )
}
