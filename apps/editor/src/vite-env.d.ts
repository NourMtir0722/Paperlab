/**
 * Vite injects `import.meta.env` at build time. Declaring the shape we use
 * here (rather than relying on `vite/client` resolving through pnpm) keeps
 * the editor's typecheck self-contained.
 */
interface ImportMetaEnv {
  readonly DEV: boolean
  readonly PROD: boolean
  readonly MODE: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
