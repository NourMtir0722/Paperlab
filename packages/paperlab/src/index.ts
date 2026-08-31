/**
 * The public API.
 *
 * Everything named here is a promise: once it is on npm, taking it away costs
 * whoever imported it a migration. So the bar is not "is this useful?" but
 * "would I support this for years?" — and the answer for a shader builder, a
 * texture painter or a tessellation constant is no. Those are the inside of
 * the box, and the box is `<Paper>`, `<PaperField>`, `<PaperStage>` and the
 * data that describes them.
 *
 * Three things survive that bar despite looking internal, each for a reason
 * written where it is exported: the parity harness, the tessellation
 * arithmetic, and line breaking. Each is the answer to a question a caller
 * can genuinely ask and cannot otherwise answer.
 *
 * Adding a name here later is free. Removing one is not. When in doubt, leave
 * it out.
 */

// ── The components ──────────────────────────────────────────────────────────

export { Paper, type PaperProps } from './Paper'
export { PaperMesh, type PaperMeshProps, type PaperHandle } from './PaperMesh'
export {
  PaperField,
  PaperFieldMesh,
  DropZone,
  type PaperFieldProps,
  type PaperFieldMeshProps,
  type FieldPaperSlot,
  type DropZoneConfig,
  type DropZoneProps,
  type PlacedPaper,
} from './PaperField'

// ── The schema. It is the spec: if it cannot serialize, it does not ship. ───

export {
  paperConfigSchema,
  sceneSchema,
  backdropSchema,
  behaviorConfigSchema,
  clothConfigSchema,
  stripConfigSchema,
  paperStatesSchema,
  stateDefSchema,
  physicsNames,
  lightingNames,
  stockNames,
  contentNames,
  contentSchemaFor,
  washSchema,
  creaseSchema,
  memorySchema,
  paperEdges,
  coreStateNames,
  type PaperConfig,
  type PaperConfigInput,
  type SheetConfig,
  type StockName,
  type ContentConfig,
  type ContentConfigInput,
  type WashConfig,
  type BackContentConfig,
  type BehaviorConfig,
  type BehaviorConfigInput,
  type DeformerInstanceConfig,
  type DeformerInstanceConfigInput,
  type SurfaceConfig,
  type SurfaceConfigInput,
  type CreaseConfig,
  type CreaseConfigInput,
  type MemoryConfig,
  type MemoryConfigInput,
  type PaperEdge,
  type PhysicsConfig,
  type PhysicsConfigInput,
  type ClothConfig,
  type StripConfig,
  type SceneConfig,
  type BackdropConfig,
  type SceneConfigInput,
  type LightingName,
  type FilmName,
  type CoreStateName,
  type StateName,
  type StateDef,
  type StateTransitionConfig,
  type PaperStates,
  type PaperStatesInput,
} from './config/schema'

export { sheetLayoutSchema, type SheetLayoutOptions } from './field/sheetGrid'

// ── Presets, and the file format ────────────────────────────────────────────

export {
  getPreset,
  listPresets,
  registerPreset,
  unregisterPreset,
  isBuiltinPreset,
  uniquePresetName,
} from './config/presets'
export { parsePreset, serializePreset, mergeConfig, mergeWithDeletes } from './config/serialize'
export { diffConfig, buildJsxSnippet } from './config/diff'

// ── Export: the brief an agent or a codebase receives ───────────────────────

export { buildAgentPayload, describeConfig } from './config/agent-payload'
export {
  buildFieldAgentPayload,
  buildFieldComponentSource,
  describeFieldConfig,
  diffFieldProps,
  type FieldExportInput,
  type FieldExportPaper,
  type FieldExportZone,
} from './config/field-export'

// ── The registries, and the three ways to extend them ───────────────────────

