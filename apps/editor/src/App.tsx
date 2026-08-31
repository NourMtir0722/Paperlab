import { useEffect, useRef } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Stats } from '@react-three/drei'
import {
  PaperFieldMesh,
  PaperBackdrop,
  PaperLighting,
  PaperMesh,
  diffConfig,
  getPreset,
  sceneSchema,
  isBuiltinPreset,
  listPresets,
  resolveStateConfig,
  type ContentConfigInput,
  type FieldExportInput,
  type PaperConfig,
  type PaperHandle,
} from 'paperlab'
import {
  PaperStageScene,
  getStagePreset,
  getWalk,
  listStagePresets,
  type StageExportInput,
} from 'paperlab/stage'
import { Inspector } from './panels/Inspector'
import { FieldInspector } from './panels/FieldInspector'
import { StageInspector } from './panels/StageInspector'
import { StatesBar } from './panels/StatesBar'
import { Transport } from './chrome/Transport'
import { ExportMenu } from './panels/ExportMenu'
import { PresetPanel } from './panels/PresetPanel'
import { ViewportGuide } from './chrome/ViewportGuide'
import { CoachMark, HandleAnchor, coachMarkUsed } from './chrome/CoachMark'
import { CameraRig, ViewCluster } from './chrome/ViewCluster'
import { CaptureRig, type CaptureHandle } from './chrome/CaptureRig'
import { SmallScreen } from './chrome/SmallScreen'
import { captureThumbnail, downloadPreset } from './state/userPresets'
import { MAX_SHARE_LENGTH, SHARE_PARAM, paperShareUrl, readPaperShare } from './state/paperShare'
import { DEMO_CARDS } from './state/demoAssets'
import { UIHost, confirmDialog, promptDialog, toast } from './controls/ui'
import { reportSave } from './chrome/saveReport'
import { useEditor, zoneToConfig } from './state/store'
import { Select } from './controls/Select'
import { useHistory, useHistoryKeys, useUndoState } from './state/history'

/**
 * How many drops are actually hanging.
 *
 * Pictures go one per banner, so a stage hanging four of them IS four
 * banners however high the count slider was left — and a status line
 * reporting eighteen is naming a number nothing on screen agrees with.
 */
function stageBannerCount(stage: { source: string; images: string[]; count: number }): number {
  return stage.source === 'images' && stage.images.length > 0 ? stage.images.length : stage.count
}

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

/**
 * What a field slot falls back to when the preset it names is gone. The same
 * built-in `deletePreset` and the session sanitizer already fall back to, so
 * a missing preset lands in one place however it went missing.
 */
const FALLBACK_PRESET = 'photo-print'

