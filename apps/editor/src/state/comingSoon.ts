/**
 * Built-in presets the editor lists but will not open yet — greyed out and
 * marked "Coming soon". The library still ships them and the docs still
 * render them: this is the editor's door, not the package's.
 *
 * One list, read by every place a preset can be chosen or come back: the
 * Paper tab's picker, the Field tab's slots and its "replace all with", the
 * store's `setPreset`, and the session a returning visitor is restored into.
 * `comingSoon.test.ts` fails if a name here stops being a real preset, or if
 * a preset the editor falls back to is ever closed.
 */
export const COMING_SOON: ReadonlySet<string> = new Set(['paper-roll', 'toilet-roll', 'paper-ribbon'])

/** Whether the editor keeps this preset closed for now. */
export function isComingSoon(name: string): boolean {
  return COMING_SOON.has(name)
}

/** For a picker: the note printed beside an option, or null if it can be chosen. */
export function comingSoonNote(name: string): string | null {
  return isComingSoon(name) ? 'Coming soon' : null
}

/**
 * What a sticker can be stuck to, in the editor, for now: the lemon. The
 * library still takes any `.glb` as `mount.model` and the upload code is all
 * still here; a model someone hands the editor is not yet laid up well
 * enough to put in front of people, so the door is closed. Delete the name
 * from this set to open it again.
 */
export const COMING_SOON_OBJECTS: ReadonlySet<string> = new Set(['model'])

/** For the object picker: the note beside a closed object, or null. */
export function objectComingSoonNote(object: string): string | null {
  return COMING_SOON_OBJECTS.has(object) ? 'Coming soon' : null
}

/**
 * The config the editor draws, with any closed object put back to the
 * lemon: a session restored from before the door closed, or a link or a
 * `.paper` carrying a model, still opens on something the editor offers.
 */
export function withOpenObject<T extends { mount?: { object: string } | undefined }>(config: T): T {
  const mount = config.mount
  if (!mount || !COMING_SOON_OBJECTS.has(mount.object)) return config
  return { ...config, mount: { ...mount, object: 'lemon' } }
}
