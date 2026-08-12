import { Paper, idleNames } from 'paperlab'
import { Live } from '../Live'
import { Snippet } from '../Snippet'

/**
 * Two different things share one prop. Idle presets are cheap curated motion
 * that composes WITH a behavior; cloth is a verlet simulation that owns the
 * vertices and therefore cannot. The schema rejects the pair rather than
 * letting them fight — which is why the error you get is a zod error and not
 * a shrug.
 */

const NOTE: Record<string, string> = {
  float: 'Suspended and breathing. The default for anything that should not sit still.',
  tumble: 'Slow end-over-end rotation, as if turning in space.',
  dangle: 'Hanging from a point and swinging under it.',
  taped: 'Stuck at one corner, the rest lifting and settling.',
  breeze: 'A draught across the sheet — small, constant, never repeating.',
}

export function Physics() {
  return (
    <section id="physics">
      <h2>Physics</h2>
      <p className="lede">
        Idle presets are curated motion — a few sines, no simulation — and they compose with whatever behavior
        is already running.
      </p>

      <div className="grid">
        {idleNames.map((name) => (
          <article className="card" key={name}>
            <Live idle={name}>
              <Paper
                stock="printer"
                content={{ type: 'text', text: name, size: 64, align: 'center' }}
                physics={name}
              />
            </Live>
            <h3>{name}</h3>
            <p className="describe">{NOTE[name]}</p>
          </article>
        ))}

        <article className="card" key="cloth">
          <Live idle="cloth">
            <Paper
              stock="printer"
              sheet={{ width: 1.3, height: 1.6 }}
              content={{ type: 'text', text: 'grab me', size: 56, align: 'center' }}
              physics={{ type: 'cloth', pins: 'top-corners', wind: 0.5 }}
              interactive
            />
          </Live>
          <h3>cloth</h3>
          <p className="describe">
            A real verlet simulation. Pin it by <code>'top-edge'</code>, <code>'top-corners'</code>,{' '}
            <code>'corner'</code> or <code>'none'</code> and it falls. With <code>interactive</code> you can
            grab it — try it.
          </p>
        </article>
      </div>

      <Snippet
        code={`<Paper physics="float" behavior={{ type: 'peel' }} />          // composes

<Paper physics={{ type: 'cloth', pins: 'top-edge', wind: 0.4 }} interactive />
// cloth + behavior together throws by design: cloth owns the vertices.`}
      />
    </section>
  )
}
