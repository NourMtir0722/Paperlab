import { useRef, useState } from 'react'
import { isBuiltinPreset, listPresets, parsePreset } from 'paperlab'
import { useEditor } from '../state/store'
import { downloadPreset } from '../state/userPresets'
import { confirmDialog, promptDialog, toast } from '../controls/ui'
import { Select } from '../controls/Select'
import { reportSave } from '../chrome/saveReport'

/**
 * The preset library: built-ins (duplicate to fork) and user presets
 * (rename / duplicate / download / delete). Drop a .paper JSON anywhere on
 * the panel to import it.
 */
export function PresetPanel() {
  const presetName = useEditor((s) => s.presetName)
  const userPresets = useEditor((s) => s.userPresets)
  const setPreset = useEditor((s) => s.setPreset)
  const duplicatePreset = useEditor((s) => s.duplicatePreset)
  const deletePreset = useEditor((s) => s.deletePreset)
  const renamePreset = useEditor((s) => s.renamePreset)
  const importPreset = useEditor((s) => s.importPreset)

  const fileRef = useRef<HTMLInputElement>(null)
  const [dropping, setDropping] = useState(false)

  const builtinNames = listPresets().filter(isBuiltinPreset)
  const userNames = Object.keys(userPresets)

  const importFiles = async (files: FileList | null) => {
    for (const file of files ?? []) {
      reportSave(importPreset(await file.text()))
    }
  }

  const rename = async (name: string) => {
    const next = await promptDialog({
      title: 'Rename preset',
      defaultValue: name,
      confirmLabel: 'Rename',
      validate: (v) =>
        !v || v === name ? null : isBuiltinPreset(v) || userPresets[v] ? `"${v}" is already taken.` : null,
    })
    if (!next || next === name) return
    const error = renamePreset(name, next)
    if (error) toast(error, 'error')
  }

  const remove = async (name: string) => {
    const ok = await confirmDialog({
      title: `Delete "${name}"?`,
      message: 'This preset will be removed from your library. This cannot be undone.',
      confirmLabel: 'Delete',
      danger: true,
    })
    if (ok) deletePreset(name)
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: drop is a pointer-only enhancement; the Import button below opens the same file picker for keyboards.
    <div
      className={dropping ? 'preset-panel dropping' : 'preset-panel'}
      onDragOver={(e) => {
        e.preventDefault()
        setDropping(true)
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDropping(false)
        void importFiles(e.dataTransfer.files)
      }}
    >
      <h2>Presets</h2>
      <div className="preset-picker">
        <Select
          className="preset-select"
          label="Choose a built-in preset"
          // A user preset is open, so no built-in is selected. The list is
          // still the built-ins; the trigger says so rather than showing a
          // name that is not in it.
          value={builtinNames.includes(presetName) ? presetName : ''}
          options={builtinNames.includes(presetName) ? builtinNames : ['', ...builtinNames]}
          format={(name) => name || 'Pick a preset…'}
          onChange={(name) => name && setPreset(name)}
        />
        <button
          type="button"
          className="row-action"
          title="Duplicate as editable fork"
          aria-label="Duplicate the selected preset as an editable fork"
          onClick={() => duplicatePreset(builtinNames.includes(presetName) ? presetName : builtinNames[0]!)}
        >
          ⧉
        </button>
      </div>

      <h2>
        Your presets
        <button
          type="button"
          className="row-action"
          title="Import .paper JSON"
          aria-label="Import a .paper JSON file"
          onClick={() => fileRef.current?.click()}
        >
          ⬆
        </button>
      </h2>
      <input
        ref={fileRef}
        type="file"
        accept=".json,.paper"
        multiple
        hidden
        onChange={(e) => void importFiles(e.target.files)}
      />
      {userNames.length === 0 && <p className="hint">Save a sculpt, or drop a .paper file here.</p>}
      <ul className="presets user-presets">
        {userNames.map((name) => {
          const stored = userPresets[name]!
          return (
            <li key={name} className="preset-row user">
              <button
                type="button"
                className={name === presetName ? 'active preset-card' : 'preset-card'}
                onClick={() => setPreset(name)}
              >
                {stored.thumbnail && <img src={stored.thumbnail} alt="" />}
                <span>{name}</span>
              </button>
              <span className="row-actions">
                <button
                  type="button"
                  className="row-action"
                  title="Rename"
                  aria-label={`Rename ${name}`}
                  onClick={() => rename(name)}
                >
                  ✎
                </button>
                <button
                  type="button"
                  className="row-action"
                  title="Duplicate"
                  aria-label={`Duplicate ${name}`}
                  onClick={() => duplicatePreset(name)}
                >
                  ⧉
                </button>
                <button
                  type="button"
                  className="row-action"
                  title="Download .paper JSON"
                  aria-label={`Download ${name} as .paper JSON`}
                  onClick={() => downloadPreset(name, parsePreset(stored.config))}
                >
                  ⬇
                </button>
                <button
                  type="button"
                  className="row-action danger"
                  title="Delete"
                  aria-label={`Delete ${name}`}
                  onClick={() => remove(name)}
                >
                  ✕
                </button>
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