/** `?stats` turns the frame counter on — see where it's rendered. */
const showStats = import.meta.env.DEV && new URLSearchParams(window.location.search).has('stats')

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
  const captureRef = useRef<CaptureHandle | null>(null)
  const editingState = useEditor((s) => s.editingState)
  const statePreview = useEditor((s) => s.statePreview)
  const selectedSlot = useEditor((s) => s.selectedSlot)
  const setSelectedSlot = useEditor((s) => s.setSelectedSlot)

  const paperRef = useRef<PaperHandle>(null)
  const scrubRef = useRef<HTMLInputElement>(null)
  const { canUndo, canRedo, undoLabel, redoLabel } = useUndoState()
  useHistoryKeys()

  // A paper on the URL is adopted once, on arrival, and then the parameter
  // is cleared: it is now a preset in your library, and leaving the link in
  // the address bar would re-import a second copy on every refresh.
  const adopted = useRef(false)
  useEffect(() => {
    if (adopted.current) return
    adopted.current = true
    const share = readPaperShare(window.location.search)
    if (!share) return
    const outcome = importSharedPaper(share)
    const url = new URL(window.location.href)
    url.searchParams.delete(SHARE_PARAM)
    window.history.replaceState(null, '', url)
    if (!outcome.ok) {
      toast(outcome.error, 'error')
      return
    }
    // A link outranks the remembered session: someone who was last in stage
    // mode has to be shown the paper they just opened, not told about it.
    setMode('paper')
    // An opened link that could not be stored is still worth warning about —
    // it is someone else's paper, and losing it means going back for the URL.
    if (outcome.storage === 'stored') {
      toast(`Opened "${outcome.name}" — it's yours to edit now`, 'success')
    } else {
      reportSave(outcome)
    }
  }, [importSharedPaper, setMode])

  // Presets are components: the field renders the live edit of its preset.
  // `getPreset` THROWS on a name it does not know, and this runs for every
  // field slot on every render — so one stale slot name (a preset deleted in
  // another tab, a session written by a build that had it) would take the
  // whole editor down rather than one paper. Fall back to a built-in: a
  // wrong-looking sheet is a bug report, a blank page is not.
  const resolvePresetByName = (name: string): PaperConfig => {
    if (name === presetName) return config
    try {
      return getPreset(name)
    } catch {
      return getPreset(FALLBACK_PRESET)
    }
  }
  // Every slot gets a DIFFERENT card, so fourteen sheets read as a drawer of
  // records rather than as one card printed fourteen times.
  const slotContent = (i: number): ContentConfigInput =>
    DEMO_CARDS[i % DEMO_CARDS.length] ?? { type: 'blank' }
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
  const fieldScene = sceneSchema.parse(field.scene)

  const fieldExportInput = (): FieldExportInput => ({
    scene: field.scene,
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
    text: stage.source === 'words' && stage.text.trim() ? stage.text : undefined,
    images: stage.source === 'images' && stage.images.length > 0 ? stage.images : undefined,
    // Pictures are one per drop, so they ARE the count — exporting the
    // slider's number alongside them would contradict the array.
    count: stage.source === 'images' && stage.images.length > 0 ? undefined : stage.count,
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
        <div className="history">
          <button
            type="button"
            disabled={!canUndo}
            aria-label={canUndo ? `Undo ${undoLabel}` : 'Undo'}
            title={canUndo ? `Undo ${undoLabel} (⌘Z)` : 'Nothing to undo'}
            onClick={() => useHistory.getState().undo()}
          >
            ↺
          </button>
          <button
            type="button"
            disabled={!canRedo}
            aria-label={canRedo ? `Redo ${redoLabel}` : 'Redo'}
            title={canRedo ? `Redo ${redoLabel} (⇧⌘Z)` : 'Nothing to redo'}
            onClick={() => useHistory.getState().redo()}
          >
            ↻
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
                reportSave(savePreset(name, snapshot, captureThumbnail()))
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
              const attempt = paperShareUrl(window.location.href, snapshot.meta.name, snapshot)
              if (!attempt.ok) {
                // The `.paper` file is the answer to both refusals, and it is
                // offered here rather than described: telling someone whose
                // share just failed to go and save a preset, find it in the
                // left panel and download it is three steps and two panels
                // away from the button they actually pressed.
                void confirmDialog({
                  title: 'Too big for a link',
                  message:
                    attempt.reason === 'uploaded-image'
                      ? 'This paper carries an uploaded image. A picture cannot travel in a URL, but the .paper file carries it — download that and send it instead.'
                      : `This paper needs about ${Math.round(attempt.length / 1000)}KB and a link holds ${Math.round(MAX_SHARE_LENGTH / 1000)}KB. Shorten the text, or download the .paper file and send that instead.`,
                  confirmLabel: 'Download .paper',
                }).then((ok) => {
                  if (ok) downloadPreset(snapshot.meta.name, diffConfig(snapshot))
                })
                return
              }
              void navigator.clipboard.writeText(attempt.url)
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
          captureRef={captureRef}
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
                  <Select
                    className="slot-preset"
                    label={`Paper ${i + 1} preset`}
                    value={name}
                    options={listPresets()}
                    onChange={(next) => setSlotPreset(i, next)}
                  />
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
          {/* The room's ground. Pure grey on purpose: a cool or warm cast
              here shifts the perceived colour of the paper sitting in front
              of it — see `docs/design.md`, amendment 2. */}
          <color attach="background" args={[mode === 'stage' ? '#0b0b0b' : '#171717']} />
          {/* The editor owns this canvas, so it renders the backdrop itself —
              the same way it renders the lighting rig. Stage has a whole
              room of its own and would be arguing with one. */}
          {mode !== 'stage' && (
            <PaperBackdrop backdrop={mode === 'paper' ? config.scene.backdrop : fieldScene.backdrop} />
          )}
          {/* Stage brings its own rig — a second one here would double the key. */}
          {mode !== 'stage' && (
            <PaperLighting
              // Field mode used to inherit slot 0's preset, so swapping one
              // card changed the lighting of the whole gallery. It has its
              // own scene now, the same one the export carries.
              preset={mode === 'paper' ? config.scene.lighting : fieldScene.lighting}
              light={mode === 'paper' ? config.scene.light : fieldScene.light}
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
              // Words or pictures, never both: the scene resolves them in a
              // fixed order, so passing both means one silently does nothing.
              text={stage.source === 'words' && stage.text.trim() ? stage.text : undefined}
              images={stage.source === 'images' && stage.images.length > 0 ? stage.images : undefined}
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
              onBehaviorChange={(patch) => {
                coachMarkUsed()
                patchConfig({ behavior: patch as never }, { external: true })
              }}
              onCrease={(creases) => {
                // A crease is a property of the PAPER, never of one interaction
                // state: recorded while a state is being edited it would land in
                // that state's override diff, and the letter would arrive
                // creased only on hover. The sheet keeps showing them either
                // way — this is persistence, and the base config is the only
                // place they can honestly persist to.
                if (useEditor.getState().editingState) return
                // Not `external`: this fires repeatedly as the fold closes, and
                // an inspector remount per frame of a fold would collapse the
                // folder someone is reading. The panel derives its rows from
                // the config on every render, so it follows along anyway.
                patchConfig({ memory: { creases } as never })
              }}
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
          <CaptureRig handleRef={captureRef} />
          {mode === 'paper' && <HandleAnchor paperRef={paperRef} />}
          {/* Stage walks its own camera; the other two modes orbit, and the
              cluster below the canvas is how anyone finds that out. */}
          {mode !== 'stage' && (
            <CameraRig
              home={mode === 'paper' ? [0, 0.35, 2.9] : [0, 0.9, 6.4]}
              radius={mode === 'paper' ? 2.9 : 6.4}
            />
          )}
          {mode !== 'stage' && <OrbitControls makeDefault enableDamping />}
          {/* The FPS badge is a diagnostic, not furniture: it sits over the
              canvas in every screenshot and every recording, and it is the
              first thing that says "someone's dev build" to a visitor. Dev
              still gets it on `?stats`, which is where a frame budget is
              actually being read. */}
          {showStats && <Stats className="stats" />}
        </Canvas>
        {mode === 'paper' && <CoachMark />}
        {mode === 'paper' && <ViewportGuide />}
        {mode !== 'stage' && <ViewCluster key={`cluster:${mode}`} />}
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
            · {stageBannerCount(stage)} banners · quality{' '}
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
      <SmallScreen />
    </div>
  )
}
