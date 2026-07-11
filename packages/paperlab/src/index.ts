export { Paper, type PaperProps } from './Paper'
export { PaperMesh, resolveConfig, type PaperMeshProps, type PaperHandle } from './PaperMesh'

export {
  paperConfigSchema,
  sheetSchema,
  stockSchema,
  contentSchema,
  stockNames,
  type PaperConfig,
  type PaperConfigInput,
  type SheetConfig,
  type StockName,
  type ContentConfig,
} from './config/schema'

export { parsePreset, serializePreset, mergeConfig } from './config/serialize'
export { getPreset, listPresets } from './config/presets'
export { stocks, getStock, type Stock } from './core/stock'
export { createSheetGeometry, resolveSegments } from './core/sheet'
export { resolveMode, type PaperMode, type PaperModeRequest } from './core/modes'
