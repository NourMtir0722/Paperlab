import { Paper, buildJsxSnippet, describeConfig, getPreset, listPresets } from 'paperlab'
import { Live } from '../Live'
import { Snippet } from '../Snippet'

/**
 * The catalogue is `listPresets()`, not a list I typed. Register a preset and
 * it appears here; delete one and it disappears. This page cannot advertise
 * something the library does not have, which is the failure mode the README
 * has already had once.
 */
export function Presets() {
  return (
    <section id="presets">
      <h2>Presets</h2>
      <p className="lede">
        A preset is a whole paper — sheet, stock, content, behavior, surface — serialized as one JSON object.
        It is the unit you save, share and export, and it is what <code>preset="name"</code> resolves. Every
        one below is rendering live.
      </p>

      <div className="grid">
        {listPresets().map((name) => {
          const config = getPreset(name)
          return (
            <article className="card" key={name}>
              <Live idle={name}>
                <Paper preset={name} autoplay />
              </Live>
              <h3>{name}</h3>
              <p className="describe">{describeConfig(config)}</p>
              <details>
                <summary>code</summary>
                <Snippet code={`<Paper preset="${name}" autoplay />`} />
                <p className="note">
                  …or spelled out, which is what <code>diffConfig</code> gives you and what the editor's
                  export writes:
                </p>
                <Snippet code={buildJsxSnippet(config)} />
              </details>
            </article>
          )
        })}
      </div>

      <p className="note">
        A <code>.paper</code> file somebody sends you <em>is</em> one of these objects. <code>preset</code>{' '}
        takes a name or a config, so import the JSON and pass it straight through — never expand it back into
        individual props.
      </p>
      <Snippet
        code={`import theirPaper from './their-paper.paper.json'

<Paper preset={theirPaper} autoplay />`}
      />
    </section>
  )
}
