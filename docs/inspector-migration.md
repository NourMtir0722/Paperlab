# leva → schema-native inspector (F9)

**Status:** done (2026-08-12). leva is gone from the repo.
**Audit ref:** F9 (Medium severity, Large effort) — the last open item on the
July punch list: "The editing surface is still leva — self-flagged as
pre-launch debt."

The right-hand inspector is now rendered by the app's own control set. This
document records the shape of what shipped; the plan it replaces is in git
history.

## What shipped

The hard part was already done before this migration: the inspector was never
hand-wired to leva. It was driven by a zod schema walk, and leva was only the
**renderer** of the descriptors that walk produced. So the migration kept the
walk and swapped the renderer.

| file | role |
| --- | --- |
| `controlModel.ts` | the renderer-neutral `Control` union + `schemaControls()`, the zod walk. No React, no DOM — a pure function from schema to descriptors. |
| `controlModel.test.ts` | 9 unit tests over the walk (min/max extraction, wrapper unwrapping, tuple expansion, nested folders, the skip list). |
| `controls.tsx` | the native control set: `Panel`, `Folder`, `NumberControl`, `SelectControl`, `ToggleControl`, `TextControl`, notes, buttons. |
| `styles.css` | `.control-*` rules, built from the chrome tokens already in the file. |

`Inspector.tsx`, `FieldInspector.tsx`, and `StageInspector.tsx` now each build
a `Control[]` and hand it to `<Panel>`. `zodLeva.ts` is deleted, and the
`leva` dependency is out of `apps/editor/package.json`.

## What got better along the way

- **The `ctx.initial` guard is gone.** Every leva handler early-returned on
  `ctx.initial` to avoid firing on mount. Native controls are controlled
  components: they render the value they're handed and call back only on real
  user input, so there is no initial-mount callback to suppress.
- **Duplicate leaf names work.** leva flattens a schema by leaf name and keeps
  the first of any duplicate, so a stage whose `shot` and `figure` both carry
  `height` silently lost one — and a folder that lost all of its controls
  vanished from the panel with no error. The whole `prefix`/`namespaced`/
  `labelled` apparatus existed to work around that. The `Control` tree keeps
  hierarchy, so the workaround is deleted and there is a test pinning the
  behavior.
- **`WriteOpts.structural` is gone.** It existed to force an inspector remount
  when the control *structure* changed (toggling deckle, swapping physics),
  because leva could not add or remove controls in place. The native panel
  derives its rows from the config on every render, so no remount is needed —
  and remounting would have been actively wrong, collapsing the folder the
  toggle lives in. `external` (the canvas changing values behind the panel's
  back, on handle-drag release) still bumps the epoch.
- **zustand is deduped again.** The editor kept a second copy of zustand
  because leva pinned v4 while the app uses v5. `vite.config.ts` now dedupes it.
- **The editor has a test runner.** It had none — pure helpers had to move
  into `packages/paperlab` to be tested. `apps/editor` now runs vitest, so
  editor-side logic can be tested where it lives.

## Interactions preserved

Label **drag-to-scrub** was the one leva interaction worth reproducing
faithfully — it's how you nudge a value while watching the canvas. Full range
sweeps in ~300px, hold shift for a 4× finer pass. The slider sweeps, and
clicking the readout types an exact value (Enter commits, Escape cancels).
Text commits on blur/Enter rather than per keystroke, because the canvas
rebuilds its content texture on every change.

## Verification

`pnpm typecheck` · `pnpm lint` · `pnpm test` (335 library + 9 editor) ·
`pnpm build` · `pnpm test:parity` 27/27 — all clean. The panel itself was
driven headless through a 12-point acceptance checklist (no callback on
mount, slider/scrub/typed edits, folder open-close under structural change,
behavior swap regenerating fields, sibling folders keeping duplicate leaf
names, textarea commit, and the sheet-layout guards from F5/F6), 12/12 with
no console errors.
