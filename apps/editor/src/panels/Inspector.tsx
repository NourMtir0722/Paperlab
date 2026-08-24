import {
  contentNames,
  contentSchemaFor,
  getBehavior,
  getStock,
  lightingNames,
  listBehaviors,
  paperEdges,
  physicsNames,
  resolveStateConfig,
  stockNames,
  type ClothConfig,
  type ContentConfig,
  type ContentConfigInput,
  type PaperEdge,
  type PhysicsConfig,
  type StockName,
  type SurfaceConfig,
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
  const patchCloth = useEditor((s) => s.patchCloth)

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
        num('height', config.sheet.height, { min: 0.2, max: 4, step: 0.05 }, (v) =>
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
    folder('Physics', physicsControls(config.physics, setPhysics, patchCloth), { collapsed: true }),
    folder(
      'Scene',
      [
        select('lighting', config.scene.lighting, [...lightingNames], (v) =>
          patchConfig({ scene: { lighting: v as never } }),
        ),
      ],
      { collapsed: true },
    ),
  ]

  return <Panel controls={controls} />
}

function physicsControls(
  physics: PhysicsConfig,
  setPhysics: (name: string) => void,
  patchCloth: (patch: Partial<ClothConfig>) => void,
): Control[] {
  const isCloth = typeof physics === 'object'
  const controls: Control[] = [
    select('simulation', isCloth ? 'cloth' : physics, [...physicsNames, 'cloth'], setPhysics),
  ]
  if (isCloth) {
    controls.push(
      select('pins', physics.pins, ['top-edge', 'top-corners', 'corner', 'none'], (v) =>
        patchCloth({ pins: v as ClothConfig['pins'] }),
      ),
      num('wind', physics.wind, { min: 0, max: 1, step: 0.01 }, (v) => patchCloth({ wind: v })),
      num('stiffness', physics.stiffness, { min: 0, max: 1, step: 0.01 }, (v) =>
        patchCloth({ stiffness: v }),
      ),
      num('gravity', physics.gravity, { min: 0, max: 2, step: 0.01 }, (v) => patchCloth({ gravity: v })),
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
  const skip = ['type', 'back']

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

  return controls
}
