import { useEffect, useState } from 'react'
import { Paper } from 'paperlab'
import { Live } from './Live'
import { Snippet } from './Snippet'
import { Presets } from './sections/Presets'
import { Behaviors } from './sections/Behaviors'
import { Deformers } from './sections/Deformers'
import { Physics } from './sections/Physics'
import { Surfaces } from './sections/Surfaces'
import { Stocks } from './sections/Stocks'
import { Layouts } from './sections/Layouts'
import { Stages } from './sections/Stages'

const SECTIONS = [
  ['start', 'Start'],
  ['presets', 'Presets'],
  ['behaviors', 'Behaviors'],
  ['deformers', 'Deformers'],
  ['physics', 'Physics'],
  ['surfaces', 'Surface'],
  ['stocks', 'Stocks'],
  ['layouts', 'Layouts'],
  ['stages', 'Stages'],
  ['pitfalls', 'Pitfalls'],
] as const

export function App() {
  const active = useScrollSpy(SECTIONS.map(([id]) => id))

  return (
    <div className="app">
      <nav className="rail">
        <a className="brand" href="#start">
          Paperlab
          <span>reference</span>
        </a>
        <ul>
          {SECTIONS.map(([id, label]) => (
            <li key={id}>
              <a href={`#${id}`} className={active === id ? 'active' : ''}>
                {label}
              </a>
            </li>
          ))}
        </ul>
        <div className="rail-links">
          <a href="../">Playground</a>
          <a href="../editor/">Editor</a>
          <a href="https://github.com/NourMtir0722/Paperlab">GitHub</a>
        </div>
      </nav>

      <main>
        <Start />
        <Presets />
        <Behaviors />
        <Deformers />
        <Physics />
        <Surfaces />
        <Stocks />
        <Layouts />
        <Stages />
        <Pitfalls />
        <footer>
          <p>
            Everything on this page is rendered by the same build of the library it documents, and the
            catalogues are read from its registries — so if it is listed here, it exists.
          </p>
        </footer>
      </main>
    </div>
  )
}

function Start() {
  return (
    <section id="start">
      <h1>Physical paper, as a React component.</h1>
      <p className="lede">
        A sheet is real 3D geometry, not a CSS trick and not a video. Content is a texture on a mesh that
        genuinely bends, so text and images curl with perfect continuity. This page is the human reference:
        every preset, behavior, stock, surface effect, layout and stage the library ships, rendering live,
        with the code for each.
      </p>

      <div className="start-split">
        <div>
          <Snippet code={`npm i paperlab three @react-three/fiber gsap`} lang="sh" />
          <p className="note">React ≥ 19, three ≥ 0.160. Types ship with the package.</p>
          <Snippet
            code={`import { Paper } from 'paperlab'

export function Hero() {
  return (
    <div style={{ height: 480 }}>   {/* the parent needs a height */}
      <Paper preset="receipt-unroll" autoplay />
    </div>
  )
}`}
          />
        </div>
        <Live idle="receipt-unroll" height={380}>
          <Paper preset="receipt-unroll" autoplay />
        </Live>
      </div>

      <h3>Three modes, one schema</h3>
      <div className="modes">
        <div>
          <h4>
            <code>&lt;Paper&gt;</code>
          </h4>
          <p>
            One sheet. Owns its own canvas and fills its parent. <code>&lt;PaperMesh&gt;</code> is the
            canvas-less twin for a scene you already have.
          </p>
        </div>
        <div>
          <h4>
            <code>&lt;PaperField&gt;</code>
          </h4>
          <p>
            Many sheets in a single instanced draw call, arranged by a layout. The deformers run as GLSL twins
            of the same math.
          </p>
        </div>
        <div>
          <h4>
            <code>&lt;PaperStage&gt;</code>
          </h4>
          <p>
            Paper as architecture — banners along a walk you move through. Bind it to scroll and the page
            walks the space.
          </p>
        </div>
      </div>

      <p className="note">
        Every one of them is configured by the same zod schema, and any paper serializes to a{' '}
        <code>.paper</code> JSON object. That is the rule the project is built on: if a feature cannot
        serialize into a preset, it does not ship.
      </p>
    </section>
  )
}

function Pitfalls() {
  return (
    <section id="pitfalls">
      <h2>Pitfalls</h2>
      <p className="lede">Check these before debugging anything else.</p>
      <ol className="pitfalls">
        <li>
          <strong>Blank canvas</strong> — the parent container has no height. <code>&lt;Paper&gt;</code> fills
          its parent, and a parent of zero height gives you a canvas of zero height. This is the classic React
          Three Fiber bug and it is almost always this.
        </li>
        <li>
          <strong>Text missing on the first frame</strong> — fonts load asynchronously. Paperlab waits for{' '}
          <code>document.fonts.ready</code> internally, so give it a beat before you screenshot it.
        </li>
        <li>
          <strong>A zod error on cloth</strong> — <code>physics: 'cloth'</code> and <code>behavior</code>{' '}
          together are rejected by design. Cloth owns the vertices; pick one.
        </li>
        <li>
          <strong>Nothing moves</strong> — the visitor may have <code>prefers-reduced-motion: reduce</code>{' '}
          set, which freezes behaviors at their configured pose and disables physics and entrances. That is
          correct behaviour. Override per instance with <code>reducedMotion=&#123;false&#125;</code> only when
          you have a real reason.
        </li>
        <li>
          <strong>No WebGL</strong> — a flat DOM fallback renders automatically. Don't build your own. There
          is also a hidden DOM mirror of the content on every paper, which makes a cheap assertion target in
          end-to-end tests.
        </li>
      </ol>
      <p className="note">
        Not sure the thing you configured is the thing you meant? <code>describeConfig(config)</code> returns
        the one-line visual you should be looking at.
      </p>
    </section>
  )
}

/** Highlights the section you're reading. Cheap: one observer, no scroll handler. */
function useScrollSpy(ids: readonly string[]): string {
  const [active, setActive] = useState(ids[0] ?? '')
  useEffect(() => {
    const seen = new Map<string, number>()
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) seen.set(entry.target.id, entry.intersectionRatio)
        let best = ''
        let bestRatio = 0
        for (const [id, ratio] of seen) {
          if (ratio > bestRatio) {
            best = id
            bestRatio = ratio
          }
        }
        if (best) setActive(best)
      },
      { threshold: [0, 0.1, 0.25, 0.5] },
    )
    for (const id of ids) {
      const el = document.getElementById(id)
      if (el) observer.observe(el)
    }
    return () => observer.disconnect()
  }, [ids])
  return active
}
