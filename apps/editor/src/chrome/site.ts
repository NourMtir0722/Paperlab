/**
 * Where the sibling apps are, from wherever this one is mounted.
 *
 * The editor is served at `/editor/` in production and at `/` in dev, and the
 * routes beside it — `/playground/`, `/docs/`, `/hands/`, `/fx-lab/` — are siblings of
 * whichever it is. Deriving that from Vite's own base is what makes one href
 * correct in both places without a build-time branch or an absolute URL that
 * would break every local dev server and every preview deploy.
 *
 * `/hands` and `/fx-lab` are built from this same app with their own base, so
 * the base is stripped of whichever of the three this bundle was built for.
 *
 * It lives in its own file because several pieces of chrome need it, and the
 * regex is small enough that a second copy would look harmless and drift.
 */
export const SITE = import.meta.env.BASE_URL.replace(/(editor|hands|fx-lab)\/?$/, '')

/**
 * The editor itself. In dev it IS the site root — the dev server serves this
 * app at `/`, with `/hands/` and `/fx-lab/` as directories inside it — and
 * once deployed it sits at `/editor/` beside the others.
 */
export const EDITOR = import.meta.env.DEV ? SITE : `${SITE}editor/`
