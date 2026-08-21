import { useEffect, useRef } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Stats } from '@react-three/drei'
import {
  PaperFieldMesh,
  PaperLighting,
  PaperMesh,
  PaperStageScene,
  getStagePreset,
  getWalk,
  listStagePresets,
  getPreset,
  isBuiltinPreset,
  listPresets,
  resolveStateConfig,
  type ContentConfig,
  type FieldExportInput,
  type PaperConfig,
  type PaperHandle,
  type StageExportInput,
} from 'paperlab'
import { Inspector } from './Inspector'
import { FieldInspector } from './FieldInspector'
import { StageInspector } from './StageInspector'
import { StatesBar } from './StatesBar'
import { Transport } from './Transport'
import { ExportMenu } from './ExportMenu'
import { PresetPanel } from './PresetPanel'
import { ViewportGuide } from './ViewportGuide'
import { captureThumbnail } from './userPresets'
import { SHARE_PARAM, paperShareUrl, readPaperShare } from './paperShare'
import { DEMO_IMAGES } from './demoAssets'
import { UIHost, promptDialog, toast } from './ui'
import { useEditor, zoneToConfig } from './store'

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

export function App() {
  const presetName = useEditor((s) => s.presetName)
  const importSharedPaper = useEditor((s) => s.importSharedPaper)
  const config = useEditor((s) => s.config)
  const inspectorEpoch = useEditor((s) => s.inspectorEpoch)
  const mode = useEditor((s) => s.mode)
  const field = useEditor((s) => s.field)
  const stage = useEditor((s) => s.stage)
  const patchStage = useEditor((s) => s.patchStage)
  const loadStagePreset = useEditor((s) => s.loadStagePreset)
  const cameFromField = useEditor((s) => s.cameFromField)
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

  // A paper on the URL is adopted once, on arrival, and then the parameter
  // is cleared: it is now a preset in your library, and leaving the link in
  // the address bar would re-import a second copy on every refresh.
  const adopted = useRef(false)
  useEffect(() => {
    if (adopted.current) return
    adopted.current = true
    const share = readPaperShare(window.location.search)
    if (!share) return
    const error = importSharedPaper(share)
    const url = new URL(window.location.href)
    url.searchParams.delete(SHARE_PARAM)
    window.history.replaceState(null, '', url)
    if (error) {
      toast(error, 'error')
      return
    }
    // A link outranks the remembered session: someone who was last in stage
    // mode has to be shown the paper they just opened, not told about it.
    setMode('paper')
    toast(`Opened "${share.name}" — it's yours to edit now`, 'success')
  }, [importSharedPaper, setMode])

  // Presets are components: the field renders the live edit of its preset.
  const resolvePresetByName = (name: string): PaperConfig => (name === presetName ? config : getPreset(name))
  const slotContent = (i: number): ContentConfig =>
    DEMO_IMAGES.length === 0
      ? { type: 'blank' }
      : { type: 'image', src: DEMO_IMAGES[i % DEMO_IMAGES.length]!, fit: 'cover' }
  const fieldPapers = field.slots.map((name, i) => {
    const preset = resolvePresetByName(name)
    return {
      preset,
      // Image slots pull from the demo pool; typed content keeps its preset's.
      // Stamp sheets keep the preset's own art — the demo pool would break register.
      ...(field.layout !== 'sheet' && (preset.content.type === 'image' || preset.content.type === 'blank')
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
      // NB: the demo image pool (slotContent) is a PREVIEW-only fill — never
      // exported. Each slot's real content already lives inside its preset, so
      // exports carry the preset's own art, not the editor's stock photos.
      states: field.slotStates[i],
    })),
    zones: fieldZones,
  })

  const stageExportInput = (): StageExportInput => ({
    stage: { ...stage.config, path: getWalk(stage.walk) },
    layout: stage.layout,
    layoutOptions: stage.layoutOptions,
    paper: stage.paper,
    text: stage.text.trim() ? stage.text : undefined,
    count: stage.count,
  })

  // State-editing mode shows the state applied; preview runs the live machine.
  const paperCanvasConfig = editingState && !statePreview ? resolveStateConfig(config, editingState) : config

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">Paperlab</div>
        <div className="filename">
          {mode === 'paper' ? `${config.meta.name}.paper` : mode === 'field' ? 'Field composer' : 'Stage'}
        </div>
        <div className="mode-switch">
          <button type="button" className={mode === 'paper' ? 'active' : ''} onClick={() => setMode('paper')}>
            Paper
          </button>
          <button type="button" className={mode === 'field' ? 'active' : ''} onClick={() => setMode('field')}>
            Field
          </button>
          <button type="button" className={mode === 'stage' ? 'active' : ''} onClick={() => setMode('stage')}>
            Stage
          </button>
        </div>
        {cameFromField && mode === 'paper' && (
          <button type="button" className="back-to-field" onClick={backToField}>
            ← Back to field
          </button>
        )}
        <div className="spacer" />
        {mode === 'paper' && (
          <button
            type="button"
            className="save-preset"
            onClick={() => {
              void (async () => {
                const name = await promptDialog({
                  title: 'Save preset as',
                  defaultValue: config.meta.name === 'untitled' ? '' : config.meta.name,
                  placeholder: 'preset name',
                  confirmLabel: 'Save',
                  validate: (v) =>
                    !v
                      ? 'Preset needs a name.'
                      : isBuiltinPreset(v)
                        ? `"${v}" is a built-in — pick another name.`
                        : null,
                })
                if (!name) return
                // While a state chip / preview is live the canvas paper holds a
                // derived view — saving from it would bake that state into the
                // base and lose the machine. The preset is the store's base.
                const snapshot =
                  editingState || statePreview ? config : (paperRef.current?.snapshot() ?? config)
                const error = savePreset(name, snapshot, captureThumbnail())
                if (error) toast(error, 'error')
                else toast(`Saved "${name}"`, 'success')
              })()
            }}
          >
            Save preset
          </button>
        )}
        {mode === 'paper' && (
          <button
            type="button"
            className="share-paper"
            title="Copy a link that opens this paper in someone else's editor"
            onClick={() => {
              // Share what is on the canvas, including an un-saved sculpt —
              // asking someone to save first before they can send a link is
              // a step that stops the thing from being sent at all.
              const snapshot =
                editingState || statePreview ? config : (paperRef.current?.snapshot() ?? config)
              const url = paperShareUrl(window.location.href, snapshot.meta.name, snapshot)
              if (!url) {
                toast(
                  'This paper carries an uploaded image, which is too big for a link. Download the .paper file and send that instead.',
                  'error',
                )
                return
              }
              void navigator.clipboard.writeText(url)
              toast('Link copied — anyone who opens it gets an editable copy', 'success')
            }}
          >
            Share
          </button>
        )}
        <ExportMenu
          mode={mode}
          config={config}
          paperRef={paperRef}
          fieldInput={fieldExportInput}
          stageInput={stageExportInput}
        />
      </header>

      <aside className="left">
        {mode === 'paper' ? (
          <PresetPanel />
        ) : mode === 'stage' ? (
          <>
            <h2>Stages</h2>
            <ul className="stage-presets">
              {listStagePresets().map((id) => {
                const preset = getStagePreset(id)
                return (
                  <li key={id}>
                    <button
                      type="button"
                      className={`stage-preset${stage.preset === id ? ' selected' : ''}`}
                      onClick={() => loadStagePreset(id)}
                    >
                      <strong>{preset.label}</strong>
                      <span>{preset.description}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
            <p className="stage-note">
              Type into <strong>Words</strong> and the space is rebuilt out of them — one column per banner,
              stacked down the drop.
            </p>
          </>
        ) : (
          <>
            <h2>Papers</h2>
            <ul className="slots">
              {field.slots.map((name, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: a slot IS its index — selection, edits and preset writes all address a paper by slot number.
                <li key={i} className={`slot-row${selectedSlot === i ? ' selected' : ''}`}>
                  <button
                    type="button"
                    className="slot-select"
                    aria-pressed={selectedSlot === i}
                    aria-label={`Select paper ${i + 1}`}
                    onClick={() => setSelectedSlot(selectedSlot === i ? null : i)}
                  >
                    <span className="slot-index">{i + 1}</span>
                  </button>
                  <select value={name} onChange={(e) => setSlotPreset(i, e.target.value)}>
                    {listPresets().map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="slot-edit"
                    title={`Edit ${name}`}
                    aria-label={`Edit ${name}`}
                    onClick={() => editFieldPaper(name)}
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
              : mode === 'stage'
                ? { position: [0, 1.7, 6], fov: 38, near: 0.05, far: 400 }
                : { position: [0, 0.9, 6.4], fov: 45 }
          }
          dpr={[1, 2]}
          gl={{ preserveDrawingBuffer: true }}
        >
          <color attach="background" args={[mode === 'stage' ? '#0c0a0b' : '#17181b']} />
          {/* Stage brings its own rig — a second one here would double the key. */}
          {mode !== 'stage' && (
            <PaperLighting
              preset={
                mode === 'paper'
                  ? config.scene.lighting
                  : resolvePresetByName(field.slots[0] ?? 'photo-print').scene.lighting
              }
              floor={mode === 'paper' ? -1.5 : -2.4}
              scale={mode === 'paper' ? 10 : 14}
            />
          )}
          {mode === 'stage' ? (
            <PaperStageScene
              key={`stage:${stage.preset}:${stage.walk}:${stage.layout}:${stage.count}`}
              stage={{
                ...stage.config,
                path: getWalk(stage.walk),
                figure: { ...stage.config.figure, model: FIGURE_MODEL },
              }}
              preset={stage.paper}
              layout={stage.layout}
              layoutOptions={stage.layoutOptions}
              text={stage.text.trim() ? stage.text : undefined}
              count={stage.count}
              // Playing hands the walk to the clock; paused, the scrubber owns it.
              progress={stage.playing ? undefined : stage.progress}
              quality={stage.quality}
              onQualityChange={(settled) => patchStage({ settled })}
            />
          ) : mode === 'paper' ? (
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
              onBehaviorChange={(patch) => patchConfig({ behavior: patch as never }, { external: true })}
            />
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
          {mode !== 'stage' && <OrbitControls makeDefault enableDamping />}
          {import.meta.env.DEV && <Stats className="stats" />}
        </Canvas>
        {mode === 'paper' && <ViewportGuide />}
      </main>

      <aside className="right">
        <StatesBar />
        {mode === 'paper' ? (
          <Inspector key={`${presetName}:${config.behavior?.type ?? 'none'}:${inspectorEpoch}`} />
        ) : mode === 'stage' ? (
          <StageInspector key={`stage:${stage.layout}:${inspectorEpoch}`} />
        ) : (
          <FieldInspector key={`field:${field.layout}:${inspectorEpoch}`} />
        )}
      </aside>

      {mode === 'paper' ? (
        <Transport paperRef={paperRef} scrubRef={scrubRef} resetKey={presetName} />
      ) : mode === 'stage' ? (
        <footer className="transport">
          <button type="button" className="play" onClick={() => patchStage({ playing: !stage.playing })}>
            {stage.playing ? '❚❚' : '▶'}
          </button>
          <input
            type="range"
            className="scrubber"
            min={0}
            max={1}
            step={0.001}
            value={stage.progress}
            // Touching it takes the walk, rather than being locked out until
            // you have found the pause button — the Paper tab's timeline has
            // always worked this way and there was no reason this one did not.
            onPointerDown={() => patchStage({ playing: false })}
            onChange={(e) => patchStage({ progress: Number(e.target.value), playing: false })}
            aria-label="Distance along the walk"
          />
          <span className="transport-hint">
            {stage.playing
              ? 'walking · drag the scene to walk it yourself'
              : `${Math.round(stage.progress * 100)}% along the walk`}{' '}
            · {stage.count} banners · quality{' '}
            {stage.quality === 'auto' ? `auto → ${stage.settled ?? '…'}` : stage.quality}
          </span>
        </footer>
      ) : (
        <footer className="transport">
          <span className="transport-hint">
            field mode — {field.count} papers, one draw call · GPU deformers
          </span>
        </footer>
      )}
      <UIHost />
    </div>
  )
}
