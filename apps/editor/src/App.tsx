import { useRef } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Stats } from '@react-three/drei'
import {
  PaperFieldMesh,
  PaperLighting,
  PaperMesh,
  getPreset,
  listPresets,
  resolveStateConfig,
  type ContentConfig,
  type FieldExportInput,
  type PaperConfig,
  type PaperHandle,
} from 'paperlab'
import { Inspector } from './Inspector'
import { FieldInspector } from './FieldInspector'
import { StatesBar } from './StatesBar'
import { Transport } from './Transport'
import { ExportMenu } from './ExportMenu'
import { PresetPanel } from './PresetPanel'
import { captureThumbnail } from './userPresets'
import { useEditor, zoneToConfig } from './store'

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
  const setSlotPreset = useEditor((s) => s.setSlotPreset)
  const editFieldPaper = useEditor((s) => s.editFieldPaper)
  const backToField = useEditor((s) => s.backToField)
  const savePreset = useEditor((s) => s.savePreset)
  const editingState = useEditor((s) => s.editingState)
  const statePreview = useEditor((s) => s.statePreview)
  const selectedSlot = useEditor((s) => s.selectedSlot)
  const setSelectedSlot = useEditor((s) => s.setSelectedSlot)

  const paperRef = useRef<PaperHandle>(null)
  const scrubRef = useRef<HTMLInputElement>(null)

  // Presets are components: the field renders the live edit of its preset.
  const resolvePresetByName = (name: string): PaperConfig =>
    name === presetName ? config : getPreset(name)
  const slotContent = (i: number): ContentConfig => ({
    type: 'image',
    src: FIELD_IMAGES[i % FIELD_IMAGES.length]!,
    fit: 'cover',
  })
  const fieldPapers = field.slots.map((name, i) => {
    const preset = resolvePresetByName(name)
    return {
      preset,
      // Image slots pull from the demo pool; typed content keeps its preset's.
      // Stamp sheets keep the preset's own art — the demo pool would break register.
      ...(field.layout !== 'sheet' &&
      (preset.content.type === 'image' || preset.content.type === 'blank')
        ? { content: slotContent(i) }
        : {}),
      // Slot-layer state overrides (the component/instance model).
      ...(field.slotStates[i] ? { states: field.slotStates[i] } : {}),
    }
  })
  const fieldZones = field.zones.map(zoneToConfig)
  const fieldExportInput = (): FieldExportInput => ({
    layout: field.layout,
    layoutOptions: field.layoutOptions,
    motion: { driver: field.driver, speed: field.speed },
    entrance: { type: field.entrance },
    papers: field.slots.map((name, i) => ({
      presetName: name,
      preset: resolvePresetByName(name),
      content: fieldPapers[i]!.content,
      states: field.slotStates[i],
    })),
    zones: fieldZones,
  })

  // State-editing mode shows the state applied; preview runs the live machine.
  const paperCanvasConfig =
    editingState && !statePreview ? resolveStateConfig(config, editingState) : config

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
        {mode === 'paper' && (
          <button
            className="save-preset"
            onClick={() => {
              const name = prompt('Save preset as', config.meta.name === 'untitled' ? '' : config.meta.name)
              if (!name) return
              const snapshot = paperRef.current?.snapshot() ?? config
              const error = savePreset(name, snapshot, captureThumbnail())
              if (error) alert(error)
            }}
          >
            Save preset
          </button>
        )}
        <ExportMenu mode={mode} config={config} paperRef={paperRef} fieldInput={fieldExportInput} />
      </header>

      <aside className="left">
        {mode === 'paper' ? (
          <>
            <PresetPanel />
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
            <ul className="slots">
              {field.slots.map((name, i) => (
                <li
                  key={i}
                  className={`slot-row${selectedSlot === i ? ' selected' : ''}`}
                  onClick={() => setSelectedSlot(selectedSlot === i ? null : i)}
                >
                  <span className="slot-index">{i + 1}</span>
                  <select
                    value={name}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setSlotPreset(i, e.target.value)}
                  >
                    {listPresets().map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                  <button
                    className="slot-edit"
                    title={`Edit ${name}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      editFieldPaper(name)
                    }}
                  >
                    ✎
                  </button>
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
          gl={{ preserveDrawingBuffer: true }}
        >
          <color attach="background" args={['#17181b']} />
          <PaperLighting
            preset={
              mode === 'paper'
                ? config.scene.lighting
                : resolvePresetByName(field.slots[0] ?? 'photo-print').scene.lighting
            }
            floor={mode === 'paper' ? -1.5 : -2.4}
            scale={mode === 'paper' ? 10 : 14}
          />
          {mode === 'paper' ? (
            <>
              <PaperMesh
                key={`${presetName}:${editingState ?? 'base'}:${statePreview}`}
                ref={paperRef}
                preset={paperCanvasConfig}
                interactive
                autoplay={!statePreview}
                stateTriggers={statePreview}
                onProgress={(v) => {
                  if (scrubRef.current) scrubRef.current.value = String(v)
                }}
                onBehaviorChange={(patch) =>
                  patchConfig({ behavior: patch as never }, { external: true })
                }
              />
            </>
          ) : (
            <PaperFieldMesh
              key={`${field.layout}:${field.count}:${field.slots.join(',')}:${field.entrance}`}
              papers={fieldPapers}
              layout={field.layout}
              layoutOptions={field.layoutOptions}
              motion={{ driver: field.driver, speed: field.speed }}
              entrance={{ type: field.entrance }}
              zones={fieldZones}
            />
          )}
          <OrbitControls makeDefault enableDamping />
          <Stats className="stats" />
        </Canvas>
      </main>

      <aside className="right">
        <StatesBar />
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
