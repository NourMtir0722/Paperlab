---
"paperlab": minor
---

Fix: the props now accept what the docs say they accept, and `surface` is finally one of them.

Two bugs, same root. `<Paper surface={{ grain: 0.3 }} />` was documented in the README, `AGENTS.md` and `docs/llms.txt` and was **not a prop at all** — it failed to typecheck, and in plain JS `resolveConfig` dropped it on the floor, so the effect you asked for silently never happened. And `content`, `behavior`, `deformers` and `physics` took each schema's *parsed* type rather than its *input* type, which demanded every field of every nested object: the README's own example — `content={{ type: 'receipt', store: 'acme.dev', items: [...] }}` — did not compile.

Both are fixed. `surface` and `scene` are real props now (surface merges over the stock's defaults rather than replacing them, so `surface={{ grain: 0.6 }}` on thermal keeps thermal's banding), and every config prop takes the schema's input type, so anything with a default stays optional. The schema now exports both types for each config — `ContentConfigInput`, `BehaviorConfigInput`, `SurfaceConfigInput`, `PhysicsConfigInput`, `DeformerInstanceConfigInput`, `SceneConfigInput` — and `config/props.test.ts` pins the documented examples at both the type level and at runtime, so a prop cannot quietly go back to an inferred type.

No runtime behaviour changes for code that already compiled, except that a `surface` prop now actually applies.
