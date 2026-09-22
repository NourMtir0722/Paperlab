import {
  mountObjectNames,
  mountSchema,
  mountStickerSchema,
  type MountConfig,
  type MountStickerConfig,
} from 'paperlab'
import { pickImageAsDataUrl, pickImagesAsDataUrls } from '../chrome/pickImage'
import { objectComingSoonNote, withOpenObject } from '../state/comingSoon'
import { button, folder, note, schemaControls, select, toggle, type Control } from '../controls/controlModel'

/** What the model row shows in place of a megabyte of base64. */
const UPLOADED_MODEL = 'your uploaded model'

/**
 * Past this a model is not worth carrying in a config: it stops fitting in a
 * saved session or a share link, and a sticker demo does not need a scan
 * that heavy. The picker says so rather than failing quietly later.
 */
const MAX_MODEL_BYTES = 12 * 1024 * 1024

/** A new sticker's longest side, against an object of the default size. */
const STICKER_SIDE = 0.26

/** Open a file picker for a .glb and read it into a data URL. */
export function pickModelAsDataUrl(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.glb,model/gltf-binary'
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) return resolve(null)
      if (file.size > MAX_MODEL_BYTES) {
        window.alert(
          `That model is ${(file.size / 1048576).toFixed(1)} MB. Keep it under 12 MB, or host it and paste its URL.`,
        )
        return resolve(null)
      }
      const reader = new FileReader()
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null)
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(file)
    }
    input.click()
  })
}

/** An image's width over its height, so a new sticker keeps the art's shape. */
function aspectOf(src: string): Promise<number> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img.width > 0 && img.height > 0 ? img.width / img.height : 1)
    img.onerror = () => resolve(1)
    img.src = src
  })
}

const DEG = Math.PI / 180
/** How far, in radians, a new sticker wants to be from its nearest neighbour. */
const CLEAR = 0.7

function direction(azimuth: number, elevation: number): [number, number, number] {
  const az = azimuth * DEG
  const el = elevation * DEG
  return [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)]
}

/**
 * The emptiest place on the object for one more sticker, as an azimuth and
 * an elevation.
 *
 * A spread of candidate directions over the object: the ones clear of the
 * stickers already there, and of those the one most facing the camera,
 * because a sticker added where nobody can see it reads as the button not
 * working. The ends are left alone: a lemon's poles are where the
 * stem and the nipple are, and a sticker does not lie flat there.
 */
export function freeSpot(taken: { azimuth: number; elevation: number }[]): {
  azimuth: number
  elevation: number
} {
  const dirs = taken.map((t) => direction(t.azimuth, t.elevation))
  let best = { azimuth: 0, elevation: 0 }
  let bestScore = -Infinity
  const golden = Math.PI * (3 - Math.sqrt(5))
  const n = 240
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n
    const r = Math.sqrt(1 - y * y)
    const x = Math.cos(golden * i) * r
    const z = Math.sin(golden * i) * r
    const elevation = Math.asin(y) / DEG
    if (Math.abs(elevation) > 58) continue
    let nearest = Math.PI
    for (const d of dirs) {
      nearest = Math.min(nearest, Math.acos(Math.max(-1, Math.min(1, d[0] * x + d[1] * y + d[2] * z))))
    }
    // Clear enough is clear: past about 40 degrees from its neighbours a spot
    // is as good as any, and then the one facing the camera most wins. Scored
    // on distance alone, the far side of the object is always the emptiest,
    // and every sticker went where nobody could see it.
    const score = Math.min(nearest, CLEAR) * 2 + z * 0.5
    if (score > bestScore) {
      bestScore = score
      best = { azimuth: Math.atan2(x, z) / DEG, elevation }
    }
  }
  return { azimuth: Math.round(best.azimuth), elevation: Math.round(best.elevation) }
}

/**
 * The stickers, up front: what they are stuck to, the one on the timeline,
 * and the rest of the collection.
 *
 * Its own section rather than a corner of the Mount panel, because this is
 * the part people come to change (their object, their art, as many stickers
 * as they want) and every one of them can be taken hold of and peeled.
 */
