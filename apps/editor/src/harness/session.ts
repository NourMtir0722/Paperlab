import type { PaperEdge, WashConfig } from 'paperlab'
import type { SheetState, Squeeze } from './derive'
import type { Crease, PaperCorner, UV } from './marks'
import type { Roles } from './roles'
import { NO_ROLES } from './roles'

/**
 * Everything the page knows about the sheet and about the gesture in
 * progress, in one mutable object.
 *
 * The forty refs this replaces were not sloppiness. React state is far too
 * slow to touch per frame — a prop written sixty times a second re-renders
 * the tree that owns the canvas — and a ref was the available escape. But the
 * escape came with a tax that was paid at every single site: each value lived
 * TWICE, once in a ref the frame loop reads and once in React state the render
 * reads, and every change had to write both. Forty pairs of lines that must
 * agree, with nothing checking that they do.
 *
 * That tax is where the bugs live. A ref updated without its `setState` is a
 * sheet that has changed and does not redraw; a `setState` without its ref is
 * a frame loop reading last frame's answer and deciding twice. Both are
 * invisible until someone looks at the right frame.
 *
 * So: one object, written directly, with a version counter React subscribes
 * to. The frame loop mutates fields at the cost of a property assignment, the
 * component re-renders once per frame in which something actually changed,
 * and neither has to know about the other.
 *
 * **`bump` is deliberately not automatic.** A setter that invalidated on
 * every write would re-render on `gap`, on `roles`, on where the pointer is —
 * values that change every frame and that nothing renders. What earns a
 * re-render is a change to something `derive` reads, which is why those
 * fields go through {@link set} and the rest are plain properties.
 */
export class Session {
  // ── What the paper IS. Everything `derive` reads, and nothing else. ──────
  scale = 1
  stockIndex: number
  squeeze: Squeeze = 'none'
  fold = 0
  peel: PaperCorner | null = null
  thrown = false
  wind: number
  creases: Crease[] = []
  torn: PaperEdge[] = []
  ripped: PaperEdge[] = []
  wash: WashConfig | null = null

  // ── Frame-loop state. Read every frame, rendered never. ──────────────────
  /**
   * The crumple's progress.
   *
   * Not in the group above because it never goes through React at all: a
   * behavior's progress is what `ref.set()` is for, and routing it through a
   * render every frame would re-render the tree that owns the canvas for a
   * number the canvas is about to draw anyway.
   */
  crush = 0
  roles: Roles = NO_ROLES
  /** Whether the driving hand was pinching last frame. A peel is decided on the way in. */
  wasPinching = false
  /**
   * Whether the grab that is live right now actually landed on the paper.
   *
   * A snap of the fingers over empty space throws paint; the same snap with
   * the sheet in your hand throws the SHEET.
   */
  heldSheet = false
  /** A peel in progress: the corner it took hold of and where on screen. */
  peeling: { corner: PaperCorner; from: { x: number; y: number } } | null = null
  /** A score in progress: where the fingertip landed, and where it is now. */
  scoreFrom: (UV & { clientX: number; clientY: number }) | null = null
  scoreTo: UV | null = null
  /** Where the acting hand is on the canvas, for the score trail to follow. */
  scoreAt: { x: number; y: number } | null = null
  /** A grab in progress: the edge it started on, and where on screen. */
  grabEdge: PaperEdge | null = null
  grabOrigin: { x: number; y: number } | null = null
  /** Whether this grab has already torn something — one edge per grab. */
  grabTorn = false
  /** A two-handed pull in progress: how far apart the hands were, and the edge. */
  rip: { gap: number; edge: PaperEdge | null } | null = null
  /** How far apart the two hands are right now — reported, not decided on. */
  ripGap = 0
  /** A dial in progress: the roll the palm went up at, and the stock it was on. */
  dialFrom: { roll: number; index: number } | null = null
  /** Moved on every flick, because a wash is a pure function of its seed. */
  washSeed = 0
  washCount = 0
  /**
   * When the last frame was, in the page's own clock.
   *
   * The effects step in SECONDS — a damage field, a particle pool and a sound
   * all advance by a real interval — while everything else here is a pose read
   * off a frame. Null until the first frame, because the first interval is not
   * a number anyone knows.
   */
  frameAt: number | null = null
  /**
   * How long the flame has been held against one part of the sheet, in
   * seconds. Paper takes a moment to catch; a flame waved past leaves a mark
   * and no fire.
   */
  flameHeld = 0

