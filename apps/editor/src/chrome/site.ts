/**
 * Where the sibling apps are, from wherever this one is mounted.
 *
 * The editor is served at `/editor/` in production and at `/` in dev, and the
 * routes beside it — `/playground/`, `/docs/`, `/hands/` — are siblings of
 * whichever it is. Deriving that from Vite's own base is what makes one href
 * correct in both places without a build-time branch or an absolute URL that
 * would break every local dev server and every preview deploy.
 *
 * It lives in its own file because two pieces of chrome now need it, and the
 * regex is small enough that a second copy would look harmless and drift.
 */
export const SITE = import.meta.env.BASE_URL.replace(/editor\/?$/, '')
