import { useState } from 'react'
import { SITE } from './site'

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
 * It used to send them to the playground, which was a real answer while
 * there was a playground: one input, one scene, good on a phone. That route
 * is gone — it was built for testing and it was quietly collecting most of
 * the site's traffic — so the card is now the same one the site root shows a
 * phone, and it does three things in this order:
 *
 * 1. **Say the tool wants a laptop**, plainly, as the first thing. Nobody is
 *    being sent somewhere worse in the hope they do not notice.
 * 2. **Give them something that is worth a phone**: who makes this, what is
 *    coming, and how to put a tool in the build. All three read fine on a
 *    small screen, which the editor does not.
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

export function SmallScreen() {
  const [dismissed, setDismissed] = useState(false)
  return (
    <section className={`small-screen${dismissed ? ' dismissed' : ''}`} aria-label="Small screen">
      <div className="small-screen-card">
        <p className="small-screen-kicker">
          Paperlab <span className="beta">beta</span>
        </p>
        <a className="small-screen-maker" href="https://x.com/noormtir" target="_blank" rel="noreferrer">
          <img src={`${import.meta.env.BASE_URL}noor.jpg`} alt="" width={40} height={40} />
          <span>
            <strong>I'm @noormtir</strong>
            <small>I made paperlab</small>
          </span>
        </a>
        <h1>paperlab is made for a laptop.</h1>
        <p>
          It is a canvas tool, with presets on the left, settings on the right, and a sheet in the middle you
          shape by dragging a handle on the paper. That does not fit on a phone, and I would rather say so
          than pretend it does.
        </p>
        <a className="small-screen-go" href={`${SITE}lab-notes/#sponsor`}>
          Sponsor paperlab →
        </a>
        <p className="small-screen-note">
          paperlab grows one piece at a time, and I build it in public. See what is next, or put your tool in
          the build.
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