  /** Bumped when something `derive` reads has changed. React watches this. */
  private revision = 0
  private readonly listeners = new Set<() => void>()

  constructor(options: { stockIndex: number; wind: number }) {
    this.stockIndex = options.stockIndex
    this.wind = options.wind
  }

  /**
   * Write a rendered field, and invalidate only if it actually changed.
   *
   * The comparison is the point. `wind` is recomputed from the breath every
   * frame and is usually the same number; writing it unconditionally would
   * re-render the canvas's tree sixty times a second to draw an identical
   * sheet. Arrays and objects compare by identity, which is correct here
   * because every one of them is replaced rather than mutated.
   */
  set<K extends keyof SheetSlice>(key: K, value: SheetSlice[K]): void {
    if (Object.is(this[key], value))
      return // `this[key] = value` is rejected because `this` is polymorphic — a
      // subclass could narrow the field. There are no subclasses and there will
      // not be; the assignment is the whole method.
    ;(this as SheetSlice)[key] = value
    this.revision++
    for (const listener of this.listeners) listener()
  }

  /** The snapshot React compares. Changes only when a rendered field does. */
  version = (): number => this.revision

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** What `derive` is handed. */
  sheet(stock: SheetState['stock']): SheetState {
    return {
      scale: this.scale,
      stock,
      squeeze: this.squeeze,
      fold: this.fold,
      peel: this.peel,
      thrown: this.thrown,
      wind: this.wind,
      creases: this.creases,
      torn: this.torn,
      ripped: this.ripped,
      wash: this.wash,
    }
  }

  /**
   * A fresh sheet: everything a hand did, undone.
   *
   * Distinct from what an open palm does, and the difference is the page's
   * whole feel. A palm puts the paper BACK — it undoes the poses the sheet is
   * being held in, a crush, a fold, a peel, a throw — and leaves alone the
   * things that HAPPENED to it, because no open palm un-tears a sheet. This
   * is the other one: the button that says start again, which undoes both.
   */
  reset(): void {
    this.thrown = false
    this.peel = null
    this.peeling = null
    this.heldSheet = false
    this.squeeze = 'none'
    this.fold = 0
    this.crush = 0
    this.scale = 1
    this.creases = []
    this.torn = []
    this.ripped = []
    this.wash = null
    this.washCount = 0
    // Whatever a hand was in the middle of belongs to the old sheet. The
    // button is pressed with a mouse, so a hand can easily still be
    // mid-gesture — and a half-drawn score, a half-pulled edge, a half-open
    // rip or a half-turned dial would otherwise finish against the fresh
    // one. A pinch still held starts over, as a pinch landing on new paper.
    this.wasPinching = false
    this.scoreFrom = null
    this.scoreTo = null
    this.scoreAt = null
    this.grabEdge = null
    this.grabOrigin = null
    this.grabTorn = false
    this.rip = null
    this.ripGap = 0
    this.dialFrom = null
    this.flameHeld = 0
    this.revision++
    for (const listener of this.listeners) listener()
  }
}

/** The fields a change to which has to reach React. */
type SheetSlice = Pick<
  Session,
  | 'scale'
  | 'stockIndex'
  | 'squeeze'
  | 'fold'
  | 'peel'
  | 'thrown'
  | 'wind'
  | 'creases'
  | 'torn'
  | 'ripped'
  | 'wash'
>
