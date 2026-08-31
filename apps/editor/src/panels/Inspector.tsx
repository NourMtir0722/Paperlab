import {
  contentNames,
  contentSchemaFor,
  getBehavior,
  getStock,
  listBehaviors,
  maxStripLength,
  paperEdges,
  physicsNames,
  resolveStateConfig,
  stockNames,
  washSchema,
  type ClothConfig,
  type StripConfig,
  type ContentConfig,
  type ContentConfigInput,
  type PaperConfig,
  type PaperEdge,
  type PhysicsConfig,
  type StockName,
  type SurfaceConfig,
  type WashConfig,
} from 'paperlab'
import {
  button,
  folder,
  note,
  num,
  partitionSignature,
  schemaControls,
  select,
  text,
  toggle,
  type Control,
} from '../controls/controlModel'
import { Panel } from '../controls/controls'
import { useEditor } from '../state/store'
import { formatItems, parseItems } from './receiptItems'
import { pickImageAsDataUrl } from '../chrome/pickImage'
import { lightControls } from './lightControls'
import { memoryControls } from './memoryControls'
import { backdropControls } from './backdropControls'

/**
 * Inspector of the selection: a tree of `Control` descriptors rendered by the
 * app's own control set. Behavior fields are generated from the behavior's
 * zod schema, so a community behavior gets editor UI for free.
 *
 * Still remounted (keyed) when the preset or behavior type changes — the
 * folders' open/closed state should reset with the subject.
 */
export function Inspector() {
  const baseConfig = useEditor((s) => s.config)
  const editingState = useEditor((s) => s.editingState)
  // State-editing mode: controls show the state applied (base + overrides);
  // edits route back into that state's override diff via patchConfig.
  const config = editingState ? resolveStateConfig(baseConfig, editingState) : baseConfig
  const patchConfig = useEditor((s) => s.patchConfig)
  const setBehaviorType = useEditor((s) => s.setBehaviorType)
  const setSurface = useEditor((s) => s.setSurface)
  const setPhysics = useEditor((s) => s.setPhysics)
  const patchSim = useEditor((s) => s.patchSim)

  // The behavior's own nomination decides what gets the big controls; the
  // rest fold into "More". A behavior that nominates nothing comes back with
  // an empty `signature` and everything in `rest`, which is exactly the flat
  // panel this used to draw — so no behavior loses a control, and none of
  // them gets one hidden without saying so.
  const behavior = config.behavior ? getBehavior(config.behavior.type) : null
  const { signature: signatureFields, rest: moreFields } = behavior
    ? partitionSignature(
        behavior.optionsSchema,
        behavior.signature,
        config.behavior as unknown as Record<string, unknown>,
        (key, value) => patchConfig({ behavior: { [key]: value } as never }),
      )
    : { signature: [], rest: [] }

  const controls: Control[] = [
    // Behavior stays open (the primary sculpt); the rest collapse so the panel
    // reads as a summary you expand into, not a wall of controls.
    folder('Behavior', [
      select('type', config.behavior?.type ?? 'none', ['none', ...listBehaviors()], (v) =>
        setBehaviorType(v === 'none' ? null : v),
      ),
      ...signatureFields,
      // Only a real disclosure — a "More" that opens onto nothing is a
      // promise of depth the behavior does not have.
      ...(moreFields.length > 0 && signatureFields.length > 0
        ? [folder('More', moreFields, { collapsed: true, key: 'behavior-more' })]
        : moreFields),
    ]),
    folder(
      'Sheet',
      [
        num('width', config.sheet.width, { min: 0.2, max: 4, step: 0.05 }, (v) =>
          patchConfig({ sheet: { width: v } }),
        ),
        num('height', config.sheet.height, { min: 0.2, max: sheetHeightMax(config), step: 0.05 }, (v) =>
          patchConfig({ sheet: { height: v } }),
        ),
      ],
      { collapsed: true },
    ),
    folder(
      'Stock',
      [select('stock', config.stock, [...stockNames], (v) => patchConfig({ stock: v as StockName }))],
      { collapsed: true },
    ),
    folder('Content', contentControls(config.content, patchConfig), { collapsed: true }),
    folder('Surface', surfaceControls(config.surface, config.stock, setSurface), { collapsed: true }),
    // Between Surface and Physics on purpose: a crease is half a mark on the
    // paper and half a bend in it, so it belongs between the panel that draws
    // the paper and the panel that moves it.
    folder(
      'Memory',
      memoryControls(config.memory, config.stock, config.sheet, (patch) =>
        patchConfig({ memory: patch as never }),
      ),
      { collapsed: true },
    ),
    folder('Physics', physicsControls(config.physics, setPhysics, patchSim), { collapsed: true }),
    // The same light panel stage mode has always had. It was never a stage
    // feature — `<PaperLighting>` has taken these overrides all along, and a
    // lone sheet simply had no control that wrote them.
    folder(
      'Light',
      lightControls(config.scene as unknown as Record<string, unknown>, (patch) =>
        patchConfig({ scene: patch as never }),
      ),
      { collapsed: true },
    ),
    folder(
      'Scene',
      [
        // How far the composition is turned to face the camera. It reads as a
        // styling knob and is not one for anything whose shape lives in DEPTH:
        // the `strip` sim folds in z, and every camera in the library is fixed
        // and head-on, so at 0 the roll is end-on and its pile edge-on and the
        // whole thing renders as a blank white column. First in the folder for
        // that reason.
        num('turn', config.scene.turn, { min: -180, max: 180, step: 1, label: 'turn°' }, (v) =>
          patchConfig({ scene: { turn: v } as never }),
        ),
        ...backdropControls(config.scene.backdrop, (next, opts) =>
          patchConfig({ scene: { backdrop: next } as never }, opts),
        ),
      ],
      { collapsed: true },
    ),
  ]

  return <Panel controls={controls} />
}

