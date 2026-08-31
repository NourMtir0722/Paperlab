import {
  creaseSchema,
  getStock,
  MAX_CREASES,
  type CreaseConfig,
  type MemoryConfig,
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
  patch: (patch: { set?: number; creases?: CreaseConfig[] }) => void,
): Control[] {
  const stock = getStock(stockName)
  const creases = memory.creases
  const resolved = memory.set ?? stock.takesSet
  const range = (key: 'angle' | 'offset' | 'depth') => numberRange(creaseSchema, key)

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
          num('depth', crease.depth, { ...range('depth'), step: 0.5, label: 'depth°' }, (v) =>
            setCrease(i, { depth: v }),
          ),
          num('angle', crease.angle, { ...range('angle'), step: 1, label: 'angle°' }, (v) =>
            setCrease(i, { angle: v }),
          ),
          num('offset', crease.offset, { ...range('offset'), step: 0.01 }, (v) =>
            setCrease(i, { offset: v }),
          ),
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
