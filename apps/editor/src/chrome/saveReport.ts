import { confirmDialog, toast } from '../controls/ui'
import { downloadPreset } from '../state/userPresets'
import type { SaveOutcome } from '../state/store'

/**
 * Say what actually happened to a save.
 *
 * Every way into the preset store — Save preset, dropping a `.paper` file,
 * opening someone's link — ends here, so there is one account of a save and
 * not three that can disagree.
 *
 * The case this exists for is `session-only`. A preset that reaches the
 * registry but not localStorage is live, editable and completely convincing
 * until the tab closes, and it used to report itself as a plain "Saved".
 * Storage runs out for an ordinary reason now that any sheet can carry an
 * uploaded image: a data URL is ~100KB and up, and a handful of them clears
 * the quota. Being told "Saved" and then losing the work is the failure
 * shape worth spending a dialog on, and the dialog carries the same escape
 * hatch a refused share does — the `.paper` file, which has no quota.
 */
export function reportSave(outcome: SaveOutcome): void {
  if (!outcome.ok) {
    toast(outcome.error, 'error')
    return
  }
  const { name, config, storage } = outcome
  if (storage === 'session-only') {
    void confirmDialog({
      title: 'Saved, but not to disk',
      message: `"${name}" is live and editable, but this browser's storage is full — it will not survive a reload. Download the .paper file to keep it.`,
      confirmLabel: 'Download .paper',
    }).then((ok) => {
      if (ok) downloadPreset(name, config)
    })
  } else if (storage === 'thumbnails-dropped') {
    // Not worth a dialog: nothing was lost but the pictures on the preset
    // list, and they are regenerated on the next save that fits.
    toast(`Saved "${name}" — storage is nearly full, so preset thumbnails were dropped`, 'info')
  } else {
    toast(`Saved "${name}"`, 'success')
  }
}
