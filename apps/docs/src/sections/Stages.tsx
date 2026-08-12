import { PaperStage, getStagePreset, listStagePresets } from 'paperlab'
import { LiveOnDemand } from '../Live'
import { Snippet } from '../Snippet'

/**
 * Stage mode is the one where the paper is the room rather than the object.
 * These load on click: a stage is a whole space — a colonnade of banners, a
 * figure, a cyclorama — and five of them autoplaying would cost more than
 * the library does.
 */
export function Stages() {
  return (
    <section id="stages">
      <h2>Stages</h2>
      <p className="lede">
        <code>&lt;PaperStage&gt;</code> builds a space out of paper: banners hung along a walk, with a figure
        walking down it. Bind <code>progress</code> to scroll and the page scrolls the walk. The load-bearing
        invariant is that <strong>every part reads the same walk</strong> — the layout arranges along it, the
        figure follows it, the camera is stationed on it, and the light stands at the end of it.
      </p>

      <div className="grid pair">
        {listStagePresets().map((id) => {
          const preset = getStagePreset(id)
          return (
            <article className="card" key={id}>
              <LiveOnDemand label={preset.label} height={340}>
                <PaperStage
                  stage={preset.stage}
                  layout={preset.layout}
                  layoutOptions={preset.layoutOptions}
                  preset={preset.paper}
                  text={preset.text}
                  count={preset.count}
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
    lighting: 'nave',
    showFigure: true,
  }}
  progress={scrollProgress}      // omit it and the figure walks on its own clock
  quality="auto"
/>`}
      />
      <p className="note">
        <code>quality</code> is deliberately not part of <code>stageSchema</code> — it describes the{' '}
        <em>device</em>, not the artwork, so it never travels in a preset or a shared link.
      </p>
    </section>
  )
}
