import { useRef } from 'react'
import { Canvas } from '@react-three/fiber'
import { ContactShadows, OrbitControls, Stats } from '@react-three/drei'
import { PaperMesh, listPresets, serializePreset, type PaperHandle } from 'paperlab'
import { Inspector } from './Inspector'
import { Transport } from './Transport'
import { useEditor } from './store'

export function App() {
  const presetName = useEditor((s) => s.presetName)
  const config = useEditor((s) => s.config)
  const inspectorEpoch = useEditor((s) => s.inspectorEpoch)
  const setPreset = useEditor((s) => s.setPreset)
  const patchConfig = useEditor((s) => s.patchConfig)

  const paperRef = useRef<PaperHandle>(null)
  const scrubRef = useRef<HTMLInputElement>(null)

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">Paperlab</div>
        <div className="filename">{config.meta.name}.paper</div>
        <div className="mode-switch">
          <button className="active">Paper</button>
          <button disabled title="Field Composer arrives in M4">
            Field
          </button>
        </div>
        <div className="spacer" />
        <button
          className="export"
          onClick={() => {
            const snapshot = paperRef.current?.snapshot()
            navigator.clipboard.writeText(serializePreset(snapshot ?? config))
          }}
          title="Copies the .paper JSON for now — Copy for AI lands in M5"
        >
          Export code
        </button>
      </header>

      <aside className="left">
        <h2>Presets</h2>
        <ul className="presets">
          {listPresets().map((name) => (
            <li key={name}>
              <button className={name === presetName ? 'active' : ''} onClick={() => setPreset(name)}>
                {name}
              </button>
            </li>
          ))}
        </ul>
        <h2>Layers</h2>
        <ul className="layers">
          <li>Sheet</li>
          <li>Content</li>
          <li>Behavior</li>
          <li className="dim">Physics — M3</li>
        </ul>
      </aside>

      <main className="viewport">
        <Canvas shadows camera={{ position: [0, 0.35, 2.9], fov: 40 }} dpr={[1, 2]}>
          <color attach="background" args={['#17181b']} />
          <ambientLight intensity={0.65} />
          <directionalLight
            position={[2.5, 4, 3]}
            intensity={1.6}
            castShadow
            shadow-mapSize={[1024, 1024]}
            shadow-normalBias={0.05}
          />
          <PaperMesh
            key={presetName}
            ref={paperRef}
            preset={config}
            interactive
            autoplay
            onProgress={(v) => {
              if (scrubRef.current) scrubRef.current.value = String(v)
            }}
            onBehaviorChange={(patch) => patchConfig({ behavior: patch as never }, { external: true })}
          />
          <ContactShadows position={[0, -1.5, 0]} opacity={0.3} scale={10} blur={2.4} far={3} />
          <OrbitControls makeDefault enableDamping />
          <Stats className="stats" />
        </Canvas>
      </main>

      <aside className="right">
        <Inspector key={`${presetName}:${config.behavior?.type ?? 'none'}:${inspectorEpoch}`} />
      </aside>

      <Transport paperRef={paperRef} scrubRef={scrubRef} resetKey={presetName} />
    </div>
  )
}
