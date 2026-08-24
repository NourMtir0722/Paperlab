/**
 * Read local files into self-contained data URLs, downscaled so they stay
 * serializable — presets live in localStorage and travel in exports.
 *
 * Extracted when stage mode learned to hang pictures: the Content inspector
 * already had this, and a second copy of a downscaler is a second answer to
 * "how big is an uploaded image", which is the number that decides whether a
 * paper fits in a share link or a preset survives a reload.
 */

/** Longest edge, in px. Past this an upload stops being worth its bytes. */
const MAX_EDGE = 1024

function readOne(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(img.width * scale))
      canvas.height = Math.max(1, Math.round(img.height * scale))
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(url)
      // PNG keeps transparency (die-cut stickers); photos go JPEG.
      resolve(
        file.type === 'image/png' || file.type === 'image/webp'
          ? canvas.toDataURL('image/png')
          : canvas.toDataURL('image/jpeg', 0.85),
      )
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(null)
    }
    img.src = url
  })
}

/**
 * Open the file picker and read what comes back.
 *
 * Files that will not decode resolve to null and are dropped rather than
 * failing the batch — someone picking twelve banners and one screenshot of a
 * PDF should get eleven banners, not an error and nothing.
 */
export function pickImagesAsDataUrls(opts: { multiple?: boolean } = {}): Promise<string[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.multiple = Boolean(opts.multiple)
    input.onchange = () => {
      const files = [...(input.files ?? [])]
      if (files.length === 0) return resolve([])
      void Promise.all(files.map(readOne)).then((urls) =>
        resolve(urls.filter((url): url is string => url !== null)),
      )
    }
    input.click()
  })
}

export async function pickImageAsDataUrl(): Promise<string | null> {
  const [first] = await pickImagesAsDataUrls()
  return first ?? null
}
