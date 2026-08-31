import { paperConfigSchema, type PaperConfig, type PaperConfigInput } from '../schema'

/**
 * Built-in `.paper` presets. A preset is the serialized closure of one Paper —
 * the unit of saving, sharing, and code export. Stored as plain JSON-safe
 * objects, validated on access.
 */
const builtins: Record<string, PaperConfigInput> = {
  'receipt-unroll': {
    meta: { name: 'Receipt unroll', tags: ['receipt', 'unroll', 'hero'] },
    sheet: { width: 1, height: 2.6 },
    stock: 'thermal',
    content: {
      type: 'receipt',
      store: 'nawwara.studio',
      address: '124 Paper St',
      items: [
        { name: 'Curl, true', price: 12 },
        { name: 'Roll, tight', price: 8.5 },
        { name: 'Sheet, one', price: 0.99 },
      ],
      timestamp: '11.07.2026 18:42',
    },
    behavior: { type: 'unroll', progress: 0.55, tightness: 0.55, sway: 0.3 },
    surface: { deckle: { edges: ['bottom'], roughness: 0.6 } },
  },
  /**
   * A roll on a holder with a leaf already out, meant to be driven by scroll:
   * bind `behavior.progress` to how far down the page you are and the paper
   * pays out while the roll runs down toward its tube.
   *
   * The three parts that make it read as a real roll rather than a curled
   * sheet: `fixed` keeps the roll on its holder and moves the paper instead,
   * `tail` means there is always a leaf to take hold of, and `floor` gives
   * the drop somewhere to land — paper that reaches the ground creases and
   * lies down rather than hanging into the void forever. A `core` a third of
   * the full radius is a real cardboard tube, so the roll still looks like a
   * roll after it has been used down.
   */
  'paper-roll': {
    meta: { name: 'Paper roll', tags: ['roll', 'unroll', 'scroll', 'hero'] },
    sheet: { width: 1, height: 5 },
    stock: 'newsprint',
    content: { type: 'blank' },
    behavior: {
      type: 'unroll',
      progress: 0.25,
      tightness: 0.8,
      sway: 0.15,
      from: 'top',
      fixed: true,
      core: 0.12,
      tail: 0.5,
      floor: 2.4,
    },
    surface: { deckle: { edges: ['bottom'], roughness: 0.5 } },
  },
  /**
   * The one that is a SIMULATION rather than a shape.
   *
   * `paper-roll` above draws this same object with a deformer stack, and for
   * a roll paying out against a wall that is the cheaper and better answer.
   * This preset exists for the half that geometry cannot reach: what happens
   * once the paper hits the ground. A deformer can bend a sheet along a curve
   * you have already chosen; it cannot discover that a strip under
   * compression buckles at its weakest hinge, and it cannot let one fold land
   * on the one beneath it. Both of those are what a pile IS.
   *
   * Bind `physics.scroll` to the page and the roll turns:
   *
   * ```tsx
   * const [scroll, setScroll] = useState(0)
   * useEffect(() => {
   *   const onScroll = () => setScroll(window.scrollY / 120)
   *   window.addEventListener('scroll', onScroll, { passive: true })
   *   return () => window.removeEventListener('scroll', onScroll)
   * }, [])
   * <Paper preset="toilet-roll" physics={{ type: 'strip', scroll }} />
   * ```
   *
   * It is a MONOTONIC world-unit number, not a 0..1 progress — the sim
   * differentiates it, so scrolling back up rewinds the roll and drags the
   * pile taut before it lifts.
   *
   * The proportions are the real object's: a panel as wide as it is long, so
   * `perforation` equals the sheet width and the strip tears into squares.
   */
  'toilet-roll': {
    meta: { name: 'Toilet roll', tags: ['roll', 'scroll', 'simulation', 'hero'] },
    // The proportions are a real roll's, at the scale the library is viewed
    // at: `<Paper>` and the editor both look at the origin through about two
    // world units and neither fits a camera to its content, so the whole
    // composition — roll, drop and pile — has to live inside that. A panel is
    // as wide as it is long and the roll is about a panel across, which is
    // what a toilet roll is.
    //
    // Twenty-three panels of paper. Not a real roll's several hundred, but
    // enough that a full page of scrolling does not empty it: one scroll unit
    // is about one unit of paper on a fresh roll, so this is a couple of
    // screens' worth before the tube shows.
    sheet: { width: 0.6, height: 14 },
    stock: 'printer',
    content: { type: 'blank' },
    physics: {
      type: 'strip',
      scroll: 0,
      // Wound tightly enough to hold this much paper at a believable size: the
      // outer radius lands at 0.61 of the panel width against a real roll's
      // 0.57, over about nine visible turns.
      //
      // `tightness` is doing double duty and the trade is worth knowing about.
      // A layer gap IS the paper's thickness, so it also sets how far apart
      // self-collision holds two folds — wind tighter for a neater roll and
      // the pile on the floor gets flatter, looser for a fatter pile and the
      // roll coarsens. This is the middle of that.
      //
      // It is ALSO the roll's rim, and that is the reason not to raise it on
      // looks alone. A layer gap is a real space between two wound turns, so
      // the roll's end face is concentric rings with nothing between them,
      // and off head-on you see between them — a fine sawtooth around the
      // rim that winding tighter genuinely reduces. It was tried. Tightening
      // to 0.78 also moves the roll's proportion to 0.553 of a panel width,
      // nearer a real roll's 0.57 than this is, so it looked like a free win
      // — and it throws the pile 1.33 units out in x against the 0.874 a
      // square parent can see, spreading 5.9 panel-widths. Framing beats the
      // rim. The sawtooth is what a roll wound from ONE zero-thickness
      // ribbon costs; it is not tuned away, and a caller who wants it gone
      // wants a thicker `stock` or fewer, fatter turns.
      tightness: 0.65,
      // A real cardboard tube, and a floor on how tight the spiral ever winds.
      // The innermost wrap is the coarsest thing in the roll — the same
      // arc-length step spans a bigger angle the smaller the radius — so the
      // core is what stops a nearly-empty roll turning back into a polygon.
      core: 0.12,
      // A panel and a half already hanging. A roll on a holder always has a
      // leaf out; starting from a bare cylinder reads as one still wrapped.
      tail: 0.9,
      perforation: 0.6,
      // The four numbers below were chosen TOGETHER, and by worst case rather
      // than by a good-looking run. A pile is chaotic: change `crease` by
      // 0.05 and one 14-second scroll can spread 2.0 panel-widths of floor or
      // 4.2, so a single trajectory is a sample and not a measurement. These
      // are scored over nine — three scroll depths crossed with three feed
      // rates — on how far the composition ever gets from the origin.
      //
      // What that fixed: the shipped set spread 2.9 panel-widths on average
      // and 4.0 at worst, and threw paper 1.60 units out in z. It ran off the
      // side of the frame and kept going. These hold 2.2 average, 2.8 worst,
      // and 1.09 out — while keeping the pile's height (about ten layers)
      // intact, which is the thing all of this exists to show.
      //
      // The most load-bearing of them. Below about 0.6 the landed paper flops
      // over in flat panels and runs away across the floor instead of folding
      // back; high is what makes the perforations hold and the pile
      // accordion. A used roll remembering its creases is the whole effect.
      crease: 0.9,
      // Low enough that a panel buckles rather than steering the pile: at 0.5
      // the sheet was stiff enough to push the folds already down along the
      // floor ahead of it, which is what "spreads across four panels" was.
      stiffness: 0.4,
      // High: paper is light and broad, and this is what separates it from a
      // rope hanging off a drum. It also damps the sideways travel that
      // carried the pile out of frame.
      drag: 0.85,
      gravity: 1,
      // The drop, measured from the roll's axis. Together with the roll's own
      // radius this IS the height of the composition, which is centred on the
      // origin — so keep their sum under about 1.7 or the roll and the pile
      // fall outside the ~1.75 units `<Paper>`'s fixed camera can see.
      //
      // Shortened from 1.2, and it is the single most effective number here:
      // a longer fall is more airtime for the strip to pick a direction and
      // glide, so it landed still travelling and slid. Worst-case spread goes
      // 4.2 panel-widths to 3.1 and the pile keeps its full depth. It buys
      // vertical room as well, which is what lets the roll sit further up.
      floor: 0.85,
      inertia: 0.5,
    },
    surface: { grain: 0.25 },
    // The preset is unreadable without this, and that is not a figure of
    // speech: the strip sim folds in DEPTH, and every camera in the library
    // is fixed and head-on, so `<Paper preset="toilet-roll" />` framed the
    // roll end-on and the entire accordion edge-on and rendered a blank white
    // column. This is the three-quarter view the pile actually reads from —
    // enough to see along the folds and around the roll's rim, not so much
    // that the strip's face turns away.
    //
    // The ceiling is framing, not taste. Turning swaps the pile's DEPTH for
    // WIDTH, and depth is free — the camera has plenty — while width is not.
    // Measured over fifteen scroll trajectories the pile reaches 1.27 units
    // of depth at worst, and `halfWidth·cos θ + 1.27·sin θ` crosses the 0.874
    // half-view a square parent gets at 28°. Twenty-five leaves real margin
    // (0.809) and gives up almost nothing of the angle.
    //
    // Do not raise it without re-measuring that depth: the two numbers are
    // coupled, and the pile's depth is not stable under small changes to the
    // physics — see the note on `floor`.
    //
    // A parent narrower than square still crops the pile's far edge. That is
    // the honest limit of a fixed camera, and the caller's answer is their
    // own `rotation` prop, which this composes with rather than overrides.
    scene: { turn: 25 },
  },
  'letter-fold': {
    meta: { name: 'Letter fold', tags: ['fold', 'text'] },
    sheet: { width: 1, height: 1.4 },
    stock: 'printer',
    content: {
      type: 'text',
      text: 'Dear you,\n\nSome things are worth folding carefully.\n\nYours,\nN.',
    },
    behavior: { type: 'letter-fold', progress: 0.4, crease: 0.3 },
    surface: { creaseLines: { angle: 0, positions: [1 / 3, 2 / 3], strength: 0.5 } },
  },
  /**
   * The wash, shown rather than described.
   *
   * A `wash` is a field on every content type, which means it is reachable
   * from any preset and discoverable from none — a toggle three folders down
   * is not an argument for the feature. This is the argument: type set over
   * paint, on cotton, deckled, with the paper still showing through both.
   */
  'washed-letter': {
    meta: { name: 'Washed letter', tags: ['wash', 'text'] },
    // Printer stock, not vellum: vellum is translucent and takes the room's
    // grey through the back of the sheet, which turns a wash the colour of
    // dishwater. Pigment needs something white behind it.
    sheet: { width: 1.05, height: 1.45 },
    stock: 'printer',
    content: {
      type: 'text',
      text: 'Painted first,\nwritten after.',
      font: 'Georgia, "Times New Roman", serif',
      size: 52,
      valign: 'center',
      align: 'center',
      wash: { color: '#5b6f9a', secondary: '#c08a86', blooms: 6, spread: 0.85, intensity: 0.5, seed: 3 },
    },
    behavior: { type: 'peel', progress: 0.12, corner: 'bottom-right', radius: 0.3 },
    surface: { grain: 0.35, deckle: { edges: ['bottom', 'right'], roughness: 0.45 } },
  },
  'vintage-note': {
    meta: { name: 'Vintage note', tags: ['aging', 'text'] },
    sheet: { width: 1.1, height: 1.4 },
    stock: 'newsprint',
    content: {
      type: 'text',
      text: 'FOUND, ONE PAPER ENGINE.\n\nReward if returned to the web.',
      font: 'Georgia, serif',
      size: 40,
    },
    behavior: { type: 'peel', progress: 0.18, corner: 'top-right', radius: 0.22 },
    surface: { aging: 0.55, grain: 0.6, deckle: { edges: ['top', 'bottom'], roughness: 0.4 } },
  },
  'hero-peel': {
    meta: { name: 'Hero peel', tags: ['peel', 'card', 'hero'] },
    sheet: { width: 1.5, height: 1 },
    stock: 'photo-gloss',
    // Was a live Unsplash URL — a third-party network fetch inside one of
    // the first things anybody renders, which fails offline, behind a proxy,
    // under a strict CSP, and on the day the URL changes. The demo here is
    // the PEEL; the photograph was incidental, and a typeset card is both
    // self-contained and more on-brand for a paper library.
    content: {
      type: 'card',
      title: 'Print no. 4',
      body: 'Lift the corner.',
      note: 'Gloss, 240gsm',
      align: 'center',
    },
    behavior: { type: 'peel', progress: 0.35, corner: 'bottom-right', radius: 0.16 },
  },
  'page-flip': {
    meta: { name: 'Page flip', tags: ['flip', 'text'] },
    sheet: { width: 1, height: 1.4 },
    stock: 'printer',
    content: {
      type: 'text',
      text: 'Chapter One\n\nIt was a paper town, and everything in it folded.',
    },
    behavior: { type: 'flip', progress: 0.3, spine: 'left', radius: 0.3 },
  },
  'hanging-poster': {
    meta: { name: 'Hanging poster', tags: ['hang', 'text', 'wind'] },
    sheet: { width: 1.1, height: 1.55 },
    stock: 'printer',
    // Also de-Unsplashed. A poster is a typographic object anyway — every
    // paper installation worth the name hangs WORDS — so this shows off the
    // tracking and the optical centring rather than someone else's photo.
    content: {
      type: 'text',
      text: 'THE\nPAPER\nSHOW',
      size: 96,
      align: 'center',
      valign: 'center',
      tracking: 0.08,
      lineHeight: 1.15,
    },
    behavior: { type: 'hang', wind: 0.45, sag: 0.3 },
  },
  'pinned-sheet': {
    meta: { name: 'Pinned sheet', tags: ['cloth', 'wind', 'interactive'] },
    sheet: { width: 1.2, height: 1.5 },
    stock: 'printer',
    content: {
      type: 'text',
      text: 'Grab me.\n\n(cloth: pinned at the top edge,\nwind from the left)',
      size: 40,
    },
    physics: { type: 'cloth', pins: 'top-edge', wind: 0.45, stiffness: 0.8, gravity: 1, floor: -1.4 },
  },
  'flying-note': {
    meta: { name: 'Flying note', tags: ['fly', 'tumble', 'text'] },
    sheet: { width: 1, height: 0.7 },
    stock: 'printer',
    content: {
      type: 'text',
      text: 'meet me where\nthe paper lands',
      size: 52,
      align: 'center',
      padding: 0.16,
    },
    behavior: { type: 'fly', flutter: 0.55, curve: 0.45 },
    physics: 'tumble',
  },
  'blank-sheet': {
    meta: { name: 'Blank sheet', tags: ['starter'] },
    stock: 'printer',
  },
  // The driving use case: one stamp of the 2×5 block. Hover peels the
  // outward-facing corner ('auto' resolves per sheet slot), pressing deepens
  // the peel; the perforation tears when it detaches (field auto-wiring).
  'postage-stamp': {
    meta: { name: 'Postage stamp', tags: ['sticker', 'stamp', 'states', 'sheet'] },
    sheet: { width: 0.64, height: 0.78, thickness: 0.08 },
    stock: 'sticker',
    // No `src`: a stamp's art is the caller's, and the library ships no
    // assets and fetches none. The perforation, the sticker stock and the
    // peel — which is what this preset is actually here to demonstrate —
    // all read perfectly well on bare stock.
    content: { type: 'image', fit: 'cover', alt: 'A postage stamp' },
    behavior: { type: 'peel', progress: 0, corner: 'auto', radius: 0.12 },
    surface: { perforation: { edges: 'all', holeRadius: 0.014, spacing: 0.05 } },
    states: {
      initial: 'rest',
      states: {
        hover: {
          overrides: { behavior: { progress: 0.22 } },
          transition: { duration: 0.25, ease: 'power2.out' },
        },
        pressed: {
          overrides: { behavior: { progress: 0.5 } },
          transition: { duration: 0.16, ease: 'power3.out' },
        },
        // Picked is auto-choreographed at pick time (carry hanging from the
        // peeled corner); placed announces itself for a host postmark overlay.
        placed: { overrides: {}, onEnter: ['emit:postmark'] },
      },
      pickThreshold: 0.08,
    },
  },
  'photo-print': {
    meta: { name: 'Photo print', tags: ['image', 'starter'] },
    sheet: { width: 1.2, height: 0.9 },
    stock: 'photo-gloss',
    // Same: the field starter is a CONTAINER. Its whole documented use is
    // `<PaperField images={photos} preset="photo-print" />`, where the
    // photographs are the caller's.
    content: { type: 'image', fit: 'cover', alt: 'A photographic print' },
    // No print lies perfectly flat. A shade of bow is the whole difference
    // between a sheet of paper and a rectangle — and since this is the field
    // starter, it is what a layout's per-sheet bias has to scale.
    deformers: [{ type: 'bend', options: { curvature: 0.35, angle: 0 } }],
  },
  'crumpled-note': {
    meta: { name: 'Crumpled note', tags: ['crumple', 'text', 'handled'] },
    sheet: { width: 1.1, height: 1.4 },
    stock: 'printer',
    content: {
      type: 'text',
      text: 'I wrote it out three times\nand threw all three away.',
      size: 42,
    },
    behavior: { type: 'crumple', progress: 0.62, coarseness: 0.4, ball: 0.55 },
    // Handled paper is dirty paper: the grain is what stops the facets
    // reading as folded plastic.
    surface: { grain: 0.5, aging: 0.18 },
  },
  /**
   * The second after the fall. `fall` is a sheet still arguing with the air;
   * this one has stopped — which is the half of the story the library could
   * not tell, and the half every paper installation is actually made of.
   */
  /**
   * A strip hung the full drop of a room. Tall and narrow on purpose: the
   * proportion IS the object, and a ribbon that is not much longer than it
   * is wide is a poster.
   */
  'paper-ribbon': {
    meta: { name: 'Paper ribbon', tags: ['ribbon', 'hang', 'text'] },
    sheet: { width: 0.85, height: 6.4 },
    stock: 'printer',
    content: {
      type: 'text',
      // Short words, set small. The measure on a 0.85-wide strip is about
      // 220px at texture resolution, and anything larger breaks mid-word —
      // a ribbon reading "an d th e pa pe r" is a ribbon nobody can read.
      text: 'the paper\nkept going\nlong after\nthe floor\nran out',
      size: 34,
      align: 'center',
      valign: 'center',
      lineHeight: 1.5,
      tracking: 0.02,
    },
    behavior: { type: 'ribbon', pool: 0.17, curl: 0.42, drape: 0.55 },
    surface: { grain: 0.18 },
  },
  'settled-sheet': {
    meta: { name: 'Settled sheet', tags: ['settle', 'floor', 'text'] },
    sheet: { width: 1.2, height: 0.9 },
    stock: 'printer',
    content: {
      type: 'card',
      title: 'Found',
      body: 'on the floor, face up,\nwhere somebody dropped it.',
      note: 'no. 31',
    },
    behavior: { type: 'settle', relax: 0.6, lift: 0.5, slack: 0.45 },
    surface: { grain: 0.2 },
  },
  'typed-note': {
    meta: { name: 'Typed note', tags: ['text', 'starter'] },
    sheet: { width: 1, height: 1.4 },
    stock: 'printer',
    content: {
      type: 'text',
      text: 'Dear reader,\n\nPaper is the product. Everything else hangs off the sheet.\n\n— Paperlab',
    },
  },
}

