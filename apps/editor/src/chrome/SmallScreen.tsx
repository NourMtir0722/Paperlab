import { useState } from 'react'

/**
 * What a phone gets instead of the editor.
 *
 * The editor is a three-rail canvas tool: a preset library, a viewport you
 * sculpt by dragging a handle on the mesh, and an inspector. On a 390px
 * screen the inspector is simply off the right-hand edge — the page scrolls
 * sideways to a panel nobody knows is there, and the one gesture the whole
 * tool is built around is a precise drag on a 12px target. It is not close
 * to working, and no arrangement of breakpoints makes it close.
 *
 * So this says so. The rule it is built to: **broken with a message is
 * acceptable, broken in silence is not.** Launch traffic is majority mobile,
 * and a visitor who taps "Editor" and gets a half-drawn tool that scrolls
 * sideways learns something wrong about the library.
 *
 * Three things it has to do, in this order:
 *
 * 1. **Send them somewhere that works.** The playground is the front door,
 *    it is one input and one scene, and it is genuinely good on a phone.
 *    Telling someone to come back later without giving them anything to do
 *    now is how you lose them.
 * 2. **Say what the editor is**, so the thing they are being asked to come
 *    back for sounds worth it.
 * 3. **Let them in anyway.** A hard wall is a lie about capability — the
 *    editor does run, it is just cramped — and someone on a tablet, or
 *    someone who simply wants to look, should not be stopped by a
 *    breakpoint. The escape hatch costs one line and buys back all the
 *    honesty a gate spends.
 *
 * Shown and hidden by a media query rather than by measuring the window in
 * JS: there is no resize listener to leak, no first-paint flash of the wrong
 * one, and rotating a tablet into landscape reveals the editor with no code
 * involved at all.
 */

/** Sibling apps, from this one's base path — `/editor/` in production, `/` in dev. */
const SITE = import.meta.env.BASE_URL.replace(/editor\/?$/, '')

export function SmallScreen() {
  const [dismissed, setDismissed] = useState(false)
  return (
    <section className={`small-screen${dismissed ? ' dismissed' : ''}`} aria-label="Small screen">
      <div className="small-screen-card">
        <p className="small-screen-kicker">Paperlab</p>
        <h1>The editor wants a bigger screen.</h1>
        <p>
          It is a canvas tool — a preset library on the left, an inspector on the right, and a sheet in the
          middle you sculpt by dragging a handle on the paper itself. That does not fold down to a phone
          honestly, so we are not pretending it does.
        </p>
        <a className="small-screen-go" href={SITE}>
          Open the playground instead →
        </a>
        <p className="small-screen-note">
          One input, one scene, and it works properly on this screen. Type anything and the room is built out
          of it.
        </p>
        <div className="small-screen-links">
          <a href={`${SITE}docs/`}>Read the docs</a>
          <button type="button" onClick={() => setDismissed(true)}>
            Show me the editor anyway
          </button>
        </div>
      </div>
    </section>
  )
}
