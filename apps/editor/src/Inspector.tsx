import {
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
  type PaperEdge,
  type PhysicsConfig,
  type StockName,
  type SurfaceConfig,
} from 'paperlab'
import { button, folder, num, partitionSignature, select, text, toggle, type Control } from './controlModel'
import { Panel } from './controls'
import { useEditor } from './store'

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

/**
 * Read a local file into a self-contained data URL, downscaled so it stays
 * serializable (presets live in localStorage and travel in exports).
 */
function pickImageAsDataUrl(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) return resolve(null)
      const url = URL.createObjectURL(file)
      const img = new Image()
      img.onload = () => {
        const MAX = 1024
        const scale = Math.min(1, MAX / Math.max(img.width, img.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(img.width * scale))
        canvas.height = Math.max(1, Math.round(img.height * scale))
        canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
        URL.revokeObjectURL(url)
        // PNG keeps transparency (die-cut stickers); photos go JPEG.
        resolve(
          file.type === 'image/png' || file.type === 'image/webp'
            ? canvas.toDataURL('image/png')
            : canvas.toDataURL('image/jpeg', 0.85),
        )
      }
      img.onerror = () => {
        URL.revokeObjectURL(url)
        resolve(null)
      }
      img.src = url
    }
    input.click()
  })
}

function contentControls(
  content: ContentConfig,
  patchConfig: (p: { content: ContentConfig }, opts?: { external?: boolean }) => void,
): Control[] {
  if (content.type === 'text') {
    return [
      text('text', content.text, (v) => patchConfig({ content: { ...content, text: v } }), { rows: 4 }),
      num('size', content.size, { min: 12, max: 128, step: 1 }, (v) =>
        patchConfig({ content: { ...content, size: v } }),
      ),
    ]
  }
  if (content.type === 'image') {
    return [
      text('src', content.src.startsWith('data:') ? '(uploaded image)' : content.src, (v) => {
        if (v === '(uploaded image)') return
        patchConfig({ content: { ...content, src: v } })
      }),
      button('upload image', () => {
        void pickImageAsDataUrl().then((dataUrl) => {
          // external → the inspector remounts and the src field shows the mask.
          if (dataUrl) patchConfig({ content: { ...content, src: dataUrl } }, { external: true })
        })
      }),
    ]
  }
  return []
}
