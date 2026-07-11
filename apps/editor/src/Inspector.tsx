import { LevaPanel, folder, useControls, useCreateStore } from 'leva'
import {
  getBehavior,
  getStock,
  listBehaviors,
  paperEdges,
  physicsNames,
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
  const config = useEditor((s) => s.config)
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
