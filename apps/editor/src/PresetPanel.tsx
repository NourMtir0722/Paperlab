import { useRef, useState } from 'react'
import { isBuiltinPreset, listPresets, parsePreset } from 'paperlab'
import { useEditor } from './store'
import { downloadPreset } from './userPresets'

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
      const error = importPreset(await file.text())
      if (error) alert(error)
    }
  }

  const rename = (name: string) => {
    const next = prompt('Rename preset', name)
    if (!next) return
    const error = renamePreset(name, next)
    if (error) alert(error)
  }

  return (
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
      <ul className="presets">
        {builtinNames.map((name) => (
          <li key={name} className="preset-row">
            <button className={name === presetName ? 'active' : ''} onClick={() => setPreset(name)}>
              {name}
            </button>
            <button className="row-action" title="Duplicate as editable fork" onClick={() => duplicatePreset(name)}>
              ⧉
            </button>
          </li>
        ))}
      </ul>

      <h2>
        Your presets
        <button className="row-action" title="Import .paper JSON" onClick={() => fileRef.current?.click()}>
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
                className={name === presetName ? 'active preset-card' : 'preset-card'}
                onClick={() => setPreset(name)}
              >
                {stored.thumbnail && <img src={stored.thumbnail} alt="" />}
                <span>{name}</span>
              </button>
              <span className="row-actions">
                <button className="row-action" title="Rename" onClick={() => rename(name)}>
                  ✎
                </button>
                <button className="row-action" title="Duplicate" onClick={() => duplicatePreset(name)}>
                  ⧉
                </button>
                <button
                  className="row-action"
                  title="Download .paper JSON"
                  onClick={() => downloadPreset(name, parsePreset(stored.config))}
                >
                  ⬇
                </button>
                <button
                  className="row-action danger"
                  title="Delete"
                  onClick={() => confirm(`Delete "${name}"?`) && deletePreset(name)}
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