export type { Deformer, DeformerInstance, DeformerContext, SheetDims } from './deformers/types'
export { registerDeformer, getDeformer, listDeformers } from './deformers/registry'
export type { Behavior, HandleSpec } from './behaviors/types'
export { registerBehavior, getBehavior, listBehaviors } from './behaviors/registry'
export { getLayout, listLayouts, registerLayout, type Layout, type PaperPose } from './field/layouts'
export { stocks, getStock, type Stock } from './core/stock'
export { idleNames, type IdleName, type IdlePreset } from './physics/idle'
/**
 * The longest strip the `strip` sim can still draw at a given perforation
 * spacing. Exported for authoring UI: past it the chain's node count is capped
 * and the roll comes apart, so a length control needs to know where to stop.
 */
export { maxStripLength } from './physics/strip'

/**
 * Paper memory — creasing, and what a sheet keeps of a fold.
 *
 * `applyMemory` is exported because it is the one piece a host might need to
 * reproduce outside the frame loop: an exporter or a thumbnailer that builds
 * a stack by hand has to fold the creases in the same way, or a shared link
 * renders one shape in the editor and another in the picture of it.
 */
export { applyMemory, CreaseTracker, MAX_SET, MAX_CREASES } from './deformers/memory'

// ── Lighting is data, not an enum ───────────────────────────────────────────

export {
  lightSchema,
  resolveLighting,
  lightAngles,
  type LightingPreset,
  type LightAngles,
  type LightOverrides,
  type LightOverridesInput,
} from './scene/lighting'
export { PaperLighting, type PaperLightingProps } from './scene/PaperLighting'
// Rendered by whoever owns the canvas — see the note on the component.
export { PaperBackdrop } from './scene/backdrop'
// Publish a resolved rig to the paper under it, so a hand-lit scene's
// transmission agrees with its lamps. `<PaperStage>` does this for you.
export { LightRig } from './scene/rig'

// ── Interaction states ──────────────────────────────────────────────────────

export { resolveStateConfig, recordStateOverride, type StateEvent } from './states/machine'
export { usePaperStates, type UsePaperStatesResult } from './states/usePaperStates'

// ── Accessibility ───────────────────────────────────────────────────────────

export { usePrefersReducedMotion, supportsWebGL } from './a11y'

// ── The three that look internal and are not ────────────────────────────────

/**
 * The GPU/CPU parity harness — public on purpose, and the reasoning is worth
 * writing down because it reads like test infrastructure that leaked.
 *
 * It is test infrastructure. It is also the only way to check the invariant
 * the contribution ladder is built on: a deformer ships a JS `displace` and a
 * GLSL chunk, and the two must agree. `CONTRIBUTING.md` asks a contributor to
 * add cases to `field/parity.ts` and run `pnpm test:parity`, which needs a
 * real WebGL context, which means a browser, which means it runs from an app
 * — and the apps consume this library **through its public API only**. So the
 * harness is either exported or that invariant has no gate.
 *
 * The narrow read is that this is a repo concern that a published consumer
 * will never call. The wider one is that someone writing a deformer in their
 * own project faces exactly the problem this solves, and has no other way to
 * solve it. Exported for the second reason; kept to five names for the first.
 */
export {
  runParityHarness,
  parityCases,
  PARITY_EPSILON,
  type ParityCase,
  type ParityResult,
} from './field/parity'

/**
 * The arithmetic behind `geometry.autoSegments`. Public because
 * `registerDeformer` is: a deformer someone else writes has to be able to
 * answer the same question the built-in seven answer, and the answer should
 * be the same formula rather than a guess at what the library does.
 */
export {
  AUTO_CEILING,
  FLAT_SEGMENTS,
  quantizeSegments,
  SAG_TOL,
  segmentsForArc,
  segmentsForSine,
  spanAlong,
} from './core/tessellation'

/**
 * Line breaking is exported because it is the answer to "where does this
 * wrap", and a caller measuring a block of type before laying a sheet out
 * has to get the same answer the painter will.
 */
export { wrapLines } from './content/type'
