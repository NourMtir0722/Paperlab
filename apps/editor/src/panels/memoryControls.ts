import {
  creaseSchema,
  getStock,
  MAX_CREASES,
  MAX_SET,
  spanAlong,
  type CreaseConfig,
  type MemoryConfig,
  type SheetConfig,
  type StockName,
} from 'paperlab'
import { button, folder, note, num, numberRange, type Control } from '../controls/controlModel'

/**
 * The Memory panel: how much of a fold this paper keeps, and the creases it
 * is currently keeping.
 *
 * Built by hand rather than generated, for the reason the light panel is:
 * `set` is an OVERRIDE. Unset it means "whatever this stock is made of", and
 * a generated slider has no way to say that — it would read a missing value
 * as zero and show every paper as perfectly elastic, which is the one thing
 * memory exists to stop being true.
 *
 * The crease rows are the other half, and they are why this is worth a panel
 * at all. Creases arrive by folding the paper, and once here they are
 * ordinary config: draggable, removable, saved into a preset, carried down a
 * share link. A dog-ear nobody folded is a crease typed in by hand.
 */
export function memoryControls(
  memory: MemoryConfig,
  stockName: StockName,
  sheet: SheetConfig,
  patch: (patch: { set?: number; creases?: CreaseConfig[] }) => void,
): Control[] {
  const stock = getStock(stockName)
  const creases = memory.creases
  const resolved = memory.set ?? stock.takesSet

  const setCrease = (index: number, next: Partial<CreaseConfig>) =>
    patch({ creases: creases.map((c, i) => (i === index ? { ...c, ...next } : c)) })

  const controls: Control[] = [
    num('set', resolved, { min: 0, max: 1, step: 0.01 }, (v) => patch({ set: v })),
    memory.set === undefined
      ? note(
          'setNote',
          `${stock.label.toLowerCase()} keeps this much on its own — move it and it becomes yours`,
        )
      : button('reset to stock', () => patch({ set: undefined }), 'setReset'),
  ]

  creases.forEach((crease, i) => {
    controls.push(
      folder(
        `crease ${i + 1}`,
        [
          // Depth first: it is the one that reads as "how creased is this",
          // and the other two are where rather than how much.
          num('depth', crease.depth, { ...DEPTH, step: 0.5, label: 'depth°' }, (v) =>
            setCrease(i, { depth: v }),
          ),
          num(
            'angle',
            crease.angle,
            { ...numberRange(creaseSchema, 'angle'), step: 1, label: 'angle°' },
            (v) => setCrease(i, { angle: v }),
          ),
          num('offset', crease.offset, offsetRange(crease, sheet), (v) => setCrease(i, { offset: v })),
          button('remove', () => patch({ creases: creases.filter((_, k) => k !== i) }), `remove-${i}`),
        ],
        { collapsed: true, key: `crease-${i}` },
      ),
    )
  })

  if (creases.length < MAX_CREASES) {
    controls.push(
      button('add crease', () => patch({ creases: [...creases, creaseSchema.parse({})] }), 'addCrease'),
    )
  }

  if (creases.length > 0) {
    controls.push(button('flatten', () => patch({ creases: [] }), 'flatten'))
  } else {
    // Silence here would read as a panel that does nothing. It says what the
    // paper is waiting for, which is the only instruction the feature needs.
    controls.push(note('creaseNote', 'fold the paper and its creases land here'))
  }

  return controls
}

/**
 * How deep a crease the track can scrub to — a range, not the schema's limit.
 *
 * `creaseSchema` allows the full ±180 a fold angle can be, and folding cannot
 * get anywhere near it: the deepest crease any paper records is `180 × MAX_SET`,
 * which is 36°. A track spanning 360 gives every crease this editor can
 * actually make a fifth of its travel, and the useful part of that fifth is a
 * few pixels wide.
 *
 * So the range is the recordable maximum with headroom for a hand-authored
 * dog-ear, and `num` widens it to contain the current value — a preset or a
 * shared link carrying a 120° crease gets a track that reaches it, rather than
 * one that clamps it to 45 the moment anybody touches the slider.
 */
const DEPTH = { min: -Math.round(180 * MAX_SET) - 10, max: Math.round(180 * MAX_SET) + 10 }

/**
 * Where along its own direction a crease line can sit and still be ON the
 * sheet.
 *
 * The schema's ±20 is the outer bound for any sheet the library allows; this
 * sheet is 1.4 tall, so 97% of that track moves the crease somewhere it cannot
 * be seen. Half the span in the crease's own direction is exactly the edge of
 * the paper — measured along the fold's travel, because that is what `offset`
 * is measured along.
 */
function offsetRange(crease: CreaseConfig, sheet: SheetConfig): { min: number; max: number; step: number } {
  const half = spanAlong(sheet, crease.angle) / 2
  return { min: -half, max: half, step: half / 100 }
}
