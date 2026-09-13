import { EDITOR, SITE } from './site'

/**
 * The five surfaces of Paperlab, as one switch: Paper, Field and Stage are the
 * editor's own modes; Hands and FX Lab are routes of their own.
 *
 * They were two outlined links in the editor's top-right corner, opening in a
 * new tab, and the pages they led to had no way back at all. That made them
 * look like somewhere else rather than like the rest of the tool — which is
 * what they are: the same sheet, burnt with a camera or tuned in a lab.
 *
 * The routes stay separate builds (a CSP of their own on `/hands`, 35 MB of
 * tracker nobody else should download), so crossing between the two halves is
 * a page load. The editor remembers its session across it (state/session.ts),
 * and `?mode=` puts you back on the tab you picked.
 *
 * Inside the editor its own three are buttons; everywhere else they are links
 * to it. The surface you are on is never a link to itself.
 */

type EditorMode = 'paper' | 'field' | 'stage'
type Surface = EditorMode | 'hands' | 'fx-lab'

/** The query that opens the editor on a mode, from a page that is not the editor. */
export const MODE_PARAM = 'mode'

const EDITOR_MODES: { id: EditorMode; label: string }[] = [
  { id: 'paper', label: 'Paper' },
  { id: 'field', label: 'Field' },
  { id: 'stage', label: 'Stage' },
]

const ROUTES: { id: Surface; label: string; href: string; title: string }[] = [
  {
    id: 'hands',
    label: 'Hands',
    href: `${SITE}hands/`,
    title:
      'Set fire to the paper with your webcam — hold a lighter up to it, or pinch and hold still to strike a match',
  },
  {
    id: 'fx-lab',
    label: 'FX Lab',
    href: `${SITE}fx-lab/`,
    title: 'Effects on paper and every knob behind them — tune one and copy it out as JSON',
  },
]

export function ModeTabs({ current, onMode }: { current: Surface; onMode?: (mode: EditorMode) => void }) {
  return (
    <nav className="mode-switch" aria-label="Paperlab">
      {EDITOR_MODES.map(({ id, label }) =>
        onMode ? (
          <button
            type="button"
            key={id}
            className={current === id ? 'active' : ''}
            aria-current={current === id ? 'page' : undefined}
            onClick={() => onMode(id)}
          >
            {label}
          </button>
        ) : (
          <a key={id} href={`${EDITOR}?${MODE_PARAM}=${id}`}>
            {label}
          </a>
        ),
      )}
      {ROUTES.map(({ id, label, href, title }) =>
        current === id ? (
          <span key={id} className="active" aria-current="page">
            {label}
          </span>
        ) : (
          <a key={id} href={href} title={title}>
            {label}
          </a>
        ),
      )}
    </nav>
  )
}
