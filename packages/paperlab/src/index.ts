export { Paper, type PaperProps } from './Paper'
export { PaperMesh, resolveConfig, type PaperMeshProps, type PaperHandle } from './PaperMesh'

export {
  paperConfigSchema,
  sheetSchema,
  stockSchema,
  contentSchema,
  behaviorConfigSchema,
  deformerInstanceSchema,
  surfaceSchema,
  receiptContentSchema,
  stockNames,
  paperEdges,
  type PaperConfig,
  type PaperConfigInput,
  type SheetConfig,
  type StockName,
  type ContentConfig,
  type BehaviorConfig,
  type DeformerInstanceConfig,
  type SurfaceConfig,
  type PaperEdge,
} from './config/schema'

export type { Deformer, DeformerInstance, DeformerContext, SheetDims } from './deformers/types'
export { registerDeformer, getDeformer, listDeformers } from './deformers/registry'
export { applyDeformerStack, displacePoint, stackMinSegments } from './deformers/compose'
export { roll, rollOptionsSchema, type RollOptions } from './deformers/roll'
export { curl, curlOptionsSchema, cornerNames, type CurlOptions } from './deformers/curl'
export { bend, bendOptionsSchema, type BendOptions } from './deformers/bend'
export { fold, foldOptionsSchema, type FoldOptions } from './deformers/fold'

export type { Behavior, HandleSpec } from './behaviors/types'
export { registerBehavior, getBehavior, listBehaviors } from './behaviors/registry'
export { peel, peelOptionsSchema, type PeelOptions } from './behaviors/peel'
export { unroll, unrollOptionsSchema, type UnrollOptions } from './behaviors/unroll'
export { flip, flipOptionsSchema, type FlipOptions } from './behaviors/flip'
export { letterFold, letterFoldOptionsSchema, type LetterFoldOptions } from './behaviors/letter-fold'

export { composeSurface, type ComposedSurface } from './surface/compose'
export { PaperMaterial, type PaperMaterialProps } from './surface/PaperMaterial'
export { receiptTotals, barcodeBars, type ReceiptContent } from './content/receipt'

export { parsePreset, serializePreset, mergeConfig } from './config/serialize'
export { getPreset, listPresets } from './config/presets'
export { stocks, getStock, type Stock } from './core/stock'
export { createSheetGeometry, resolveSegments } from './core/sheet'
export { resolveMode, type PaperMode, type PaperModeRequest } from './core/modes'
