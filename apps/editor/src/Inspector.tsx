import { useControls, folder } from 'leva'

/** leva's Schema type lives behind `leva/plugin`, which doesn't bundle cleanly — recover it from `folder`. */
type LevaSchema = Parameters<typeof folder>[0]

import { stockNames, type ContentConfig, type StockName } from 'paperlab'
import { useEditor } from './store'

/**
 * Inspector of the selection. Bootstrapped on leva for v0 — replaced by the
 * schema-generated custom panel before public launch. Remounted (keyed) on
 * preset switch so control defaults follow the preset.
 */
export function Inspector() {
  const config = useEditor((s) => s.config)
  const patchConfig = useEditor((s) => s.patchConfig)

  useControls(
    {
      Sheet: folder({
        width: {
          value: config.sheet.width,
          min: 0.2,
          max: 4,
          step: 0.05,
          onChange: (v: number, _, ctx) => ctx.initial || patchConfig({ sheet: { width: v } }),
        },
        height: {
          value: config.sheet.height,
          min: 0.2,
          max: 4,
          step: 0.05,
          onChange: (v: number, _, ctx) => ctx.initial || patchConfig({ sheet: { height: v } }),
        },
      }),
      Stock: folder({
        stock: {
          value: config.stock,
          options: [...stockNames],
          onChange: (v: StockName, _, ctx) => ctx.initial || patchConfig({ stock: v }),
        },
      }),
      Content: folder(contentControls(config.content, patchConfig)),
    },
    [config.stock, config.content.type],
  )

  return null
}

function contentControls(
  content: ContentConfig,
  patchConfig: (p: { content: ContentConfig }) => void,
): LevaSchema {
  if (content.type === 'text') {
    return {
      text: {
        value: content.text,
        rows: 4,
        onChange: (v: string, _: unknown, ctx: { initial: boolean }) =>
          ctx.initial || patchConfig({ content: { ...content, text: v } }),
      },
      size: {
        value: content.size,
        min: 12,
        max: 128,
        step: 1,
        onChange: (v: number, _: unknown, ctx: { initial: boolean }) =>
          ctx.initial || patchConfig({ content: { ...content, size: v } }),
      },
    }
  }
  if (content.type === 'image') {
    return {
      src: {
        value: content.src,
        onChange: (v: string, _: unknown, ctx: { initial: boolean }) =>
          ctx.initial || patchConfig({ content: { ...content, src: v } }),
      },
    }
  }
  return {}
}
