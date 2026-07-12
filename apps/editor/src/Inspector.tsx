import { LevaPanel, folder, useControls, useCreateStore } from 'leva'
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
import { schemaControls } from './zodLeva'
import { useEditor } from './store'

type LevaSchema = Parameters<typeof folder>[0]

/**
 * Inspector of the selection. Bootstrapped on leva for v0 — replaced by the
 * schema-generated custom panel before public launch. Remounted (keyed) when
 * the preset, behavior type, or an external edit (handle drag) changes.
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
  // Own store per mount — leva's global store would keep stale values across
  // preset switches (the Inspector is remounted by key to reset controls).
  const store = useCreateStore()

  const behaviorFields: LevaSchema = config.behavior
    ? schemaControls(
        getBehavior(config.behavior.type).optionsSchema,
        config.behavior as unknown as Record<string, unknown>,
        (key, value) => patchConfig({ behavior: { [key]: value } as never }),
      )
    : {}

  useControls({
    Behavior: folder({
      type: {
        value: config.behavior?.type ?? 'none',
        options: ['none', ...listBehaviors()],
        onChange: (v: string, _, ctx) => {
          if (ctx.initial) return
          setBehaviorType(v === 'none' ? null : v)
        },
      },
      ...behaviorFields,
    }),
    Sheet: folder({
      width: {
        value: config.sheet.width,
        min: 0.2,
        max: 4,
        step: 0.05,
        onChange: (v: number, _, ctx) => ctx.initial || patchConfig({ sheet: { width: v } }),
      },
      height: {
        value: config.sheet.height,
        min: 0.2,
        max: 4,
        step: 0.05,
        onChange: (v: number, _, ctx) => ctx.initial || patchConfig({ sheet: { height: v } }),
      },
    }),
    Stock: folder({
      stock: {
        value: config.stock,
        options: [...stockNames],
        onChange: (v: StockName, _, ctx) => ctx.initial || patchConfig({ stock: v }),
      },
    }),
    Content: folder(contentControls(config.content, patchConfig)),
    Surface: folder(surfaceControls(config.surface, config.stock, setSurface)),
    Physics: folder(physicsControls(config.physics, setPhysics, patchCloth)),
    Scene: folder({
      lighting: {
        value: config.scene.lighting,
        options: [...lightingNames],
        onChange: (v: string, _, ctx) =>
          ctx.initial || patchConfig({ scene: { lighting: v as never } }),
      },
    }),
  }, { store })

  return <LevaPanel store={store} fill flat titleBar={false} />
}

function physicsControls(
  physics: PhysicsConfig,
  setPhysics: (name: string) => void,
  patchCloth: (patch: Partial<ClothConfig>) => void,
): LevaSchema {
  const isCloth = typeof physics === 'object'
  const changed =
    (fn: (v: never) => void) => (v: unknown, _: unknown, ctx: { initial: boolean }) =>
      ctx.initial || fn(v as never)

  const controls: LevaSchema = {
    simulation: {
      value: isCloth ? 'cloth' : physics,
      options: [...physicsNames, 'cloth'],
      onChange: changed((v: string) => setPhysics(v)),
    },
  }
  if (isCloth) {
    Object.assign(controls, {
      pins: {
        value: physics.pins,
        options: ['top-edge', 'top-corners', 'corner', 'none'],
        onChange: changed((v: ClothConfig['pins']) => patchCloth({ pins: v })),
      },
      wind: {
        value: physics.wind,
        min: 0,
        max: 1,
        step: 0.01,
        onChange: changed((v: number) => patchCloth({ wind: v })),
      },
      stiffness: {
        value: physics.stiffness,
        min: 0,
        max: 1,
        step: 0.01,
        onChange: changed((v: number) => patchCloth({ stiffness: v })),
      },
      gravity: {
        value: physics.gravity,
        min: 0,
        max: 2,
        step: 0.01,
        onChange: changed((v: number) => patchCloth({ gravity: v })),
      },
    })
  }
  return controls
}

function surfaceControls(
  surface: SurfaceConfig,
  stockName: StockName,
  setSurface: (patch: Partial<SurfaceConfig>) => void,
): LevaSchema {
  const stock = getStock(stockName)
  const changed =
    (fn: (v: never) => void) => (v: unknown, _: unknown, ctx: { initial: boolean }) =>
      ctx.initial || fn(v as never)

  return {
    grain: {
      value: surface.grain ?? stock.defaultSurface.grain ?? 0,
      min: 0,
      max: 1,
      step: 0.01,
      onChange: changed((v: number) => setSurface({ grain: v })),
    },
    aging: {
      value: surface.aging ?? stock.defaultSurface.aging ?? 0,
      min: 0,
      max: 1,
      step: 0.01,
      onChange: changed((v: number) => setSurface({ aging: v })),
    },
    showThrough: {
      label: 'show-through',
      value: surface.showThrough ?? stock.showThrough,
      min: 0,
      max: 1,
      step: 0.01,
      onChange: changed((v: number) => setSurface({ showThrough: v })),
    },
    deckle: {
      value: Boolean(surface.deckle),
      onChange: changed((v: boolean) =>
        setSurface({ deckle: v ? { edges: ['bottom'], roughness: 0.5 } : undefined }),
      ),
    },
    ...(surface.deckle
      ? {
          deckleEdge: {
            label: 'edges',
            value: surface.deckle.edges.join('+'),
            options: [...paperEdges, 'top+bottom', 'all'].map(String),
            onChange: changed((v: string) => {
              const edges =
                v === 'all' ? [...paperEdges] : (v.split('+') as PaperEdge[])
              setSurface({ deckle: { ...surface.deckle!, edges } })
            }),
          },
          deckleRoughness: {
            label: 'tear',
            value: surface.deckle.roughness,
            min: 0,
            max: 1,
            step: 0.01,
            onChange: changed((v: number) =>
              setSurface({ deckle: { ...surface.deckle!, roughness: v } }),
            ),
          },
        }
      : {}),
    perforation: {
      value: Boolean(surface.perforation),
      onChange: changed((v: boolean) =>
        setSurface({ perforation: v ? { edges: 'all', holeRadius: 0.016, spacing: 0.055, state: {} } : undefined }),
      ),
    },
    ...(surface.perforation
      ? {
          perfEdges: {
            label: 'perf edges',
            value: surface.perforation.edges === 'all' ? 'all' : surface.perforation.edges.join('+'),
            options: ['all', ...paperEdges, 'top+bottom', 'left+right'].map(String),
            onChange: changed((v: string) => {
              const edges = v === 'all' ? ('all' as const) : (v.split('+') as PaperEdge[])
              setSurface({ perforation: { ...surface.perforation!, edges } })
            }),
          },
          perfRadius: {
            label: 'hole size',
            value: surface.perforation.holeRadius,
            min: 0.002,
            max: 0.1,
            step: 0.001,
            onChange: changed((v: number) =>
              setSurface({ perforation: { ...surface.perforation!, holeRadius: v } }),
            ),
          },
          perfSpacing: {
            label: 'spacing',
            value: surface.perforation.spacing,
            min: 0.01,
            max: 0.5,
            step: 0.005,
            onChange: changed((v: number) =>
              setSurface({ perforation: { ...surface.perforation!, spacing: v } }),
            ),
          },
        }
      : {}),
    creases: {
      value: Boolean(surface.creaseLines),
      onChange: changed((v: boolean) =>
        setSurface({
          creaseLines: v ? { angle: 0, positions: [1 / 3, 2 / 3], strength: 0.5 } : undefined,
        }),
      ),
    },
    ...(surface.creaseLines
      ? {
          creaseStrength: {
            label: 'strength',
            value: surface.creaseLines.strength,
            min: 0,
            max: 1,
            step: 0.01,
            onChange: changed((v: number) =>
              setSurface({ creaseLines: { ...surface.creaseLines!, strength: v } }),
            ),
          },
        }
      : {}),
  }
}

function contentControls(
  content: ContentConfig,
  patchConfig: (p: { content: ContentConfig }) => void,
): LevaSchema {
  if (content.type === 'text') {
    return {
      text: {
        value: content.text,
        rows: 4,
        onChange: (v: string, _: unknown, ctx: { initial: boolean }) =>
          ctx.initial || patchConfig({ content: { ...content, text: v } }),
      },
      size: {
        value: content.size,
        min: 12,
        max: 128,
        step: 1,
        onChange: (v: number, _: unknown, ctx: { initial: boolean }) =>
          ctx.initial || patchConfig({ content: { ...content, size: v } }),
      },
    }
  }
  if (content.type === 'image') {
    return {
      src: {
        value: content.src,
        onChange: (v: string, _: unknown, ctx: { initial: boolean }) =>
          ctx.initial || patchConfig({ content: { ...content, src: v } }),
      },
    }
  }
  return {}
}
