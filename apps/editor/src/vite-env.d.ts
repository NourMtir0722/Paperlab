/**
 * Vite injects `import.meta.env` at build time. Declaring the shape we use
 * here (rather than relying on `vite/client` resolving through pnpm) keeps
 * the editor's typecheck self-contained.
 */
interface ImportMetaEnv {
  readonly DEV: boolean
  readonly PROD: boolean
  readonly MODE: string
  /** Deploy base, `/` in dev and `/editor/` under project pages. */
  readonly BASE_URL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/**
 * `tools/fx-refs.mjs`, imported by `vite.config.ts` so the dev server and
 * `pnpm test:fire-look` look for the fire references in exactly one place.
 *
 * Declared here because the tools are plain `.mjs` with no types and this app
 * is the only TypeScript that reaches into them. A wildcard rather than a
 * relative path: the specifier is `../../tools/fx-refs.mjs` from the config
 * and would be something else from anywhere else.
 */
declare module '*/fx-refs.mjs' {
  /** The fire stills, or null when they are not on this machine. */
  export function fireRefsDir(): string | null
  /** The directory holding one folder per effect. */
  export function fxRefsDir(): string
  /** The one sentence to print when they are missing. */
  export const NO_REFS: string
}
