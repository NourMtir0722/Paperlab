import { useRef } from 'react'
import { Canvas } from '@react-three/fiber'
import { ContactShadows, OrbitControls, Stats } from '@react-three/drei'
import { PaperFieldMesh, PaperMesh, getPreset, listPresets, type PaperHandle } from 'paperlab'
import { Inspector } from './Inspector'
import { FieldInspector } from './FieldInspector'
import { Transport } from './Transport'
import { ExportMenu } from './ExportMenu'
import { useEditor } from './store'

/** Demo pool for the Field Composer; the count slider cycles through them. */
const FIELD_IMAGES = [
  'https://images.unsplash.com/photo-1501854140801-50d01698950b?w=800&q=80',
  'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=800&q=80',
  'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=800&q=80',
  'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800&q=80',
  'https://images.unsplash.com/photo-1519681393784-d120267933ba?w=800&q=80',
  'https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=800&q=80',
  'https://images.unsplash.com/photo-1447752875215-b2761acb3c5d?w=800&q=80',
  'https://images.unsplash.com/photo-1433086966358-54859d0ed716?w=800&q=80',
]

export function App() {
  const presetName = useEditor((s) => s.presetName)
  const config = useEditor((s) => s.config)
  const inspectorEpoch = useEditor((s) => s.inspectorEpoch)
  const mode = useEditor((s) => s.mode)
  const field = useEditor((s) => s.field)
  const cameFromField = useEditor((s) => s.cameFromField)
  const setPreset = useEditor((s) => s.setPreset)
  const patchConfig = useEditor((s) => s.patchConfig)
  const setMode = useEditor((s) => s.setMode)
  const editFieldPaper = useEditor((s) => s.editFieldPaper)
  const backToField = useEditor((s) => s.backToField)

  const paperRef = useRef<PaperHandle>(null)
  const scrubRef = useRef<HTMLInputElement>(null)

  // Presets are components: the field renders the live edit of its preset.
  const fieldPresetConfig =
    presetName === field.presetName ? config : getPreset(field.presetName)
  const fieldImages = Array.from(
    { length: field.count },
    (_, i) => FIELD_IMAGES[i % FIELD_IMAGES.length]!,
  )

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">Paperlab</div>
        <div className="filename">
          {mode === 'paper' ? `${config.meta.name}.paper` : 'Field composer'}
        </div>
        <div className="mode-switch">
          <button className={mode === 'paper' ? 'active' : ''} onClick={() => setMode('paper')}>
            Paper
          </button>
          <button className={mode === 'field' ? 'active' : ''} onClick={() => setMode('field')}>
            Field
          </button>
        </div>
        {cameFromField && mode === 'paper' && (
          <button className="back-to-field" onClick={backToField}>
            ← Back to field
          </button>
        )}
        <div className="spacer" />
        <ExportMenu config={config} paperRef={paperRef} />
      </header>

      <aside className="left">
        {mode === 'paper' ? (
          <>
            <h2>Presets</h2>
            <ul className="presets">
              {listPresets().map((name) => (
                <li key={name}>
                  <button
                    className={name === presetName ? 'active' : ''}
                    onClick={() => setPreset(name)}
                  >
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
              <li>Physics</li>
            </ul>
          </>
        ) : (
          <>
            <h2>Papers</h2>
            <ul className="presets">
              <li>
                <button className="active" onClick={editFieldPaper}>
                  {field.presetName} — edit paper →
                </button>
              </li>
              {fieldImages.map((_, i) => (
                <li key={i}>
                  <button className="paper-item">Paper {i + 1}</button>
                </li>
              ))}
            </ul>
          </>
        )}
      </aside>

      <main className="viewport">
        <Canvas
          key={mode}
          shadows
          camera={
            mode === 'paper'
              ? { position: [0, 0.35, 2.9], fov: 40 }
              : { position: [0, 0.9, 6.4], fov: 45 }
          }
          dpr={[1, 2]}
        >
          <color attach="background" args={['#17181b']} />
          <ambientLight intensity={0.65} />
          <directionalLight
            position={[2.5, 4, 3]}
            intensity={1.6}
            castShadow
            shadow-mapSize={[1024, 1024]}
            shadow-normalBias={0.05}
          />
          {mode === 'paper' ? (
            <>
              <PaperMesh
                key={presetName}
                ref={paperRef}
                preset={config}
                interactive
                autoplay
                onProgress={(v) => {
                  if (scrubRef.current) scrubRef.current.value = String(v)
                }}
                onBehaviorChange={(patch) =>
                  patchConfig({ behavior: patch as never }, { external: true })
                }
              />
              <ContactShadows position={[0, -1.5, 0]} opacity={0.3} scale={10} blur={2.4} far={3} />
            </>
          ) : (
            <PaperFieldMesh
              key={`${field.layout}:${field.count}:${field.presetName}:${field.entrance}`}
              images={fieldImages}
              preset={fieldPresetConfig}
              layout={field.layout}
              layoutOptions={field.layoutOptions}
              motion={{ driver: field.driver, speed: field.speed }}
              entrance={{ type: field.entrance }}
            />
          )}
          <OrbitControls makeDefault enableDamping />
          <Stats className="stats" />
        </Canvas>
      </main>

      <aside className="right">
        {mode === 'paper' ? (
          <Inspector key={`${presetName}:${config.behavior?.type ?? 'none'}:${inspectorEpoch}`} />
        ) : (
          <FieldInspector key={`field:${field.layout}:${inspectorEpoch}`} />
        )}
      </aside>

      {mode === 'paper' ? (
        <Transport paperRef={paperRef} scrubRef={scrubRef} resetKey={presetName} />
      ) : (
        <footer className="transport">
          <span className="transport-hint">
            field mode — {field.count} papers, one draw call · GPU deformers
          </span>
        </footer>
      )}
    </div>
  )
}