/** User presets registered at runtime (the editor persists these to localStorage). */
const userPresets = new Map<string, PaperConfigInput>()

export function getPreset(name: string): PaperConfig {
  const raw = builtins[name] ?? userPresets.get(name)
  if (!raw) {
    throw new Error(`[paperlab] Unknown preset "${name}". Registered: ${listPresets().join(', ')}`)
  }
  return paperConfigSchema.parse(raw)
}

/** Register a user preset (validated). Built-in names are reserved. */
export function registerPreset(name: string, input: PaperConfigInput): void {
  if (name in builtins) {
    throw new Error(`[paperlab] "${name}" is a built-in preset — pick another name.`)
  }
  paperConfigSchema.parse(input) // fail fast on invalid configs
  userPresets.set(name, input)
}

export function unregisterPreset(name: string): void {
  userPresets.delete(name)
}

export function isBuiltinPreset(name: string): boolean {
  return name in builtins
}

export function listPresets(): string[] {
  return [...Object.keys(builtins), ...userPresets.keys()]
}

/**
 * A collision-free preset name built from `base`: `base`, else `base 2`,
 * `base 3`, … The disambiguating suffix always grows from the SAME base — a
 * name derived from a synthetic base (e.g. an untitled import → "imported")
 * must not fall back to the original when it collides. `taken` reports whether
 * a candidate is already used (built-in or user preset).
 */
export function uniquePresetName(base: string, taken: (name: string) => boolean): string {
  if (!taken(base)) return base
  let n = 2
  let name = `${base} ${n}`
  while (taken(name)) name = `${base} ${++n}`
  return name
}
