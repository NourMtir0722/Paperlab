# Migration plan: leva → schema-native inspector (F9)

**Status:** planned, not started.
**Audit ref:** F9 (Medium severity, Large effort) — "The editing surface is still
leva — self-flagged as pre-launch debt."

The right-hand inspector (`Inspector.tsx`, `FieldInspector.tsx`) is generated onto
[leva](https://github.com/pmndrs/leva). Leva's look and interaction model clash with
the app's custom dark chrome, and the code says so:

> Bootstrapped on leva for v0 — replaced by the schema-generated custom panel
> before public launch. — `Inspector.tsx:23`

This is the largest remaining item on the punch list. It is deliberately **not** bundled
with the other fixes: it touches every control in the app, so it wants its own branch and
its own review. This doc is the plan so it can be scheduled, not rushed.

## Why it's tractable

The hard part is already done. The inspector is **not** hand-wired to leva — it's driven
by `schemaControls()` in `zodLeva.ts`, which walks a zod schema and emits a control
descriptor per field:

| zod type            | control        |
| ------------------- | -------------- |
| `ZodNumber` (min/max checks) | slider    |
| `ZodEnum`           | select         |
| `ZodBoolean`        | toggle         |
| `ZodString`         | text input     |
| number `ZodTuple`   | one slider/axis |

Behaviors, layouts, and physics all carry their own zod schema, so they already get
editor UI "for free." Leva is only the **renderer** of those descriptors. The migration
is: keep the schema-walk, swap the renderer.

## The shape of the work

1. **Define a renderer-neutral control model.** Today `schemaControls()` returns leva's
   `LevaSchema` shape (`{ value, min, max, step, options, onChange }`). Introduce an
   internal `Control` union (`number | enum | boolean | string | vector | folder | button`)
   that `schemaControls()` emits instead. This is the seam that decouples us from leva.

2. **Build the native control set** against that model, matching the existing chrome
   (`styles.css` tokens: panel `#222327`, border `#3a3b40`, accent `#4f7cff`, muted
   `#8b8a86`). Components needed:
   - `NumberControl` — label + drag-scrub value + slider (leva's number-drag is the one
     interaction worth reproducing faithfully).
   - `SelectControl`, `ToggleControl`, `TextControl`, `VectorControl` (n sliders),
     `FolderControl` (collapsible group), `ButtonControl`.
   - A `<Panel>` wrapper that lays folders out and owns spacing/scroll.

3. **Replace the leva plumbing.** `Inspector.tsx` / `FieldInspector.tsx` currently call
   `useControls(...)` on a per-mount `useCreateStore()` (own store so preset switches
   don't leak stale values — the remount-by-key trick in `App.tsx`). Replace with a
   plain controlled render of the `Control` tree; the store per-mount concern disappears
   because state already lives in zustand (`store.ts`), not in leva.

4. **Preserve behavior parity — the acceptance checklist:**
   - [ ] `ctx.initial` guard equivalent: first render must not fire `onChange` (today every
         handler early-returns on `ctx.initial`). The native version simply renders from
         props and only calls back on user input, which is cleaner.
   - [ ] Remount-on-external-edit still works: `inspectorEpoch` bumps on handle drags /
         transport commits (`App.tsx` keys the inspector on it). Native controls read
         `value` from props, so they update without a remount — but keep the key for now.
   - [ ] State-editing mode: edits still route through `patchConfig`, which `writeConfig()`
         funnels into the active state's override diff. The renderer swap must not touch
         this path (it's below the inspector).
   - [ ] Number tuples (flight's wind vector) render one slider per axis.
   - [ ] Buttons (`addZone`, per-zone `remove`, and the new F7 `Replace all →`).
   - [ ] The F6 read-only `sheetNote` line (an `editable: false` string today) becomes a
         plain caption in the native model.

5. **Delete leva.** Remove the dependency from `apps/editor/package.json`, drop
   `LevaPanel`/`useControls`/`folder`/`button` imports, delete the leva-shaped type
   `LevaSchema`. Update the `Inspector.tsx:23` comment.

## Testing

The editor has no test runner (pure helpers live in `paperlab` and are tested there).
So:

- Extract `schemaControls()` → the neutral `Control` model as a **pure function** and move
  its test into `packages/paperlab` (or a new `apps/editor` vitest setup). This is the one
  piece with real logic (min/max extraction, tuple expansion, unwrapping defaults).
- The renderer itself is verified by driving the app (`/run`) and exercising each control
  type against a preset that uses it.

## Sequencing

Ship behind nothing — it's an internal surface, no API change. Suggested order so `main`
stays green at each step:

1. Land the neutral `Control` model + its unit tests (leva still renders, adapting from the
   new model). No visible change.
2. Land the native renderer behind a flag / side-by-side, dogfood it.
3. Flip the default, delete leva, update the comment.

Estimated: the renderer is the bulk; the schema-walk is a small refactor. Plan for a
focused block, not an afternoon.