/** `sheetSchema.height`'s own ceiling — nothing may offer to write past it. */
const SHEET_MAX = 20

/**
 * How long the paper may be, which is not one number.
 *
 * The generic ceiling is a scrubbing range, not a schema limit — the schema
 * allows 20, but a track that spans 0.2–20 gives a 1.4-unit letter about seven
 * per cent of its travel, and almost every sheet in the library is a letter.
 * Eight covers every built-in that is not a strip (`paper-ribbon` is the
 * tallest at 6.4) and keeps the common case scrubbable.
 *
 * A `strip` is the exception, and a hard one: its chain has a capped node
 * count, so past {@link maxStripLength} the nodes stop being added, the
 * spacing between them grows instead, and the roll visibly comes apart. That
 * is a real ceiling rather than a comfortable one, so it wins in both
 * directions — it can be well above eight (about 16.5 at the toilet roll's
 * perforation, which is how a 14-unit roll is authorable at all) and it could
 * be below it for a finely perforated strip.
 *
 * The `Math.max` against the current value is the safety net. A control whose
 * range cannot contain its own value is a data-destroying control, because
 * both edit paths clamp: that is exactly how the height slider stood at
 * `max: 4` while three presets shipped taller, so touching it collapsed a
 * 14-unit roll to 4. A user preset or a shared link can carry anything the
 * schema allows, so the floor under the range is the value itself.
 */
export function sheetHeightMax(config: PaperConfig): number {
  const base =
    typeof config.physics === 'object' && config.physics.type === 'strip'
      ? // Coarsely perforated strips can compute a ceiling above what the
        // schema will accept (27 at a spacing of 1), and a track that can
        // write a value `paperConfigSchema` rejects is a track that throws on
        // drag. The schema is the outer bound in every case.
        Math.min(maxStripLength(config.physics.perforation), SHEET_MAX)
      : 8
  return Math.max(base, config.sheet.height)
}

