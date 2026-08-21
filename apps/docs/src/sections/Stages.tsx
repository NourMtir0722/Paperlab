import { PaperStage, getStagePreset, listStagePresets } from 'paperlab/stage'
import { LiveOnDemand } from '../Live'
import { Snippet } from '../Snippet'

/**
 * Stage mode is the one where the paper is the room rather than the object.
 * These load on click: a stage is a whole space — a colonnade of banners, a
 * figure, a cyclorama — and five of them autoplaying would cost more than
 * the library does.
 */
/**
 * The walking figure's model, served from this app's own `public/`.
 *
 * Built off BASE_URL rather than hardcoded, because the editor deploys under
 * `/editor/` and the docs under `/docs/` — an absolute `/figure/...` would
 * resolve to the site root and 404 for two apps out of three.
 *
 * It lives here rather than in a stage preset because the library ships no
 * assets: a preset naming a URL would be a promise the npm package cannot
 * keep. The app hosts the file, the app points at it.
 */
const FIGURE_MODEL = `${import.meta.env.BASE_URL}figure/walking-figure.glb`

export function Stages() {
  return (
    <section id="stages">
      <h2>Stages</h2>
      <p className="lede">
        Drag any of them to walk it yourself, or click one into focus and step banner to banner with the arrow
        keys. <code>&lt;PaperStage&gt;</code> builds a space out of paper: banners hung along a walk, with a
        figure walking down it. Bind <code>progress</code> to scroll and the page scrolls the walk. The
        load-bearing invariant is that <strong>every part reads the same walk</strong> — the layout arranges
        along it, the figure follows it, the camera is stationed on it, and the light stands at the end of it.
      </p>

      <div className="grid pair">
        {listStagePresets().map((id) => {
          const preset = getStagePreset(id)
          return (
            <article className="card" key={id}>
              <LiveOnDemand label={preset.label} height={340}>
                <PaperStage
                  stage={{ ...preset.stage, figure: { ...preset.stage.figure, model: FIGURE_MODEL } }}
                  layout={preset.layout}
                  layoutOptions={preset.layoutOptions}
                  preset={preset.paper}
                  text={preset.text}
                  count={preset.count}
                  // Draggable and arrow-steppable, but it does not take the
                  // wheel: five of these sit in a scrolling column, and a card
                  // that eats a reader's scroll on the way past is hostile.
                  motion={{ capture: false }}
                />
              </LiveOnDemand>
              <h3>{id}</h3>
              <p className="describe">{preset.description}</p>
              <p className="meta">
                {preset.label} · {preset.count} banners · {preset.layout}
              </p>
            </article>
          )
        })}
      </div>

      <Snippet
        code={`<PaperStage
  text="the paper remembers every hand that folded it"
  count={18}
  stage={{
    path: getWalk('straight'),   // straight | bend | ess | ring | spiral
    shot: { shot: 'follow' },    // follow | lead | low | wide
    lighting: 'nave',            // the preset — the starting point, not the ceiling
    light: { exposure: 0.9, direction: 180, height: 24, studio: 0.6 },
    figure: { model: '/figure/walking.glb' },   // your asset, your URL
    showFigure: true,
  }}
  progress={scrollProgress}      // omit it and the figure walks on its own clock
  quality="auto"
/>`}
      />
      <p className="note">
        <code>light</code> is a set of <em>overrides</em> on the named preset, in the terms a person would say
        them in: <code>direction</code> and <code>height</code> are degrees around the room and degrees above
        the horizon, and <code>studio</code> is the room itself as an environment map — the directional fill
        that gives paper form and something for its sheen to reflect. Only the fields you move are serialized.
      </p>
      <p className="note">
        <code>quality</code> is deliberately not part of <code>stageSchema</code> — it describes the{' '}
        <em>device</em>, not the artwork, so it never travels in a preset or a shared link.
      </p>
    </section>
  )
}
