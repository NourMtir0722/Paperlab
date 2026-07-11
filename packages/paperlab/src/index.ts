export { Paper, type PaperProps } from './Paper'
export {
  PaperField,
  PaperFieldMesh,
  type PaperFieldProps,
  type PaperFieldMeshProps,
} from './PaperField'
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
  physicsSchema,
  clothConfigSchema,
  physicsNames,
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
  type PhysicsConfig,
  type ClothConfig,
} from './config/schema'

export type { Deformer, DeformerInstance, DeformerContext, SheetDims } from './deformers/types'
export { registerDeformer, getDeformer, listDeformers } from './deformers/registry'
export { applyDeformerStack, displacePoint, stackMinSegments } from './deformers/compose'
export { roll, rollOptionsSchema, type RollOptions } from './deformers/roll'
export { curl, curlOptionsSchema, cornerNames, type CurlOptions } from './deformers/curl'
export { bend, bendOptionsSchema, type BendOptions } from './deformers/bend'
export { fold, foldOptionsSchema, type FoldOptions } from './deformers/fold'
export { wave, waveOptionsSchema, type WaveOptions } from './deformers/wave'

export type { Behavior, HandleSpec } from './behaviors/types'
export { registerBehavior, getBehavior, listBehaviors } from './behaviors/registry'
export { peel, peelOptionsSchema, type PeelOptions } from './behaviors/peel'
export { unroll, unrollOptionsSchema, type UnrollOptions } from './behaviors/unroll'
export { flip, flipOptionsSchema, type FlipOptions } from './behaviors/flip'
export { letterFold, letterFoldOptionsSchema, type LetterFoldOptions } from './behaviors/letter-fold'
export { hang, hangOptionsSchema, type HangOptions } from './behaviors/hang'
export { fly, flyOptionsSchema, type FlyOptions } from './behaviors/fly'
export { fall, fallOptionsSchema, type FallOptions } from './behaviors/fall'

export { idlePresets, getIdlePreset, idleNames, type IdleName, type IdlePreset } from './physics/idle'

export {
  buildDisplacementGLSL,
  buildFieldVertexShader,
  buildFieldFragmentShader,
  stackUniformValues,
  type ComposedDisplacement,
} from './field/compose'
export {
  getLayout,
  listLayouts,
  registerLayout,
  ring,
  deck,
  cascade,
  helix,
  wall,
  tunnel,
  scatter,
  type Layout,
  type PaperPose,
} from './field/layouts'
export { useContentAtlas, atlasGrid, type ContentAtlas } from './content/atlas'
export {
  runParityHarness,
  parityCases,
  PARITY_EPSILON,
  type ParityCase,
  type ParityResult,
} from './field/parity'
export { ClothSim, type ClothParams, type PinMode } from './physics/cloth'

export { composeSurface, type ComposedSurface } from './surface/compose'
export { PaperMaterial, type PaperMaterialProps } from './surface/PaperMaterial'
export { receiptTotals, barcodeBars, type ReceiptContent } from './content/receipt'

export { parsePreset, serializePreset, mergeConfig } from './config/serialize'
export { diffConfig, buildJsxSnippet } from './config/diff'
export {
  buildAgentPayload,
  describeConfig,
  AGENT_PAYLOAD_VERSION,
} from './config/agent-payload'
export {
  usePrefersReducedMotion,
  supportsWebGL,
  contentText,
  PaperMirror,
  PaperFallback,
} from './a11y'
export { quantizeTime, quantizeProgress, ON_TWOS_FPS } from './motion/onTwos'
export { getPreset, listPresets } from './config/presets'
export { stocks, getStock, type Stock } from './core/stock'
export { createSheetGeometry, resolveSegments } from './core/sheet'
export { resolveMode, type PaperMode, type PaperModeRequest } from './core/modes'
