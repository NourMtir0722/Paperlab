/**
 * Vite injects `import.meta.env` at build time. Declaring the shape we use
 * here (rather than relying on `vite/client` resolving through pnpm) keeps
 * this app's typecheck self-contained — the same choice the editor made.
 */
interface ImportMetaEnv {
  /** Deploy base, `/` in dev and the project-pages subpath in production. */
  readonly BASE_URL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
