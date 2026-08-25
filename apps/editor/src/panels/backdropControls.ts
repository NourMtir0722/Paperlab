import { backdropSchema, type BackdropConfig } from 'paperlab'
import { pickImageAsDataUrl } from '../chrome/pickImage'
import { button, folder, schemaControls, text, toggle, type Control } from '../controls/controlModel'

/** What the `image` field shows in place of a 200KB base64 string. */
const UPLOADED = '(uploaded image)'

/**
 * What is behind the sheet.
 *
 * A toggle rather than a folder of always-on sliders, because the backdrop
 * is OPTIONAL in the schema and unset means "leave the canvas alone" — the
 * same shape `surface.deckle` and `content.wash` already have. An unset
 * optional object drawn by the schema walk reads as a black backdrop that is
 * switched on, which is a different thing from no backdrop at all.
 *
 * Shared by Paper and Field. Stage is deliberately not offered one: it has a
 * room, with a ground and walls and a light at the end of it, and a flat
 * picture pinned behind all that is two backgrounds arguing.
 */
export function backdropControls(
  backdrop: BackdropConfig | undefined,
  set: (next: BackdropConfig | undefined, opts?: { external?: boolean }) => void,
): Control[] {
  const controls: Control[] = [
    toggle('backdrop', Boolean(backdrop), (on) =>
      set(on ? backdropSchema.parse({}) : undefined, { external: true }),
    ),
  ]
  if (!backdrop) return controls

  return [
    ...controls,
    folder('Backdrop', [
      text(
        'image',
        backdrop.image.startsWith('data:') ? UPLOADED : backdrop.image,
        (v) => {
          // Editing the mask itself would replace the picture with the words.
          if (v !== UPLOADED) set({ ...backdrop, image: v })
        },
        { hint: 'a URL, or upload a file below' },
      ),
      button('upload backdrop', () => {
        void pickImageAsDataUrl().then((dataUrl) => {
          // external → the inspector remounts and the field shows the mask.
          if (dataUrl) set({ ...backdrop, image: dataUrl }, { external: true })
        })
      }),
      // `image` is the field above; the rest is colour, fit, fade and blur.
      ...schemaControls(
        backdropSchema,
        backdrop as unknown as Record<string, unknown>,
        (key, value) => set({ ...backdrop, [key]: value } as BackdropConfig),
        ['image'],
      ),
    ]),
  ]
}
