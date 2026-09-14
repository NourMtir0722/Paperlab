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
