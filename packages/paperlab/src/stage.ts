/**
 * `paperlab/stage` — paper as architecture.
 *
 * Stage mode lives behind its own entry point for one concrete reason: it is
 * the only part of the library that needs `@react-three/postprocessing` and
 * `postprocessing`, and a static import of those from the MAIN entry makes
 * them impossible to declare honestly as optional. Tree-shaking removes the
 * bytes — a `<Paper>` bundle has never contained a line of the print pass —
 * but it cannot remove the import SPECIFIER, so the main entry naming the
 * module means a `<Paper>`-only consumer must still be able to resolve it.
 *
 * That is the whole argument, and it is a different argument from the one
 * that first settled this, when stage was deliberately NOT split into a
 * subpath. That decision was about BYTES, and it was correct about bytes:
 * a subpath saves nobody a byte, because tree-shaking already did. This is
 * about RESOLVABILITY, which tree-shaking demonstrably cannot fix.
 *
 * The scene's own parts — the figure, the surround, the gait and camera
 * math, the quality ladder — are still deliberately not exported. They are
 * the inside of one composition, and `<PaperStage>` is the composition.
 */

export {
  PaperStage,
  PaperStageScene,
  type PaperStageProps,
  type PaperStageSceneProps,
} from './stage/PaperStage'
export { SOURCE_INTENSITY } from './stage/Surround'
export {
  stageSchema,
  stageGradeSchema,
  stageRoomSchema,
  stageSuspensionSchema,
  type StageConfig,
  type StageConfigInput,
  type StageGradeConfig,
} from './stage/schema'
// Who drives the walk — the same three names a field's motion uses.
export { stageMotionSchema, type StageMotion, type StageMotionInput } from './stage/navigate'
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
