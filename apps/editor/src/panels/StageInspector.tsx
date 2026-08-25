import { getLayout, listLayouts } from 'paperlab'
import { qualityNames, stageBanner, stageSchema, walkNames } from 'paperlab/stage'
import {
  button,
  folder,
  note,
  num,
  schemaControls,
  select,
  text,
  type Control,
} from '../controls/controlModel'
import { Panel } from '../controls/controls'
import { useEditor, type StageState } from '../state/store'
import { pickImagesAsDataUrls } from '../chrome/pickImage'
import { lightControls } from './lightControls'

/**
 * Stage mode inspector: Content / Walk / Arrangement / Light / Stage /
 * Performance.
 *
 * Everything under Stage is generated straight from `stageSchema`, nested
 * folders and all — same contract as behaviors and layouts. Three things it
 * does by hand are the three the schema cannot express well: the walk is
 * offered as named shapes rather than as a points array, the text is a
 * paragraph rather than a slider, and the light is a set of OVERRIDES, whose
 * unset fields have no value for a generated slider to show.
 */
export function StageInspector() {
  const stage = useEditor((s) => s.stage)
  const patchStage = useEditor((s) => s.patchStage)
  const patchStageConfig = useEditor((s) => s.patchStageConfig)

  const layout = getLayout(stage.layout)
  const layoutValues = { ...layout.defaults, ...stage.layoutOptions } as Record<string, unknown>
  const stageValues = stageSchema.parse(stage.config) as unknown as Record<string, unknown>

  const controls: Control[] = [
    folder('Content', contentControls(stage, patchStage)),
    folder('Walk', [
      select('shape', stage.walk, [...walkNames], (v) => patchStage({ walk: v as never })),
      num(
        'progress',
        stage.progress,
        // Playing hands the walk to the clock; the scrubber only drives it
        // while paused, so a live slider would fight the animation.
        { min: 0, max: 1, step: 0.001, disabled: stage.playing },
        (v) => patchStage({ progress: v }),
      ),
    ]),
    folder('Arrangement', [
      select('layout', stage.layout, listLayouts(), (v) => patchStage({ layout: v, layoutOptions: {} })),
      // `path` is skipped: the Walk folder owns it, and the stage always
      // wins over whatever the layout carries so the two cannot disagree.
      ...schemaControls(
        layout.optionsSchema,
        layoutValues,
        (key, value) => patchStage({ layoutOptions: { ...stage.layoutOptions, [key]: value } }),
        ['path'],
      ),
    ]),
    folder('Light', lightControls(stageValues, patchStageConfig)),
    folder(
      'Stage',
      // `lighting` and `light` are the Light folder's; `path` is the Walk's.
      schemaControls(stageSchema, stageValues, (key, value) => patchStageConfig({ [key]: value }), [
        'path',
        'lighting',
        'light',
      ]),
    ),
    folder('Performance', [
      select('quality', stage.quality, [...qualityNames], (v) =>
        patchStage({ quality: v as never, settled: null }),
      ),
      // Quality describes the DEVICE, not the artwork — it is deliberately
      // not in the stage schema, so it never travels in a preset or a link.
      note(
        'qualityNote',
        stage.quality === 'auto'
          ? `adapting — now at ${stage.settled ?? 'medium'}`
          : 'fixed: this is what that tier looks like everywhere',
      ),
    ]),
  ]

  return <Panel controls={controls} />
}

/**
 * What a drop is SHAPED like.
 *
 * "How many banners" was already askable and "how wide is one" was not, so
 * every stage was the same 1.5 × 8.5 drop however it was arranged — and the
 * difference between a colonnade of ribbons and a hall of curtains is not
 * the count, it is the cut. Named rather than offered as two sliders,
 * because the useful values are a handful of proportions and the space
 * between them is mostly stages that look like a mistake.
 *
 * Everything but the dimensions comes from `stageBanner`: the stock, the
 * grain and the drape are what make it read as hung cloth-like paper rather
 * than as a board, and they do not change with the cut.
 */
const BANNER_SHAPES: Record<string, { width: number; height: number }> = {
  ribbon: { width: 0.6, height: 9 },
  banner: { width: 1.5, height: 8.5 },
  curtain: { width: 3.4, height: 8 },
  panel: { width: 2.4, height: 3.6 },
}

function shapeOf(stage: StageState): string {
  const sheet = (stage.paper ?? stageBanner).sheet
  const found = Object.entries(BANNER_SHAPES).find(
    ([, dims]) => dims.width === sheet?.width && dims.height === sheet?.height,
  )
  // A stage preset may hang something none of these names describes, and
  // renaming it "banner" in the select would be a lie the next edit acts on.
  return found?.[0] ?? 'custom'
}

/**
 * The Content folder: what the banners carry, and what shape they are.
 *
 * Words already worked and pictures already worked — `<PaperStageScene>` has
 * taken an `images` array all along — but the editor only ever passed the
 * text, so half the mode was unreachable from the app built to drive it.
 *
 * Words and pictures are a CHOICE rather than two fields that both apply,
 * because the scene resolves them in a fixed order and having both set means
 * one of them silently does nothing. The count follows the same rule: words
 * are split across however many banners you ask for, and pictures go one per
 * drop, so with pictures loaded the count is the picture count and the
 * slider would be a control that argues with the array above it.
 */
function contentControls(stage: StageState, patchStage: (patch: Partial<StageState>) => void): Control[] {
  const controls: Control[] = [
    select('source', stage.source, ['words', 'images'], (v) =>
      patchStage({ source: v as StageState['source'] }),
    ),
  ]

  if (stage.source === 'words') {
    controls.push(
      text('text', stage.text, (v) => patchStage({ text: v }), { rows: 4 }),
      num('banners', stage.count, { min: 2, max: 60, step: 1 }, (v) => patchStage({ count: Math.round(v) })),
    )
  } else {
    controls.push(
      button('add pictures', () => {
        void pickImagesAsDataUrls({ multiple: true }).then((added) => {
          if (added.length > 0) patchStage({ images: [...stage.images, ...added] })
        })
      }),
      stage.images.length > 0
        ? note('imageCount', `${stage.images.length} hanging — one per banner, in the order added`)
        : note('imageCount', 'No pictures yet — the banners hang blank until you add some.'),
    )
    if (stage.images.length > 0) {
      controls.push(
        button('remove last', () => patchStage({ images: stage.images.slice(0, -1) }), 'removeLast'),
        button('remove all', () => patchStage({ images: [] }), 'removeAll'),
        // Said where it is found out, not in a summary somewhere: an upload
        // is the one thing in this panel the session deliberately forgets.
        note('imageMemory', 'Pictures are not remembered after a reload — export the code to keep them.'),
      )
    }
  }

  controls.push(
    select('shape', shapeOf(stage), [...Object.keys(BANNER_SHAPES), 'custom'], (v) => {
      const dims = BANNER_SHAPES[v]
      if (!dims) return
      const base = stage.paper ?? stageBanner
      patchStage({ paper: { ...base, sheet: { ...base.sheet, ...dims } } })
    }),
  )

  return controls
}
