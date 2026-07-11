import { Canvas } from '@react-three/fiber'
import { ContactShadows, OrbitControls, Stats } from '@react-three/drei'
import { Leva } from 'leva'
import { PaperMesh, listPresets, serializePreset } from 'paperlab'
import { Inspector } from './Inspector'
import { useEditor } from './store'

export function App() {
  const presetName = useEditor((s) => s.presetName)
  const config = useEditor((s) => s.config)
  const setPreset = useEditor((s) => s.setPreset)

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
          onClick={() => navigator.clipboard.writeText(serializePreset(config))}
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
          <li className="dim">Behavior — M1</li>
          <li className="dim">Physics — M3</li>
        </ul>
      </aside>

      <main className="viewport">
        <Canvas shadows camera={{ position: [0, 0.35, 2.6], fov: 40 }} dpr={[1, 2]}>
          <color attach="background" args={['#17181b']} />
          <ambientLight intensity={0.65} />
          <directionalLight
            position={[2.5, 4, 3]}
            intensity={1.6}
            castShadow
            shadow-mapSize={[1024, 1024]}
          />
          <PaperMesh
            key={presetName}
            preset={config}
            sheet={config.sheet}
            stock={config.stock}
            content={config.content}
          />
          <ContactShadows position={[0, -1.05, 0]} opacity={0.3} scale={8} blur={2.4} far={3} />
          <OrbitControls makeDefault enableDamping />
          <Stats className="stats" />
        </Canvas>
      </main>

      <aside className="right">
        <Inspector key={presetName} />
        <Leva fill flat titleBar={false} />
      </aside>
    </div>
  )
}