function physicsControls(
  physics: PhysicsConfig,
  setPhysics: (name: string) => void,
  patchSim: (patch: Partial<ClothConfig> | Partial<StripConfig>) => void,
): Control[] {
  const sim = typeof physics === 'object' ? physics : null
  const controls: Control[] = [
    select(
      'simulation',
      typeof physics === 'object' ? physics.type : physics,
      [...physicsNames, 'cloth', 'strip'],
      setPhysics,
    ),
  ]
  if (sim?.type === 'cloth') {
    controls.push(
      select('pins', sim.pins, ['top-edge', 'top-corners', 'corner', 'none'], (v) =>
        patchSim({ pins: v as ClothConfig['pins'] }),
      ),
      num('wind', sim.wind, { min: 0, max: 1, step: 0.01 }, (v) => patchSim({ wind: v })),
      num('stiffness', sim.stiffness, { min: 0, max: 1, step: 0.01 }, (v) => patchSim({ stiffness: v })),
      num('gravity', sim.gravity, { min: 0, max: 2, step: 0.01 }, (v) => patchSim({ gravity: v })),
    )
  }
  if (sim?.type === 'strip') {
    controls.push(
      // `scroll` is the input the host binds to the page. It is a slider here
      // because dragging it IS scrolling, which is the only way to author the
      // thing without a page to scroll.
      num('scroll', sim.scroll, { min: -20, max: 40, step: 0.05 }, (v) => patchSim({ scroll: v })),
      num('tightness', sim.tightness, { min: 0, max: 1, step: 0.01 }, (v) => patchSim({ tightness: v })),
      num('core', sim.core, { min: 0.01, max: 0.5, step: 0.005 }, (v) => patchSim({ core: v })),
      num('tail', sim.tail, { min: 0, max: 8, step: 0.05 }, (v) => patchSim({ tail: v })),
      num('perforation', sim.perforation, { min: 0.05, max: 5, step: 0.05 }, (v) =>
        patchSim({ perforation: v }),
      ),
      num('crease', sim.crease, { min: 0, max: 1, step: 0.01 }, (v) => patchSim({ crease: v })),
      num('stiffness', sim.stiffness, { min: 0, max: 1, step: 0.01 }, (v) => patchSim({ stiffness: v })),
      num('drag', sim.drag, { min: 0, max: 1, step: 0.01 }, (v) => patchSim({ drag: v })),
      num('gravity', sim.gravity, { min: 0, max: 2, step: 0.01 }, (v) => patchSim({ gravity: v })),
      num('inertia', sim.inertia, { min: 0, max: 1, step: 0.01 }, (v) => patchSim({ inertia: v })),
      num('floor', sim.floor, { min: 0.1, max: 12, step: 0.05 }, (v) => patchSim({ floor: v })),
    )
  }
  return controls
}

function surfaceControls(
  surface: SurfaceConfig,
  stockName: StockName,
  setSurface: (patch: Partial<SurfaceConfig>) => void,
): Control[] {
  const stock = getStock(stockName)
  const controls: Control[] = [
    num('grain', surface.grain ?? stock.defaultSurface.grain ?? 0, { min: 0, max: 1, step: 0.01 }, (v) =>
      setSurface({ grain: v }),
    ),
    num('aging', surface.aging ?? stock.defaultSurface.aging ?? 0, { min: 0, max: 1, step: 0.01 }, (v) =>
      setSurface({ aging: v }),
    ),
    num(
      'showThrough',
      surface.showThrough ?? stock.showThrough,
      { min: 0, max: 1, step: 0.01, label: 'show-through' },
      (v) => setSurface({ showThrough: v }),
    ),
    toggle('deckle', Boolean(surface.deckle), (v) =>
      setSurface({ deckle: v ? { edges: ['bottom'], roughness: 0.5 } : undefined }),
    ),
  ]

  if (surface.deckle) {
    const deckle = surface.deckle
    controls.push(
      select(
        'deckleEdge',
        deckle.edges.join('+'),
        [...paperEdges, 'top+bottom', 'all'].map(String),
        (v) => {
          const edges = v === 'all' ? [...paperEdges] : (v.split('+') as PaperEdge[])
          setSurface({ deckle: { ...deckle, edges } })
        },
        'edges',
      ),
      num('deckleRoughness', deckle.roughness, { min: 0, max: 1, step: 0.01, label: 'tear' }, (v) =>
        setSurface({ deckle: { ...deckle, roughness: v } }),
      ),
    )
  }

  controls.push(
    toggle('perforation', Boolean(surface.perforation), (v) =>
      setSurface({
        perforation: v ? { edges: 'all', holeRadius: 0.016, spacing: 0.055, state: {} } : undefined,
      }),
    ),
  )

  if (surface.perforation) {
    const perf = surface.perforation
    controls.push(
      select(
        'perfEdges',
        perf.edges === 'all' ? 'all' : perf.edges.join('+'),
        ['all', ...paperEdges, 'top+bottom', 'left+right'].map(String),
        (v) => {
          const edges = v === 'all' ? ('all' as const) : (v.split('+') as PaperEdge[])
          setSurface({ perforation: { ...perf, edges } })
        },
        'perf edges',
      ),
      num('perfRadius', perf.holeRadius, { min: 0.002, max: 0.1, step: 0.001, label: 'hole size' }, (v) =>
        setSurface({ perforation: { ...perf, holeRadius: v } }),
      ),
      num('perfSpacing', perf.spacing, { min: 0.01, max: 0.5, step: 0.005, label: 'spacing' }, (v) =>
        setSurface({ perforation: { ...perf, spacing: v } }),
      ),
    )
  }

  controls.push(
    toggle('creases', Boolean(surface.creaseLines), (v) =>
      setSurface({
        creaseLines: v ? { angle: 0, positions: [1 / 3, 2 / 3], strength: 0.5 } : undefined,
      }),
    ),
  )

  if (surface.creaseLines) {
    const creases = surface.creaseLines
    controls.push(
      num('creaseStrength', creases.strength, { min: 0, max: 1, step: 0.01, label: 'strength' }, (v) =>
        setSurface({ creaseLines: { ...creases, strength: v } }),
      ),
    )
  }

  return controls
}

