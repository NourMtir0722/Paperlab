import type { AnyOptions, SheetDims } from '../deformers/types'
import type { Layout } from './layouts'
import { withSheetCellFromPaper, type SheetLayoutOptions } from './sheetGrid'

/**
 * Framing a field is arithmetic, not guesswork: layouts are pure `pose`
 * functions, so we can just ask one where all its sheets are and put the
 * camera where they all fit. Community layouts get framed for free.
 */

export interface FieldBounds {
  center: [number, number, number]
  /** Half-extents — the box reaches `center ± half`. */
  half: [number, number, number]
}

/** Cyclic layouts sweep as `phase` advances; frame the whole cycle, not one instant. */
const PHASE_SAMPLES = 8

/**
 * Resolve a layout's options the one way both the renderer and the camera
 * must agree on — sheet grids size their cells from the papers themselves.
 */
export function resolveLayoutOptions(
  layoutId: string,
  layout: Layout<AnyOptions>,
  propOptions: Record<string, unknown> | undefined,
  firstSheet: SheetDims | undefined,
): Record<string, unknown> {
  const parsed = layout.optionsSchema.parse({
    ...layout.defaults,
    ...propOptions,
  }) as Record<string, unknown>
  if (layoutId !== 'sheet') return parsed
  return withSheetCellFromPaper(
    parsed as unknown as SheetLayoutOptions,
    propOptions,
    firstSheet,
  ) as unknown as Record<string, unknown>
}

/**
 * The box `n` sheets occupy under a layout. Each sheet is treated as a ball
 * of its half-diagonal, which covers every rotation the pose can apply
 * without having to build the pose matrices.
 */
export function fieldBounds(
  layout: Layout<AnyOptions>,
  n: number,
  options: unknown,
  sheet: SheetDims,
): FieldBounds {
  const reach = Math.hypot(sheet.width, sheet.height) / 2
  if (n <= 0) return { center: [0, 0, 0], half: [reach, reach, 0] }

  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (let s = 0; s < PHASE_SAMPLES; s++) {
    for (let i = 0; i < n; i++) {
      const pose = layout.pose(i, n, options, s / PHASE_SAMPLES, sheet)
      const r = reach * Math.max(pose.scale, 0)
      for (let axis = 0; axis < 3; axis++) {
        min[axis] = Math.min(min[axis]!, pose.position[axis]! - r)
        max[axis] = Math.max(max[axis]!, pose.position[axis]! + r)
      }
    }
  }
  return {
    center: [(min[0]! + max[0]!) / 2, (min[1]! + max[1]!) / 2, (min[2]! + max[2]!) / 2],
    half: [(max[0]! - min[0]!) / 2, (max[1]! - min[1]!) / 2, (max[2]! - min[2]!) / 2],
  }
}

/** The field has always been viewed from a shade above eye level — keep that. */
const LIFT = 0.11
const DEG = Math.PI / 180

/**
 * Where to put a perspective camera so every sheet a layout poses lands in
 * frame. Solved per sheet at its own depth rather than against the field's
 * bounding box: a `ring`'s widest sheets sit at mid-depth, and pretending
 * that width exists at the near face would shove the camera far enough back
 * to lose the gallery entirely.
 */
export function fitCamera(
  layout: Layout<AnyOptions>,
  n: number,
  options: unknown,
  sheet: SheetDims,
  fovDeg: number,
  aspect: number,
  margin = 1.06,
): { position: [number, number, number]; target: [number, number, number] } {
  const { center } = fieldBounds(layout, n, options, sheet)
  const reach = (Math.hypot(sheet.width, sheet.height) / 2) * margin
  const vTan = Math.tan((fovDeg * DEG) / 2)
  const hTan = vTan * Math.max(aspect, 0.01)

  let distance = 0.1
  for (let s = 0; s < PHASE_SAMPLES; s++) {
    for (let i = 0; i < Math.max(n, 0); i++) {
      const pose = layout.pose(i, n, options, s / PHASE_SAMPLES, sheet)
      const r = reach * Math.max(pose.scale, 0)
      // Depth of this sheet in front of the field's center — a sheet further
      // back needs correspondingly less distance to fit.
      const depth = pose.position[2]! - center[2]!
      distance = Math.max(
        distance,
        (Math.abs(pose.position[0]! - center[0]!) + r) / hTan + depth,
        (Math.abs(pose.position[1]! - center[1]!) + r) / vTan + depth,
      )
    }
  }
  return {
    position: [center[0], center[1] + distance * LIFT, center[2] + distance],
    target: center,
  }
}
