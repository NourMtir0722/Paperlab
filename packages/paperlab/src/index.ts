export { Paper, type PaperProps } from './Paper'
export {
  PaperField,
  PaperFieldMesh,
  groupFieldPapers,
  resolveFieldSlotConfig,
  fieldKeyboardStep,
  DropZone,
  DropZoneRegistry,
  zoneAccepts,
  type PaperFieldProps,
  type PaperFieldMeshProps,
  type FieldPaperSlot,
  type FieldGroupData,
  type DropZoneConfig,
  type DropZoneProps,
  type PlacedPaper,
  type FieldA11yController,
  type KeyboardCarry,
  type KeyboardStepResult,
} from './PaperField'
export { PaperMesh, resolveConfig, type PaperMeshProps, type PaperHandle } from './PaperMesh'

export {
  paperConfigSchema,
  sheetSchema,
  stockSchema,
  contentSchema,
  backContentSchema,
  behaviorConfigSchema,
  deformerInstanceSchema,
  surfaceSchema,
  receiptContentSchema,
  physicsSchema,
  clothConfigSchema,
  physicsNames,
  sceneSchema,
  lightingNames,
  stockNames,
  paperEdges,
  coreStateNames,
  stateDefSchema,
  stateTransitionSchema,
  paperStatesSchema,
  type PaperConfig,
  type PaperConfigInput,
  type SheetConfig,
  type StockName,
  type ContentConfig,
  type BackContentConfig,
  type BehaviorConfig,
  type DeformerInstanceConfig,
  type SurfaceConfig,
  type PaperEdge,
  type PhysicsConfig,
  type ClothConfig,
  type SceneConfig,
  type LightingName,
  type CoreStateName,
  type StateName,
  type StateDef,
  type StateTransitionConfig,
  type PaperStates,
  type PaperStatesInput,
} from './config/schema'

export {
  PaperStateMachine,
  stateEventTransitions,
  resolveStateConfig,
  recordStateOverride,
  stripStates,
  flattenNumeric,
  type StateEvent,
  type PaperStateMachineOptions,
} from './states/machine'
export { usePaperStates, type UsePaperStatesResult } from './states/usePaperStates'

export {
  sheetLayoutSchema,
  sheetSlotXY,
  sheetBackingSize,
  outwardCorner,
  tornEdgesOnDetach,
  withSheetCellFromPaper,
  SHEET_LIFT,
  type SheetLayoutOptions,
} from './field/sheetGrid'
export { drawBacking, silhouetteRects, lightenHex, type BackingDrawSpec } from './content/backing'

export {
  lightingPresets,
  getLightingPreset,
  type LightingPreset,
} from './scene/lighting'
export { PaperLighting, makeGoboTexture, type PaperLightingProps } from './scene/PaperLighting'

export type { Deformer, DeformerInstance, DeformerContext, SheetDims } from './deformers/types'
export {
  registerDeformer,
  getDeformer,
  listDeformers,
  resolveDeformerStack,
} from './deformers/registry'
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
export { carry, carryOptionsSchema, type CarryOptions } from './behaviors/carry'
export { flight, flightOptionsSchema, type FlightOptions } from './behaviors/flight'

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
  fan,
  spread,
  pile,
  wall,
  spill,
  sweep,
  book,
  accordion,
  rack,
  colonnade,
  sheet,
  type Layout,
  type PaperPose,
} from './field/layouts'
export { fieldBounds, fitCamera, type FieldBounds } from './field/framing'
// ── Stage ───────────────────────────────────────────────────────────────────
// The scene's own parts — the figure, the surround, the gait and camera math,
// the quality ladder — are deliberately NOT exported. They are the inside of
// one composition, and `<PaperStage>` is the composition. What is public here
// is what you need to configure a stage, name one, or serialize one.
export {
  PaperStage,
  PaperStageScene,
  type PaperStageProps,
  type PaperStageSceneProps,
} from './stage/PaperStage'
export { stageSchema, type StageConfig, type StageConfigInput } from './stage/schema'
export { stagePresets, getStagePreset, listStagePresets, type StagePreset } from './stage/presets'
export { walks, walkNames, getWalk, type WalkName } from './stage/walks'
export { createWalkPath, type Ground, type WalkPath, type WalkPathOptions } from './stage/path'
// QualityTier is the argument `onQualityChange` hands back — a consumer
// cannot type that handler without it.
export { qualityNames, type QualityName, type QualityTier } from './stage/quality'
export { shotNames, type ShotName, type ShotOptions, type StageScale, type StageShot } from './stage/camera'
export {
  buildStageAgentPayload,
  buildStageComponentSource,
  describeStage,
  diffStage,
  walkNameFor,
  stringifyStage,
  type StageExportInput,
} from './stage/export'
export {
  translucencyUniforms,
  translucencyValues,
  TRANSMISSION_GAIN,
  type TranslucencyValues,
} from './surface/translucency'
export { useContentAtlas, atlasGrid, type ContentAtlas } from './content/atlas'
export {
  runParityHarness,
  parityCases,
  PARITY_EPSILON,
  type ParityCase,
  type ParityResult,
} from './field/parity'
export { ClothSim, type ClothParams, type PinMode } from './physics/cloth'
export {
  dampTo,
  gust,
  flightPose,
  carryDrive,
  type AeroPose,
  type DampedValue,
  type FlightParams,
} from './physics/aero'

export { composeSurface, type ComposedSurface, type SurfaceMaps } from './surface/compose'
export { PaperMaterial, type PaperMaterialProps } from './surface/PaperMaterial'
export { receiptTotals, barcodeBars, type ReceiptContent } from './content/receipt'

export { parsePreset, serializePreset, mergeConfig, mergeWithDeletes } from './config/serialize'
export { diffConfig, buildJsxSnippet } from './config/diff'
export {
  buildAgentPayload,
  describeConfig,
  AGENT_PAYLOAD_VERSION,
} from './config/agent-payload'
export {
  buildFieldAgentPayload,
  buildFieldComponentSource,
  describeFieldConfig,
  diffFieldProps,
  distinctFieldPresets,
  type FieldExportInput,
  type FieldExportPaper,
  type FieldExportZone,
} from './config/field-export'
export {
  usePrefersReducedMotion,
  supportsWebGL,
  contentText,
  PaperMirror,
  PaperFallback,
} from './a11y'
export { quantizeTime, quantizeProgress, ON_TWOS_FPS } from './motion/onTwos'
export {
  getPreset,
  listPresets,
  registerPreset,
  unregisterPreset,
  isBuiltinPreset,
  uniquePresetName,
} from './config/presets'
export { stocks, getStock, type Stock } from './core/stock'
export { createSheetGeometry, resolveSegments } from './core/sheet'
export { resolveMode, type PaperMode, type PaperModeRequest } from './core/modes'