export function stickerControls(
  mount: MountConfig,
  set: (next: MountConfig, opts?: { external?: boolean }) => void,
  replaceMainArt: (src: string) => void,
): Control[] {
  const patch = (next: Partial<MountConfig>, opts?: { external?: boolean }) =>
    set({ ...mount, ...next }, opts)
  const setSticker = (i: number, next: MountStickerConfig, opts?: { external?: boolean }) =>
    patch({ stickers: mount.stickers.map((s, k) => (k === i ? next : s)) }, opts)

  // Your own object is closed for now (see `COMING_SOON_OBJECTS`): listed,
  // marked, and not choosable, and its upload button is not drawn.
  const object = objectComingSoonNote(mount.object) ? 'lemon' : mount.object
  const modelsOpen = !objectComingSoonNote('model')
  const objectRows: Control[] = [
    select(
      'object',
      object,
      [...mountObjectNames],
      (v) => {
        if (!objectComingSoonNote(v)) patch({ object: v as MountConfig['object'] }, { external: true })
      },
      undefined,
      objectComingSoonNote,
    ),
  ]
  if (modelsOpen) {
    objectRows.push(
      button(
        object === 'model' && mount.model ? 'replace the object (.glb)' : 'upload your object (.glb)',
        () => {
          void pickModelAsDataUrl().then((dataUrl) => {
            if (dataUrl) patch({ object: 'model', model: dataUrl }, { external: true })
          })
        },
      ),
    )
  }
  if (object === 'model') {
    objectRows.push(
      note(
        'model',
        !mount.model
          ? 'No model yet, so the lemon stands in.'
          : mount.model.startsWith('data:')
            ? UPLOADED_MODEL
            : mount.model,
      ),
    )
  }

  const addStickers = () => {
    void pickImagesAsDataUrls({ multiple: true }).then(async (urls) => {
      if (urls.length === 0) return
      const taken: { azimuth: number; elevation: number }[] = [
        { azimuth: mount.azimuth, elevation: mount.elevation },
        ...mount.stickers,
      ]
      const added: MountStickerConfig[] = []
      const side = STICKER_SIDE * (mount.size / 1.22)
      for (const src of urls) {
        const aspect = await aspectOf(src)
        const spot = freeSpot(taken)
        taken.push(spot)
        added.push(
          mountStickerSchema.parse({
            src,
            ...spot,
            roll: Math.round((Math.random() - 0.5) * 30),
            width: Number((aspect >= 1 ? side : side * aspect).toFixed(3)),
            height: Number((aspect >= 1 ? side / aspect : side).toFixed(3)),
            margin: 0.012,
          }),
        )
      }
      patch({ stickers: [...mount.stickers, ...added].slice(0, 16) }, { external: true })
    })
  }

  const stickerRows: Control[] = mount.stickers.map((sticker, i) =>
    folder(
      `Sticker ${i + 1}`,
      [
        button(
          'replace art',
          () => {
            void pickImageAsDataUrl().then((dataUrl) => {
              if (dataUrl) setSticker(i, { ...sticker, src: dataUrl }, { external: true })
            })
          },
          `sticker-${i}-upload`,
        ),
        ...schemaControls(
          mountStickerSchema,
          sticker as unknown as Record<string, unknown>,
          (key, value) => setSticker(i, { ...sticker, [key]: value } as MountStickerConfig),
          ['src'],
        ),
        button(
          'remove',
          () => patch({ stickers: mount.stickers.filter((_, k) => k !== i) }, { external: true }),
          `sticker-${i}-remove`,
        ),
      ],
      { collapsed: true, key: `mount-sticker-${i}` },
    ),
  )

  return [
    note(
      'peelHint',
      'Click any sticker and pull to peel it. Click the object to bring back the ones that flew away.',
    ),
    ...objectRows,
    button('replace the main sticker', () => {
      void pickImageAsDataUrl().then((dataUrl) => {
        if (dataUrl) replaceMainArt(dataUrl)
      })
    }),
    button(mount.stickers.length >= 16 ? 'sixteen is the most it holds' : 'add stickers', () => {
      if (mount.stickers.length < 16) addStickers()
    }),
    ...stickerRows,
    ...(mount.stickers.length > 0
      ? [button('remove every sticker', () => patch({ stickers: [] }, { external: true }))]
      : []),
  ]
}

/**
 * What the sheet is stuck to, and how it looks.
 *
 * A toggle first, like the backdrop, because `mount` is OPTIONAL and unset
 * means something: a sheet floating in space, which is every other preset.
 * The stickers themselves live in their own section, see `stickerControls`.
 */
export function mountControls(
  mount: MountConfig | undefined,
  set: (next: MountConfig | undefined, opts?: { external?: boolean }) => void,
): Control[] {
  const controls: Control[] = [
    toggle('mount', Boolean(mount), (on) => set(on ? mountSchema.parse({}) : undefined, { external: true })),
  ]
  if (!mount) return controls
  return [
    ...controls,
    // Size and lean, the skin, where the main sticker is stuck, and the glue.
    ...schemaControls(
      mountSchema,
      mount as unknown as Record<string, unknown>,
      (key, value) => set({ ...mount, [key]: value } as MountConfig),
      [
        'object',
        'model',
        'stickers',
        ...(withOpenObject({ mount }).mount!.object === 'lemon' ? [] : ['color', 'pores']),
      ],
    ),
  ]
}
