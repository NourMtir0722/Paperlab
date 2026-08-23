import { z } from 'zod'
import type { PaperEdge } from '../config/schema'
import type { CurlOptions } from '../deformers/curl'

/**
 * Pure grid math for the `sheet` layout — a block of stamps on a shared
 * backing. Shared by the layout's pose function, the backing silhouette
 * renderer, the outward-corner smart default, and the torn-perforation
 * auto-wiring, so they can never disagree about where a slot sits.
 */

export const sheetLayoutSchema = z.object({
  rows: z.number().int().min(1).max(12).default(2),
  columns: z.number().int().min(1).max(12).default(5),
  /** World-units gap between slots. Stamps are printed in register — no jitter. */
  gutter: z.number().min(0).max(1).default(0.08),
  /** Slot footprint in world units (the paper preset should match). */
  cellWidth: z.number().min(0.1).max(4).default(0.72),
  cellHeight: z.number().min(0.1).max(4).default(0.86),
  /** Render the shared backing sheet behind the grid. */
  backing: z.boolean().default(true),
  backingMargin: z.number().min(0).max(1).default(0.12),
})

export type SheetLayoutOptions = z.infer<typeof sheetLayoutSchema>

/** Backing thickness + ε — papers float just above the backing sheet. */
export const SHEET_LIFT = 0.012

/**
 * Cell footprint = the paper's own sheet dims unless the user set an
 * explicit cellWidth/cellHeight — so `gutter` is literally the spacing
 * between stamps, whatever preset populates the grid.
 */
export function withSheetCellFromPaper(
  parsed: SheetLayoutOptions,
  rawOptions: Record<string, unknown> | undefined,
  paperDims: { width: number; height: number } | undefined,
): SheetLayoutOptions {
  if (!paperDims) return parsed
  const hasW = rawOptions !== undefined && rawOptions.cellWidth !== undefined
  const hasH = rawOptions !== undefined && rawOptions.cellHeight !== undefined
  if (hasW && hasH) return parsed
  return {
    ...parsed,
    cellWidth: hasW ? parsed.cellWidth : paperDims.width,
    cellHeight: hasH ? parsed.cellHeight : paperDims.height,
  }
}

export function sheetSlotXY(i: number, o: SheetLayoutOptions): { x: number; y: number } {
  const col = i % o.columns
  const row = Math.floor(i / o.columns)
  return {
    x: (col - (o.columns - 1) / 2) * (o.cellWidth + o.gutter),
    y: ((o.rows - 1) / 2 - row) * (o.cellHeight + o.gutter),
  }
}

/** Grid bounds + margin — the backing sheet's size. */
export function sheetBackingSize(o: SheetLayoutOptions): { width: number; height: number } {
  return {
    width: o.columns * o.cellWidth + (o.columns - 1) * o.gutter + o.backingMargin * 2,
    height: o.rows * o.cellHeight + (o.rows - 1) * o.gutter + o.backingMargin * 2,
  }
}

type Corner = CurlOptions['corner']

/**
 * The corner facing away from the sheet's center — what a thumb would find.
 * A tie (an odd grid's exact-center row/column, where the
 * cell straddles the midline) breaks outward-and-down: strict `<` on both
 * axes sends the center right and down, so a dead-center cell peels
 * bottom-right — the standalone peel default.
 */
export function outwardCorner(i: number, o: Pick<SheetLayoutOptions, 'rows' | 'columns'>): Corner {
  const col = i % o.columns
  const row = Math.floor(i / o.columns)
  // Row 0 renders at the top of the grid.
  const horizontal = col + 0.5 < o.columns / 2 ? 'left' : 'right'
  const vertical = row + 0.5 < o.rows / 2 ? 'top' : 'bottom'
  return `${vertical}-${horizontal}` as Corner
}

/**
 * Perforation auto-wiring on detach: edges that faced a neighboring slot tear
 * through; edges on the sheet's outer boundary keep their clean punches.
 */
export function tornEdgesOnDetach(
  i: number,
  o: Pick<SheetLayoutOptions, 'rows' | 'columns'>,
): Partial<Record<PaperEdge, 'torn' | 'intact'>> {
  const col = i % o.columns
  const row = Math.floor(i / o.columns)
  return {
    top: row > 0 ? 'torn' : 'intact',
    bottom: row < o.rows - 1 ? 'torn' : 'intact',
    left: col > 0 ? 'torn' : 'intact',
    right: col < o.columns - 1 ? 'torn' : 'intact',
  }
}