/** What the `src` field shows in place of a 200KB base64 string. */
const UPLOADED = '(uploaded image)'

/**
 * The Content folder: which kind of thing prints on the sheet, then that
 * kind's own fields.
 *
 * Everything below the type selector is generated from the variant's zod
 * schema by the same walk that gives behaviors, layouts and the stage their
 * panels. Content was the one branch of the config still hand-written, and
 * it had grown UI for two of the five types — so `card`, `receipt` and
 * `blank` each opened onto an empty folder, and no sheet could be turned
 * into another kind at all.
 *
 * Four fields stay hand-built, because they are the four the walk cannot
 * state well. They are placed FIRST, ahead of the generated rest, on a rule
 * worth keeping as more content types land: the content itself, and then
 * how it is set.
 */
function contentControls(
  content: ContentConfig,
  patchConfig: (p: { content: ContentConfigInput }, opts?: { external?: boolean }) => void,
): Control[] {
  const set = (patch: Record<string, unknown>, opts?: { external?: boolean }) =>
    patchConfig({ content: { ...content, ...patch } as ContentConfigInput }, opts)

  // The patch is the discriminator and nothing else: a differing `type`
  // replaces the union wholesale (mergeWithDeletes) rather than merging, and
  // the parse that follows fills the new variant's defaults — so switching to
  // `receipt` cannot leave a `src` behind. External, because every row under
  // this one is about to be a different set and the inspector should remount.
  const controls: Control[] = [
    select('type', content.type, [...contentNames], (v) =>
      patchConfig({ content: { type: v } as ContentConfigInput }, { external: true }),
    ),
  ]

  // `back` is a nested discriminated union — what prints on the REVERSE of
  // the sheet. The walk skips it silently; naming it here says that is meant.
  // `wash` is skipped for a different reason: it is OPTIONAL, and the walk
  // would draw an unset one as a folder of sliders sitting at their minimums,
  // which reads as a wash that is switched on and colourless rather than as
  // one that is not there. It gets a toggle below, the way `deckle` does.
  const skip = ['type', 'back', 'wash']

  if (content.type === 'image') {
    skip.push('src')
    controls.push(
      text(
        'src',
        content.src.startsWith('data:') ? UPLOADED : content.src,
        (v) => {
          // Editing the mask itself would replace the picture with the words.
          if (v !== UPLOADED) set({ src: v })
        },
        { hint: 'a URL, or upload a file below' },
      ),
      button('upload image', () => {
        void pickImageAsDataUrl().then((dataUrl) => {
          // external → the inspector remounts and the src field shows the mask.
          if (dataUrl) set({ src: dataUrl }, { external: true })
        })
      }),
    )
  }

  if (content.type === 'text') {
    skip.push('text')
    controls.push(text('text', content.text, (v) => set({ text: v }), { rows: 4 }))
  }

  if (content.type === 'card') {
    skip.push('body')
    controls.push(text('body', content.body, (v) => set({ body: v }), { rows: 3 }))
  }

  if (content.type === 'receipt') {
    skip.push('items')
    controls.push(
      text('items', formatItems(content.items), (v) => set({ items: parseItems(v) }), { rows: 5 }),
      // A visible line, not a tooltip: the format is not guessable, and a
      // hint nobody hovers is a hint nobody reads.
      note('itemsFormat', 'One item per line — NAME | PRICE'),
    )
  }

  controls.push(
    ...schemaControls(
      contentSchemaFor(content.type),
      content as unknown as Record<string, unknown>,
      (key, value) => set({ [key]: value }),
      skip,
    ),
  )

  // The ground, under whatever the sheet carries. Last in the folder because
  // it is painted first — the panel reads top-to-bottom as subject, then
  // setting, then what it is all sitting on.
  controls.push(
    toggle('wash', Boolean(content.wash), (on) =>
      set({ wash: on ? washSchema.parse({}) : undefined }, { external: true }),
    ),
  )
  if (content.wash) {
    const wash = content.wash
    controls.push(
      folder(
        'Wash',
        schemaControls(washSchema, wash as unknown as Record<string, unknown>, (key, value) =>
          set({ wash: { ...wash, [key]: value } as WashConfig }),
        ),
      ),
    )
  }

  return controls
}
