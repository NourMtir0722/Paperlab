import { createRoot } from 'react-dom/client'
import { type ComponentProps, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { Paper, type PaperHandle } from 'paperlab'
import {
  CHAR,
  FIELD_SIZE,
  FireSound,
  FxAudio,
  FxFireFluid,
  FxFireLight,
  FxMatchFlame,
  FxParticles,
  FxPost,
  FxWisps,
  HEAT,
  PRESENCE,
  SATURATION,
  DAMAGE_LOOK_DEFAULTS,
  FX_BLOOM,
  FX_BLOOM_THRESHOLD,
  FIRE_LIGHT_GAIN,
  FIRE_ZONES,
  fireZones,
  type FireZones,
  type FireZonesInput,
  type DamageLook,
  type DamageSource,
  type FieldStats,
  type FireFluidParams,
  type MatchFlameState,
  fireEmitterDefaults,
  fireFluidControls,
  fireFluidDefaults,
  fxQualityFor,
  createAudioContext,
} from 'paperlab/fx'
import type { SurfaceLocator } from 'paperlab/fx'
import {
  ALL_LAYERS,
  BURN_DEFAULTS,
  HOLD,
  LONGEST,
  ORIGINS,
  planBurn,
  roomYield,
  type BurnOrigin,
  type BurnPlan,
  type BurnSettings,
  ScriptedBurn,
  TIER,
  rimCrops,
  type Crop,
  type Layers,
  type Phase,
} from './burn'
import '../styles.css'
import { ModeTabs } from '../chrome/ModeTabs'
import { Feedback } from '../chrome/Feedback'
import { Brand } from '../chrome/Brand'
import { Panel } from '../controls/controls'
import {
  type Control,
  button,
  color,
  emphasize,
  folder,
  note as noteControl,
  num as numberControl,
  toggle,
} from '../controls/controlModel'
import { Select } from '../controls/Select'
import { UIHost, toast } from '../controls/ui'

/**
 * `/fx-lab` — where fire is judged.
 *
 * It exists because the first fire passed every test and looked cheap, and
 * the root cause was not a shader: it was that **visual quality had no
 * gate**. `test:damage` asks whether a burning sheet is warmer than a cold
 * one, and a radial gradient answers yes. So the gate cannot be another
 * assertion. It has to be a render, put beside the photograph it is meant to
 * look like, at a moment somebody chose.
 *
 * Three things make that possible, and all three are here:
 *
 *   - a burn with no camera, no hand and no wall clock in it, that answers
 *     the same question with the same pixels every time (`burn.ts`);
 *   - the references on screen BESIDE it, not in another window;
 *   - a way to take the picture apart — each channel off, each kind of
 *     particle off — so "it looks wrong" can become "the scorch is wrong".
 *
 * It began as a tuning harness and ships as a feature: the library's fire
 * defaults are a tune made here, and every knob behind them is on the page.
 *
 *   /fx-lab                      the lab
 *   ?phase=peak                  jump to one of the burn's moments
 *   ?t=2.2                       or to any simulated second
 *   ?view=close&u=0.5&v=0.52     macro on a point of the sheet
 *   ?off=heat,embers             layers off, by name
 *   ?post=0                      no post at all: the renderer's own tone curve
 *   ?bloom=0 | ?bloom=0.4        bloom off, or at that strength
 *   ?threshold=1.6               the bloom threshold, in scene luminance
 *   ?fire=tip:0.4,pale:0.55      the flame's zones (FireZones) and render terms:
 *                                tip, from, to, edge, detail · body · core, pale
 *                                · blue, reach · scale, soot, contrast, opacity, thin,
 *                                warm, sharp
 *   ?fluid=vorticity:2.5         the solver's own controls, over the defaults
 *   ?look=emberGlow:0,sparkle:0  how the burn is drawn, over the defaults —
 *                                honoured with ?ui=0 too, so a capture can
 *                                isolate one term of the ember line
 *   ?lighting=noir               any lighting preset
 *   ?play=1&speed=0.25           start it running, and how fast
 *   ?ui=0                        the stage alone — what the capture script loads
 *   ?amount=0.5                  how much of the sheet burns, 0..1 — 1 is all of it
 *   ?camera=static               no push-in and no drift: the still camera every
 *                                capture and budget is measured with
 *   ?floor=1                     a floor under the sheet, and the shot framed
 *                                to include it
 *   ?focus=0.8                   shallow focus on the burn, 0..1 — the macro
 *                                look of the reference crops
 *   ?physics=flat                the sheet held flat and still, as it was before it
 *                                hung: nothing curls, nothing falls
 *
 * It ships, as the site's `/fx-lab` route — its own build pass, the way
 * `/hands` is. What does not ship is the reference stills it can put beside
 * the render: they come from outside the repo through a dev-server
 * middleware, so on the deployed page the reference pane says where they
 * live instead of showing them — see `tools/fx-refs.mjs`.
 */

declare global {
  interface Window {
    /** What `pnpm test:fire-look` reads. The page is the source of truth for both. */
    __FXLAB__?: {
      look: Required<DamageLook>
      /** The frame is drawn and settled — safe to photograph. */
      ready: boolean
      /** Simulated seconds the burn is at. */
      t: number
      stats: FieldStats
      /** The burn's moments, at the times this burn actually reaches them. */
      phases: readonly Phase[]
      /** Three points on the rim of the hole, for the close crops. */
      crops: Crop[]
      tier: string
      /** How long this burn is worth watching, simulated seconds — what `pnpm film` records. */
      duration: number
      /** How much of the sheet it has eaten once it is cold, 0..1. */
      burnt: number
      /** When it cut a piece of the sheet loose, which then falls — or null. */
      severedAt: number | null
      /** Where on the screen the field says char, hole, paper and scorch are — null until ready. */
      masks: FieldMasks | null
    }
  }
}

/** How many frames to draw before a capture is allowed. */
const SETTLE_FRAMES = 60

/**
 * The camera the references were shot with, as near as this scene can stand.
 *
 * Head-on, the sheet filling about four fifths of the frame, on a black
 * stage, with a few degrees of roll — every reference has that tilt, and on
 * black it is the tilt rather than the background that says "a sheet lying in
 * a studio" instead of "a texture". `<Paper>`'s own camera sits at
 * (0, 0.35, 2.4) and frames a sheet you are about to grab; this frames one
 * you are about to photograph.
 */
const WIDE = { y: 0, z: 2.35 }
/** The macro camera, for the ember-line crops: about 55 mm of A4 across the frame. */
const CLOSE_Z = 0.35
const ROLL = THREE.MathUtils.degToRad(3.5)

/** The reference's own words, so the render and the still say the same thing. */
const CONTENT = {
  type: 'text' as const,
  text: 'Same sky.\nDifferent days.\nA kinder view.',
  size: 40,
}

const REF_BASE = '/fx-refs/fire'

/**
 * Every knob the Tune sidebar turns, in one object — so a combination that
 * looks right can be copied whole, saved in this browser, and handed back to
 * become the default.
 */
interface LabSettings {
  /** How the burn is drawn on the sheet — see `DamageLook`. */
  look: Required<DamageLook>
  /** The fire simulator's panel. */
  fluid: FireFluidParams
  /** The flame's four zones — root, core, body, tip (`FireZones`). */
  zones: FireZones
  /** The fire light's gain (`FxFireLight`). */
  light: number
  /**
   * How much of the room's light a fire at its height takes over, 0..1
   * (`DamageFirelight`); null is the lighting preset's own — see `roomYield`.
   */
  firelight: number | null
  /** One fire light casts shadows (`FxFireLight`'s `shadows`) — a shadow pass a frame, so off on this tier. */
  fireShadows: boolean
  /** A floor under the sheet: what the fire's light pools on, and what a cut-loose piece lands on. */
  floor: boolean
  /** Bloom strength, and the scene luminance it starts at. */
  bloom: number
  threshold: number
  /** Heat haze, pixels at 1080p. */
  haze: number
  /** Shallow focus on the burn, 0..1 — the macro look of the reference crops (K4). */
  focus: number
  /** How much of each particle the burn throws — the emitter's rates. */
  rates: { embers: number; smoke: number; ash: number }
  /** Where the burn starts and how it ends — see `BurnSettings`. */
  burn: BurnSettings
}

/** Where a saved combination lives in this browser. */
const SETTINGS_KEY = 'paperlab.fx-lab.settings'

const SLIDERS: {
  group: string
  key: keyof Required<DamageLook>
  label: string
  min: number
  max: number
  step: number
  unit?: string
}[] = [
  { group: 'Ember line', key: 'emberWidth', label: 'Width', min: 0.3, max: 3, step: 0.05, unit: 'mm' },
  { group: 'Ember line', key: 'emberIntensity', label: 'Intensity', min: 0, max: 3, step: 0.05 },
  { group: 'Ember line', key: 'emberCoverage', label: 'How much is lit', min: 0, max: 1, step: 0.01 },
  { group: 'Ember line', key: 'emberFlicker', label: 'Flicker speed', min: 0, max: 3, step: 0.05 },
  { group: 'Ember line', key: 'emberGlow', label: 'Crimson glow in the char', min: 0, max: 2, step: 0.05 },
  { group: 'Ember line', key: 'sparkle', label: 'Glowing fibre specks', min: 0, max: 2, step: 0.05 },
  { group: 'Ash lip', key: 'lipWidth', label: 'Width', min: 0.2, max: 8, step: 0.05, unit: 'mm' },
  { group: 'Ash lip', key: 'lipBrightness', label: 'Paleness', min: 0.3, max: 1.5, step: 0.01 },
  { group: 'Char', key: 'charWidth', label: 'Width', min: 0.5, max: 10, step: 0.05, unit: 'mm' },
  { group: 'Char', key: 'charWarmth', label: 'Warmth (grey → dark orange)', min: 0, max: 1, step: 0.01 },
  { group: 'Char', key: 'charCracks', label: 'Cracks', min: 0, max: 1, step: 0.01 },
  { group: 'Scorch', key: 'scorchReach', label: 'Reach upward', min: 0, max: 30, step: 0.5, unit: 'mm' },
  { group: 'Scorch', key: 'scorchDarkness', label: 'Darkness', min: 0.3, max: 1.8, step: 0.01 },
  { group: 'Scorch', key: 'fingers', label: 'Fingers', min: 0, max: 2.5, step: 0.05 },
  { group: 'Edge shape', key: 'edgeWave', label: 'Waves', min: 0, max: 15, step: 0.5, unit: 'mm' },
  // To 10: the default (6) was this slider's old ceiling, and a default needs
  // room to move both ways.
  { group: 'Edge shape', key: 'edgeBite', label: 'Bites', min: 0, max: 10, step: 0.1, unit: 'mm' },
]

/**
 * The flame's zones, as the Tune panel shows them — base to tip, the order a
 * flame over a sheet is built in (see `FireZones` in `paperlab/fx`). Every
 * zone also has a colour picker; brightness is in multiples of paper white,
 * and boundaries are fractions of the hottest gas.
 */
const FLAME_ZONE_NAMES: { zone: keyof FireZones; title: string; note: string }[] = [
  {
    zone: 'root',
    title: 'Root',
    note: 'The blue edge where fresh gas meets the air at the paper. Off by default: blue light over cream reads lavender.',
  },
  {
    zone: 'core',
    title: 'Core',
    note: 'The hottest gas, where soot is densest. The only part that over-exposes, so the part that blooms.',
  },
  { zone: 'body', title: 'Body', note: 'The luminous bulk: soot glowing yellow-orange as it rises.' },
  {
    zone: 'tip',
    title: 'Tip',
    note: 'Where soot cools and burns off — dimmer, redder, tearing into tongues.',
  },
]
const FLAME_CONTROLS: {
  zone: keyof FireZones
  key: string
  label: string
  min: number
  max: number
  step: number
  unit?: string
}[] = [
  { zone: 'root', key: 'amount', label: 'Blue', min: 0, max: 1, step: 0.01 },
  { zone: 'root', key: 'reach', label: 'How far up it reaches', min: 0, max: 1, step: 0.01 },
  { zone: 'core', key: 'glow', label: 'Brightness', min: 0, max: 10, step: 0.05, unit: '× paper' },
  { zone: 'core', key: 'from', label: 'Starts at', min: 0.2, max: 1, step: 0.01 },
  { zone: 'body', key: 'glow', label: 'Brightness', min: 0, max: 2, step: 0.01, unit: '× paper' },
  { zone: 'tip', key: 'glow', label: 'Brightness', min: 0, max: 2, step: 0.01, unit: '× paper' },
  {
    zone: 'tip',
    key: 'from',
    label: 'Where the flame begins (how dense its soot)',
    min: 0,
    max: 0.5,
    step: 0.01,
  },
  { zone: 'tip', key: 'to', label: 'Where the tip becomes body', min: 0.1, max: 0.8, step: 0.01 },
  // From 0: the default (0.02) was this slider's old floor.
  { zone: 'tip', key: 'softness', label: 'Softness of the outline', min: 0, max: 0.5, step: 0.01 },
  { zone: 'tip', key: 'tearing', label: 'Tearing', min: 0, max: 1.5, step: 0.01 },
]

const query = new URLSearchParams(window.location.search)
const bare = query.get('ui') === '0'

/** A number off a URL, clamped — `?t=Infinity` reaches the simulation otherwise. */
function num(name: string, fallback: number, lo: number, hi: number): number {
  const asked = Number(query.get(name) ?? fallback)
  return Number.isFinite(asked) ? Math.min(hi, Math.max(lo, asked)) : fallback
}

/** `?origin=corner` — where the burn starts; honoured with ?ui=0, so a capture can photograph either. */
const START_ORIGIN: BurnOrigin = query.get('origin') === 'corner' ? 'corner' : 'center'

/** `?amount=0.5` — how much burns; honoured with ?ui=0, so a capture can photograph a sheet cut in two. */
const START_BURN: Partial<BurnSettings> = {
  origin: START_ORIGIN,
  ...(query.has('amount') ? { amount: num('amount', BURN_DEFAULTS.amount, 0.05, 1) } : {}),
}

const START_T = query.has('phase')
  ? (planBurn(START_BURN).phases.find((p) => p.id === query.get('phase'))?.at ?? 0)
  : num('t', 0, 0, LONGEST)

/**
 * How the sheet is held: hung by its top edge in still air — so a burn that
 * cuts a piece loose drops it, and a burnt edge curls the way it does on
 * `/hands`, where the sheet has always been a simulation. `?physics=flat`
 * brings back the sheet this lab used to show, flat and still, for a picture
 * of the burn with nothing moving the paper.
 *
 * No wind. A sheet swaying in a draught is a different picture on every load,
 * and a capture that cannot be repeated cannot be compared.
 */
const PHYSICS: ComponentProps<typeof Paper>['physics'] =
  query.get('physics') === 'flat'
    ? undefined
    : { type: 'cloth', pins: 'top-edge', wind: 0, stiffness: 0.8, gravity: 1, floor: -1.4 }

/**
 * Enough of the sheet that a burn from the centre cuts it in two. The fibre
 * runs across the sheet, so the fire races sideways and reaches both edges
 * at 11.2 s; from 42% burnt on, it is still eating when it gets there, and
 * the paper under the hole is joined to nothing.
 */
/**
 * Where the floor lies when it is on — `<Paper>`'s own contact-shadow height.
 * The cloth stops here too: one height, so a falling piece cannot land
 * through the thing its shadow is on. With the floor off the cloth keeps its
 * old floor, well below the frame.
 */
const FLOOR_Y = -1.05

const CUT_IN_TWO = 0.42

/** "How much burns", in the words a person would use. The slider is the spectrum between. */
const AMOUNTS: { label: string; amount: number }[] = [
  { label: 'a hole', amount: BURN_DEFAULTS.amount },
  { label: 'cut in two', amount: CUT_IN_TWO },
  { label: 'most of it', amount: 0.75 },
  { label: 'all of it', amount: 1 },
]

/** What this burn does, in a sentence — measured off it, so it is true of the burn on screen. */
function burnNote(plan: BurnPlan, origin: BurnOrigin): string {
  const out = plan.wentOut === null ? 'is still burning at the end' : `is out at ${plan.wentOut.toFixed(1)} s`
  const loose =
    plan.severedAt !== null
      ? `At ${plan.severedAt.toFixed(1)} s it cuts the paper below the hole loose, and that falls.`
      : origin === 'corner'
        ? 'From a corner it eats upward as a line, so nothing comes loose.'
        : 'Nothing comes loose: the sheet still holds all round the hole.'
  return `Eats ${Math.round(plan.burnt * 100)}% of the sheet and ${out}. ${loose}`
}

/**
 * `?play=1` starts the burn running.
 *
 * The page opens paused because almost everything it is for is a single
 * frame compared against a still. Motion is the exception, and it is the one
 * a contact sheet cannot show: flicker, whether a tongue tears or dissolves,
 * whether the smoulder is a different picture from the cold. `tools/
 * fire-film.mjs` needs a way to say "go" with the panel hidden.
 */
const START_PLAYING = query.get('play') === '1'

/**
 * A still camera, for anything that measures the frame.
 *
 * The lab's camera pushes in as the fire grows and drifts a little, because
 * a fire filmed from a tripod bolted to the floor reads as a render. Every
 * capture, budget and reference crop needs the opposite: the same camera in
 * the same place every time, or two loads of one moment are two pictures.
 */
const CAMERA_STATIC = query.get('camera') === 'static'
/** `?speed=0.25` — the transport's rate, so a film can be slowed for the flicker. */
const START_SPEED = num('speed', 1, 0.05, 4)

const START_POST = query.get('post') !== '0'
/**
 * `?bloom=0` turns it off, `?bloom=0.4` sets its strength.
 *
 * It used to be a flag. Strength has to be sweepable from the URL because it
 * cannot be chosen on its own: bloom is a multiplier on whatever clears the
 * threshold, so the right number depends entirely on how bright the fire is
 * authored (`fx/emission.ts`), and the two have to be found together. `0`
 * still means off, which is what the capture script passes.
 */
const BLOOM_QUERY = query.get('bloom')
const START_BLOOM = BLOOM_QUERY !== '0'
const BLOOM_STRENGTH =
  BLOOM_QUERY !== null && BLOOM_QUERY !== '0' && Number.isFinite(Number(BLOOM_QUERY))
    ? Number(BLOOM_QUERY)
    : undefined
/** Undefined means FxPost's own default — the number the gate checks. */
const THRESHOLD = query.has('threshold') ? num('threshold', 1.6, 0, 50) : undefined
/** `?look=` — `DamageLook` keys over the defaults; unknown keys and non-numbers are dropped. */
/**
 * `?fire=body:1.1,core:5` — the fluid's emission, in multiples of paper white.
 *
 * The same shape as `?look=`, and for the same reason: these two decide
 * whether the flames clear the bloom threshold at all (see `fx/emission.ts`),
 * and finding the pair that reads as fire rather than as a white blob is a
 * sweep, not a guess. Honoured with `?ui=0`, so a capture can shoot a grid.
 */
const FIRE_OVERRIDES: {
  zones: FireZonesInput
  heatScale?: number
  sootScale?: number
  contrast?: number
  opacity?: number
  sharp?: number
  thin?: number
  warm?: number
} = (() => {
  const out: {
    zones: FireZonesInput
    heatScale?: number
    sootScale?: number
    contrast?: number
    opacity?: number
    sharp?: number
    thin?: number
    warm?: number
  } = { zones: {} }
  const raw = query.get('fire')
  if (!raw) return out
  const z = out.zones
  for (const pair of raw.split(',')) {
    const [key, value] = pair.split(':')
    const n = Number(value)
    if (!Number.isFinite(n)) continue
    // The zones. The older names still work so every sweep in the fire
    // history can be re-run: `body`, `core`, `pale`, `from`, `edge`, `detail`
    // and `blue` are the knobs these zones replaced.
    if (key === 'tip') z.tip = { ...z.tip, glow: n }
    if (key === 'from') z.tip = { ...z.tip, from: n }
    if (key === 'to') z.tip = { ...z.tip, to: n }
    if (key === 'edge') z.tip = { ...z.tip, softness: n }
    if (key === 'detail') z.tip = { ...z.tip, tearing: n }
    if (key === 'body') z.body = { ...z.body, glow: n }
    if (key === 'core') z.core = { ...z.core, glow: n }
    if (key === 'pale') z.core = { ...z.core, from: n }
    if (key === 'blue') z.root = { ...z.root, amount: n }
    if (key === 'reach') z.root = { ...z.root, reach: n }
    if (key === 'scale') out.heatScale = n
    if (key === 'soot') out.sootScale = n
    if (key === 'contrast') out.contrast = n
    if (key === 'opacity') out.opacity = n
    if (key === 'sharp') out.sharp = n
    if (key === 'thin') out.thin = n
    if (key === 'warm') out.warm = n
  }
  return out
})()

/**
 * `?fluid=radialImpulse:0.7,vorticity:2.5` — the solver, over its defaults.
 *
 * Keyed off `fireFluidControls`, so only a real control can be set and a typo
 * is ignored rather than becoming a NaN uniform. Honoured with `?ui=0`: how a
 * flame MOVES cannot be judged from the panel one setting at a time, and the
 * shape of the fire turned out to matter more than its brightness.
 */
const FLUID_OVERRIDES: Partial<FireFluidParams> = (() => {
  const raw = query.get('fluid')
  if (!raw) return {}
  const allowed = new Set<string>(fireFluidControls.map((c) => c.key))
  const out: Record<string, number> = {}
  for (const pair of raw.split(',')) {
    const [key, value] = pair.split(':')
    const n = Number(value)
    if (key && allowed.has(key) && Number.isFinite(n)) out[key] = n
  }
  return out as Partial<FireFluidParams>
})()

const LOOK_OVERRIDES: Partial<typeof DAMAGE_LOOK_DEFAULTS> = (() => {
  const out: Record<string, number> = {}
  for (const pair of (query.get('look') ?? '').split(',')) {
    const [key, value] = pair.split(':')
    if (key && key in DAMAGE_LOOK_DEFAULTS && Number.isFinite(Number(value))) out[key] = Number(value)
  }
  return out
})()

/** What every knob starts at: the product's own values (and any `?look=`). */
const DEFAULT_SETTINGS: LabSettings = {
  look: { ...DAMAGE_LOOK_DEFAULTS, ...LOOK_OVERRIDES },
  fluid: fireFluidDefaults,
  zones: fireZones(),
  // FxFireLight's own gain, FxPost's own bloom, the tier's haze — the
  // library's defaults, read from it and never copied, so the lab cannot
  // show a fire the product does not have.
  light: FIRE_LIGHT_GAIN,
  // The preset's own until someone moves the slider — so switching presets
  // in the URL does not make a saved tune look stale.
  firelight: null,
  fireShadows: false,
  // `?floor=1` so a capture can ask for the ground without a saved tune.
  floor: query.get('floor') === '1',
  // The library's own, not copies of them: these three used to be literals
  // here and in `fx/emission.ts` both, which is exactly how a lab comes to
  // show a fire the product does not have.
  bloom: FX_BLOOM,
  threshold: FX_BLOOM_THRESHOLD,
  haze: fxQualityFor(TIER).haze,
  // Sharp: a shallow focus is a look to reach for, not the lab's default,
  // and every capture is judged on a sharp frame. `?focus=0.8` for a macro
  // shot of the rim without a saved tune.
  focus: num('focus', 0, 0, 1),
  // FireEmitter's own, read from it rather than copied: these were stale the
  // moment the library's changed, and a lab showing a fire the product does
  // not have is worse than no lab.
  rates: {
    embers: fireEmitterDefaults.embers,
    smoke: fireEmitterDefaults.smoke,
    ash: fireEmitterDefaults.ash,
  },
  burn: { ...BURN_DEFAULTS, ...START_BURN },
}

/** A saved combination, over the defaults — or the defaults, if there is none or it will not parse. */
/**
 * A fingerprint of the shipped defaults.
 *
 * Saved settings are merged over the defaults, which means a tune saved in
 * this browser silently wins over every default the library ships afterwards
 * — for every key it happens to contain, including ones the person tuning
 * never touched. That is how a lab comes to show a fire the product does not
 * have: a look saved before the fire was retuned kept its own ash lip, char
 * warmth, fingers, fire-light gain AND the whole solver, so what was on
 * screen was an old look wearing a new renderer, and neither of us had ever
 * chosen it.
 *
 * Deriving the stamp FROM the defaults is the point: nobody has to remember
 * to bump a version, because changing a default changes the stamp, and a save
 * made against different defaults is set aside rather than applied.
 */
function fingerprint(value: unknown): string {
  const text = JSON.stringify(value)
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(36)
}

const DEFAULTS_STAMP = fingerprint(DEFAULT_SETTINGS)

/** Whether the settings on screen came from a save, and whether one was set aside. */
export type SavedState = 'defaults' | 'restored' | 'stale'
let savedState: SavedState = 'defaults'

function loadSettings(): LabSettings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY)
    if (!raw) return DEFAULT_SETTINGS
    const saved = JSON.parse(raw) as Partial<LabSettings> & { stamp?: string }
    if (saved.stamp !== DEFAULTS_STAMP) {
      // Kept, not deleted — it is somebody's tuning session. It is simply not
      // applied over defaults it was never tuned against, and the panel says
      // so rather than leaving them wondering why nothing looks like the
      // screenshots.
      savedState = 'stale'
      return DEFAULT_SETTINGS
    }
    savedState = 'restored'
    return {
      ...DEFAULT_SETTINGS,
      ...saved,
      look: { ...DEFAULT_SETTINGS.look, ...saved.look, ...LOOK_OVERRIDES },
      fluid: { ...DEFAULT_SETTINGS.fluid, ...saved.fluid },
      zones: fireZones(saved.zones),
      rates: { ...DEFAULT_SETTINGS.rates, ...saved.rates },
      burn: {
        ...DEFAULT_SETTINGS.burn,
        ...saved.burn,
        ...(query.has('origin') ? { origin: START_ORIGIN } : {}),
        ...(query.has('amount') ? { amount: START_BURN.amount } : {}),
      },
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

/** Any preset by name; unknown names fall back inside `<Paper>` like any config. */
/**
 * How much of the lab is showing, and which side of it.
 *
 * It used to be three modes — watch, tune, debug — each rearranging the page.
 * It wears the editor's frame now, so the tool rail, the sheet and the
 * settings are always where they are. What is left of the modes is how much
 * of the machinery is showing (`Advanced`: the layers, the solver's own panel,
 * the field's numbers, the constants) and whether the settings rail shows the
 * knobs or the reference stills.
 *
 * `?mode=debug` (and the older `?debug=1`) still opens it advanced, and
 * `?mode=watch` on the references, so every link and note that says so still
 * works.
 */
const START_ADVANCED = query.get('mode') === 'debug' || query.get('debug') === '1'
const START_SIDE: 'tune' | 'refs' = query.get('mode') === 'watch' ? 'refs' : 'tune'

/**
 * `noir` unless asked otherwise: a sheet under one hard key in a dark room,
 * which is how every fire reference was shot.
 *
 * Under `studio` — `<Paper>`'s own default — clean paper photographs at a
 * luminance of 0.93, at the very top of the tone curve, so NOTHING can be
 * brighter than the paper and still have a colour; the flames were authored
 * dimmer than paper white to keep their orange and read as painted decals on
 * the sheet. Hero.png's paper is 0.70; `noir`'s is 0.62. A flame is the
 * brightest thing in the frame only where the frame leaves it room.
 */
const LIGHTING = query.get('lighting') ?? 'noir'

const START_LAYERS: Layers = (() => {
  const off = new Set((query.get('off') ?? '').split(',').filter(Boolean))
  const layers = { ...ALL_LAYERS }
  for (const key of Object.keys(layers) as (keyof Layers)[]) if (off.has(key)) layers[key] = false
  return layers
})()

/**
 * The field, as the sheet is allowed to see it.
 *
 * A stable object wrapping a stable array, because that is what
 * `useDamageTexture` keys its texture on: the sheet uploads when `version`
 * moves and never otherwise, so a new object every frame would rebuild a
 * texture every frame, and a new one every seek would rebuild one every
 * scrub.
 *
 * It is also how a layer goes off. Flattening a channel here — char to 0,
 * presence to full — asks the sheet to draw a burn with one of its parts
 * missing, without touching a line of the shader that draws it. The sheet is
 * the only thing reading this, so nothing about the simulation changes; the
 * physics coupling reads it too, which is right, since a sheet that has not
 * charred should not curl either.
 */
class FieldView implements DamageSource {
  readonly size = FIELD_SIZE
  readonly pixels = new Uint8Array(FIELD_SIZE * FIELD_SIZE * 4)
  version = 0
  detail = 1
  /** The burn's clock, passed through so the ember line's beads replay exactly — see `DamageSource.time`. */
  time = 0
  /** How the burn is drawn — the Tune sidebar's, read by the sheet every frame. */
  look: DamageLook = {}
  /** How much of the room's light is left, as the fire takes over — set by `Driver` every frame. */
  firelight = { room: 1 }
  private from = -1
  private mask = ''

  constructor() {
    // An untouched sheet: paper everywhere, nothing happened to it. The
    // texture is built from this array before the first frame runs.
    for (let i = 0; i < this.pixels.length; i += 4) this.pixels[i + PRESENCE] = 255
  }

  /**
   * From whatever the sheet should see — the burn's `Afterglow`, which is the
   * field plus the embers an edge keeps once the heat has gone.
   */
  sync(
    source: { readonly pixels: Uint8Array; readonly version: number; readonly time?: number },
    layers: Layers,
    detail: number,
  ): void {
    this.time = source.time ?? 0
    const mask = `${+layers.char}${+layers.saturation}${+layers.heat}${+layers.presence}${detail}`
    if (source.version === this.from && mask === this.mask) return
    this.from = source.version
    this.mask = mask
    const src = source.pixels
    const dst = this.pixels
    for (let i = 0; i < dst.length; i += 4) {
      dst[i + CHAR] = layers.char ? src[i + CHAR]! : 0
      dst[i + SATURATION] = layers.saturation ? src[i + SATURATION]! : 0
      dst[i + HEAT] = layers.heat ? src[i + HEAT]! : 0
      dst[i + PRESENCE] = layers.presence ? src[i + PRESENCE]! : 255
    }
    this.detail = detail
    this.version++
  }
}

const look = new THREE.Vector3()

/**
 * Where the camera stands. Set every frame rather than on mount: the close
 * view aims at a point of the SHEET, and the sheet is only where it is once
 * the mesh has been built and the cloth has settled.
 */
function CameraRig({
  view,
  at,
  locate,
  burn,
  pushFrom,
  pushTo,
  floor,
}: {
  view: 'wide' | 'close'
  /** With a floor in the scene the shot includes it, so the fall lands in frame (K3). */
  floor: boolean
  at: { u: number; v: number }
  locate: (u: number, v: number) => { x: number; y: number; z: number } | null
  /** The burn, for its own clock: the push-in follows the fire, not the page. */
  burn: ScriptedBurn
  /** The seconds the push-in runs between — catch to peak. */
  pushFrom: number
  pushTo: number
}) {
  const camera = useThree((s) => s.camera)
  useFrame(() => {
    // With a floor, the shot sits lower and looks down a little, so the
    // ground — and anything that lands on it — is in frame.
    look.set(0, floor ? FLOOR_FRAMING.look : WIDE.y, 0)
    if (view === 'close') {
      const point = locate(at.u, at.v)
      if (point) look.set(point.x, point.y, point.z)
    }
    // A slow push-in from the catch to the peak, and it stays in: a few
    // percent of the frame, on the BURN's clock, so the same moment is
    // always shot from the same place (K1). Held still for the macro view,
    // which is a crop of the rim and has nothing to push toward.
    const moving = !CAMERA_STATIC && view === 'wide'
    const k = moving ? clamp01((burn.time - pushFrom) / Math.max(0.1, pushTo - pushFrom)) : 0
    const push = 1 - PUSH_IN * (k * k * (3 - 2 * k))
    // And a breath of handheld life: well under a degree, on smooth noise,
    // never a shake (K2). Off with the push-in, so a capture is a capture.
    const drift = moving ? DRIFT : 0
    const wobbleX = (drift * (driftNoise(burn.time * 0.21) - 0.5)) as number
    const wobbleY = (drift * (driftNoise(burn.time * 0.17 + 9.3) - 0.5)) as number
    camera.position.set(
      look.x + wobbleX,
      look.y + wobbleY + (floor && view === 'wide' ? FLOOR_FRAMING.lift : 0),
      look.z + (view === 'close' ? CLOSE_Z : WIDE.z * push * (floor ? FLOOR_FRAMING.back : 1)),
    )
    camera.lookAt(look)
    // After `lookAt`, which resolves roll against world up and would undo it.
    camera.rotation.z = ROLL
  })
  return null
}

/**
 * How the wide shot changes when there is a floor: it aims lower and stands a
 * little higher, so the ground is in frame and the camera looks down on it
 * rather than along it (K3, F4).
 */
const FLOOR_FRAMING = { look: -0.32, lift: 0.34, back: 1.34 }

/** How much closer the wide camera stands at the peak than at the first contact. */
const PUSH_IN = 0.07

/** How far the handheld drift wanders, world units: about a third of a degree at this distance. */
const DRIFT = 0.012

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x
}

/** Smooth value noise, 0..1 — a drift that wanders rather than swinging on a sine. */
function driftNoise(x: number): number {
  const i = Math.floor(x)
  const f = x - i
  const smooth = f * f * (3 - 2 * f)
  const hash = (n: number) => {
    const v = Math.sin(n * 127.1) * 43758.5453
    return v - Math.floor(v)
  }
  return hash(i) + (hash(i + 1) - hash(i)) * smooth
}

/**
 * Says once when the sheet can answer "where is this point of you?".
 *
 * The burn has to wait for this, and the first version did not. `<Paper>`
 * builds its mesh inside its own canvas, a beat after the page mounts, and
 * until then `surfacePoint` returns null — so a seek run on mount burned the
 * right hole and threw away every spark, smoke puff and flake, because the
 * emitter skips a particle it cannot place. Every capture was missing its
 * particles, and `pnpm test:fire-look` found it: bloom on and off matched with
 * embers supposedly in frame.
 */
function SheetReady({
  locate,
  onReady,
}: {
  locate: (u: number, v: number) => { x: number; y: number; z: number } | null
  onReady(): void
}) {
  const done = useRef(false)
  useFrame(() => {
    if (done.current || !locate(0.5, 0.5)) return
    done.current = true
    onReady()
  })
  return null
}

/** The clock. The only thing in the page that moves the burn. */
function Driver({
  burn,
  view,
  layers,
  detail,
  playing,
  speed,
  onTime,
  match,
  locate,
  until,
  yields,
  burstAt,
  sound,
  soundOn,
}: {
  burn: ScriptedBurn
  view: FieldView
  /** The burn's voice, once someone has asked for it — see `FireSound`. */
  sound: { current: FireSound | null }
  soundOn: boolean
  /** How much of the room's light a fire at its height takes over, 0..1. */
  yields: number
  /** When this burn cuts a piece loose, for the burst of sparks it throws — or null. */
  burstAt: number | null
  layers: Layers
  detail: number
  playing: boolean
  speed: number
  onTime(t: number): void
  match: { current: MatchFlameState }
  locate: SurfaceLocator
  /** Where playing stops: the end of this burn, which is not the same for every burn. */
  until: number
}) {
  /** The burn's clock last frame, for the moments a sound belongs to. */
  const was = useRef(0)
  useFrame((_, delta) => {
    burn.burstAt = burstAt
    const before = was.current
    if (playing) {
      burn.play(delta, speed, until)
      onTime(burn.time)
    }
    was.current = burn.time

    // Sound. Only while it is actually playing, and only at a speed a
    // crackle still means something at: paused or scrubbing, the room is
    // silent rather than stuttering, and a seek resumes from the new moment
    // with no burst of caught-up crackles — `FireSound` reads this step's
    // stats and nothing older.
    const voice = sound.current
    if (voice) {
      if (soundOn && playing && speed >= 0.5) {
        // The match, at the moment it touches the paper.
        if (before < 0.02 && burn.time >= 0.02) voice.strike()
        // The cut: a soft breath as the piece lets go.
        if (burstAt !== null && before < burstAt && burn.time >= burstAt) voice.puff()
        // Where the fire is, not where the sheet is: the crackle comes from
        // the burn (S8), which on a corner burn is nowhere near the middle.
        const origin = ORIGINS[burn.settings.origin]
        voice.update(delta * speed, burn.stats, locate(origin.u, origin.v) ?? locate(0.5, 0.5))
        // The smoulder: a bead popping now and then, once the flames are out.
        const out = burn.wentOut
        if (out !== null && burn.stats.front === 0 && burn.time < out + burn.settings.smoulder) {
          if (Math.random() < delta * 1.5) voice.pop()
        }
      } else {
        voice.stop()
      }
    }
    view.sync(burn.glow, layers, detail)
    // The fire is the key light while it burns, and the room yields to it —
    // but only while its light is on: with the light layer off, nothing on
    // screen is lighting the sheet in the room's place.
    view.firelight.room = layers.light ? 1 - yields * burn.fireLevel : 1
    // The match that lights it.
    //
    // The lab had none, so the scorch and then the first hole appeared with
    // nothing on screen to have caused them — a burn that starts by itself.
    // It is held for exactly as long as the script holds it (`HOLD`), on the
    // BURN's clock rather than the frame's, so the same moment photographs
    // the same flame twice: `FxMatchFlame` takes `time` and `litAt` for
    // precisely this and throws no random sparks when it has them.
    const origin = ORIGINS[burn.settings.origin]
    const at = burn.time < HOLD ? locate(origin.u, origin.v) : null
    match.current.state = at ? 'lit' : 'none'
    match.current.position = at ? { x: at.x, y: at.y, z: at.z + 0.02 } : null
    match.current.touching = at !== null
    match.current.time = burn.time
    match.current.litAt = 0
  })
  return null
}

/**
 * Ready to photograph: the fonts are in, the seek is done, and a run of
 * frames has been drawn since anything last changed.
 *
 * Counted in FRAMES, never in wall time. Every browser harness in this repo
 * had to learn that twice: CI runs about five times slower than the laptop,
 * and a timed wait there photographs whatever the renderer had managed rather
 * than the finished picture.
 */
function Ready({
  burn,
  view,
  locate,
  armed,
  nonce,
  playing,
  plan,
  look,
  onReady,
}: {
  burn: ScriptedBurn
  /** The field as the sheet draws it — what the masks are read from. */
  view: FieldView
  locate: SurfaceLocator
  armed: boolean
  nonce: string
  playing: boolean
  /** The burn on screen, measured — its phases, length, and how much it eats. */
  plan: BurnPlan
  look: Required<DamageLook>
  /** Called each time the frame settles — what `?play=1` starts the burn from. */
  onReady?: () => void
}) {
  const frames = useRef(0)
  const fonts = useRef(false)
  const camera = useThree((s) => s.camera)
  const canvas = useThree((s) => s.gl.domElement)

  useEffect(() => {
    document.fonts.ready.then(() => {
      fonts.current = true
    })
  }, [])

  const publish = useCallback(
    (ready: boolean) => {
      window.__FXLAB__ = {
        ready,
        t: burn.time,
        stats: burn.stats,
        phases: plan.phases,
        crops: rimCrops(burn.field),
        tier: TIER,
        look,
        duration: plan.duration,
        burnt: plan.burnt,
        severedAt: plan.severedAt,
        masks: ready ? fieldMasks(view, locate, camera, canvas) : null,
      }
    },
    [burn, plan, look, view, locate, camera, canvas],
  )

  // biome-ignore lint/correctness/useExhaustiveDependencies: `nonce` and `playing` are the TRIGGER — anything that changes the picture starts the count again
  useEffect(() => {
    frames.current = 0
    publish(false)
  }, [nonce, playing, publish])

  useFrame(() => {
    // `armed`: not before the first seek has actually run on a located sheet.
    if (!armed || playing || !fonts.current || frames.current > SETTLE_FRAMES) return
    if (++frames.current > SETTLE_FRAMES) {
      publish(true)
      onReady?.()
    }
  })
  return null
}

/**
 * Where on the screen the burn says each thing is.
 *
 * So a budget can measure the colour of char where the burn says char is,
 * instead of finding the char by its colour — which is the thing being
 * measured, and a mask drawn from it could only ever agree with it.
 *
 * The char and the scorch are found by DISTANCE from the drawn edge, never by
 * the field's char. The field carries char in about one texel beside the cut,
 * and the shader builds the whole band and its halo out of that; a mask keyed
 * on char levels found nothing at all on a cold sheet. So from every texel on
 * the rim a ray goes out into the paper, and points are taken along it at set
 * distances in millimetres.
 */
interface FieldMasks {
  /** On the char band, past the lip and the beads: {@link CHAR_AT} from the edge. */
  char: [number, number][]
  /** The middle of the hole, two texels or more from any paper. */
  hole: [number, number][]
  /** Clean paper, well beyond the scorch's reach. */
  paper: [number, number][]
  /** Out through the scorch, with the distance from the edge in mm. */
  scorch: [number, number, number][]
}

/**
 * Where along each ray the char is sampled, mm: past the default lip (3.5)
 * and widest bead (1.25), inside the default char band (3.5 more).
 */
const CHAR_AT = [6, 7.5]
/** And the scorch, out to past its reach. */
const SCORCH_AT = [6, 8, 10, 14, 18, 24, 30, 40]
/** A millimetre of A4 in world units: a default sheet is one unit, 210 mm, across. */
const WORLD_MM = 1 / 210

const projected = new THREE.Vector3()

function fieldMasks(
  view: FieldView,
  locate: SurfaceLocator,
  camera: THREE.Camera,
  canvas: HTMLCanvasElement,
): FieldMasks {
  const { size, pixels } = view
  const last = size - 1
  const w = canvas.clientWidth
  const h = canvas.clientHeight
  const presence = (x: number, y: number) => pixels[(y * size + x) * 4 + PRESENCE]!
  const near = (x: number, y: number, r: number, test: (x: number, y: number) => boolean) => {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const nx = x + dx
        const ny = y + dy
        if (nx >= 0 && ny >= 0 && nx <= last && ny <= last && test(nx, ny)) return true
      }
    }
    return false
  }
  const paper = (x: number, y: number) => presence(x, y) >= 128
  const cut = (x: number, y: number) => presence(x, y) < 128
  const drawn = (u: number, v: number) => {
    const x = Math.round(u * last)
    const y = Math.round(v * last)
    return x >= 0 && y >= 0 && x <= last && y <= last && paper(x, y)
  }
  const screen = (u: number, v: number): [number, number] | null => {
    const at = locate(u, v)
    if (!at) return null
    projected.set(at.x, at.y, at.z).project(camera)
    const sx = Math.round((projected.x * 0.5 + 0.5) * w * 10) / 10
    const sy = Math.round((0.5 - projected.y * 0.5) * h * 10) / 10
    return sx < 1 || sy < 1 || sx > w - 2 || sy > h - 2 ? null : [sx, sy]
  }
  const masks: FieldMasks = { char: [], hole: [], paper: [], scorch: [] }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (cut(x, y)) {
        const at = near(x, y, 2, paper) ? null : screen(x / last, y / last)
        if (at) masks.hole.push(at)
        continue
      }
      // Clean paper: twelve texels, about 40 mm, from any cut — past the
      // farthest the scorch's halo reaches up.
      if (!near(x, y, 12, cut)) {
        const at = screen(x / last, y / last)
        if (at) masks.paper.push(at)
        continue
      }
      // A texel on the rim: paper, with the cut beside it. Out, away from it.
      let nx = 0
      let ny = 0
      if (x > 0 && cut(x - 1, y)) nx++
      if (x < last && cut(x + 1, y)) nx--
      if (y > 0 && cut(x, y - 1)) ny++
      if (y < last && cut(x, y + 1)) ny--
      const length = Math.hypot(nx, ny)
      if (length === 0) continue
      nx /= length
      ny /= length
      // The drawn edge is half a texel back toward the cut: presence is cut
      // at one half, between this texel and the gone one.
      const eu = (x - nx * 0.5) / last
      const ev = (y - ny * 0.5) / last
      // Copied out before the second call: the locator writes every answer
      // into one reused vector, so `edge` would otherwise BECOME `next`.
      const edge = locate(eu, ev)
      if (!edge) continue
      const ex = edge.x
      const ey = edge.y
      const ez = edge.z
      const next = locate(eu + nx / last, ev + ny / last)
      if (!next) continue
      // A texel is not the same number of millimetres both ways on a sheet
      // that is not square, so measure this one.
      const texelMm = Math.hypot(next.x - ex, next.y - ey, next.z - ez) / WORLD_MM
      if (!(texelMm > 0)) continue
      const along = (mm: number) => {
        const u = eu + (nx * mm) / texelMm / last
        const v = ev + (ny * mm) / texelMm / last
        return drawn(u, v) ? screen(u, v) : null
      }
      for (const mm of CHAR_AT) {
        const at = along(mm)
        if (at) masks.char.push(at)
      }
      for (const mm of SCORCH_AT) {
        const at = along(mm)
        if (at) masks.scorch.push([at[0], at[1], mm])
      }
    }
  }
  return masks
}

/** What is wired today, and what it actually draws. */
const BUILT: { key: keyof Layers; name: string; why: string }[] = [
  {
    key: 'char',
    name: 'scorch, char, ash lip',
    why: 'the albedo zones, measured in mm from the cut: scorch fingers reaching up, cracked char, a pale lifted lip',
  },
  {
    key: 'heat',
    name: 'the ember line',
    why: 'heat drawn ONLY as beads on the cut, in HDR — flicker and crawl on the burn clock, cool down the blackbody ramp',
  },
  {
    key: 'presence',
    name: 'the hole',
    why: 'presence cut at one half, frayed at fibre scale along the grain',
  },
  {
    key: 'fluid',
    name: 'fire simulator',
    why: 'FxFireFluid — gas from the rim burns where it has oxygen, rises on its heat, torn by turbulence and vorticity, cooling, leaving smoke',
  },
  {
    key: 'light',
    name: 'fire light + glow-through',
    why: 'FxFireLight — ~1900 K at the rim, as bright as the front is long, flickering with the flames',
  },
  {
    key: 'match',
    name: 'the match',
    why: 'FxMatchFlame — the flame that lights it, held for as long as the script holds it, on the burn clock so it photographs the same twice',
  },
  {
    key: 'wisps',
    name: 'smoulder wisp',
    why: 'FxWisps — a pale thread from a glowing bead once the flames are out, S-curving as it climbs',
  },
  {
    key: 'saturation',
    name: 'wet',
    why: 'nothing in this script wets the sheet — the channel is here because the field carries it',
  },
  {
    key: 'embers',
    name: 'embers',
    why: 'soft round points on a ballistic arc. The target is streaks along screen velocity',
  },
  {
    key: 'smoke',
    name: 'smoke',
    why: 'soft round points. The target is depth-faded sprites and a threadlike wisp',
  },
  {
    key: 'ash',
    name: 'ash',
    why: 'tumbling curled planes, char with pale edges, a few with a hot edge',
  },
]

function Lab() {
  const paperRef = useRef<PaperHandle | null>(null)
  const world = useRef(new THREE.Vector3())
  const locate = useCallback(
    (u: number, v: number) => paperRef.current?.surfacePoint(u, v, world.current) ?? null,
    [],
  )

  const view = useMemo(() => new FieldView(), [])
  const burn = useMemo(() => new ScriptedBurn(locate), [locate])

  /** Where a seek is aimed. Separate from `shown` so that playing does not re-seek. */
  const [target, setTarget] = useState(START_T)
  const [shown, setShown] = useState(START_T)
  const [playing, setPlaying] = useState(false)

  /**
   * The burn's voice. Muted until someone asks for it: a
   * browser will not start audio without a gesture anyway, so the button IS
   * the gesture, and a lab that spoke on load would be a lab nobody could
   * leave open.
   */
  const [soundOn, setSoundOn] = useState(false)
  const audioRef = useRef<FxAudio | null>(null)
  const soundRef = useRef<FireSound | null>(null)
  const toggleSound = useCallback(async () => {
    if (soundRef.current && soundOn) {
      soundRef.current.stop()
      setSoundOn(false)
      return
    }
    try {
      audioRef.current ??= new FxAudio({ context: createAudioContext(), quality: TIER })
      await audioRef.current.unlock()
      soundRef.current ??= new FireSound(audioRef.current)
      setSoundOn(true)
    } catch {
      // No Web Audio here: everything but the sound still works.
    }
  }, [soundOn])
  useEffect(
    () => () => {
      soundRef.current?.stop()
      void audioRef.current?.dispose()
      soundRef.current = null
      audioRef.current = null
    },
    [],
  )
  // `?play=1` waits for the first settled frame. Started at mount, the burn
  // played itself out during the shader compile — and since `Ready` only
  // publishes while the burn is NOT playing, the page could only report
  // ready once the fire was over. Every film `tools/fire-film.mjs` made was
  // of the cold aftermath, with the burn itself spent before it started.
  const autoplay = useRef(START_PLAYING)
  const startWhenReady = useCallback(() => {
    if (!autoplay.current) return
    autoplay.current = false
    setPlaying(true)
  }, [])
  const [speed, setSpeed] = useState(START_SPEED)
  const [layers, setLayers] = useState(START_LAYERS)
  const [detail, setDetail] = useState(1)
  const [camera, setCamera] = useState<'wide' | 'close'>(query.get('view') === 'close' ? 'close' : 'wide')
  const [at, setAt] = useState({ u: num('u', 0.5, 0, 1), v: num('v', 0.5, 0, 1) })
  const [post, setPost] = useState(START_POST)
  /**
   * Every layer's knobs (the Tune sidebar). A capture (`?ui=0`) always runs
   * on the defaults, so an experiment saved in this browser can never skew
   * the gate.
   */
  const [settings, setSettings] = useState<LabSettings>(() => (bare ? DEFAULT_SETTINGS : loadSettings()))
  const fluid = settings.fluid
  const [side, setSide] = useState<'tune' | 'refs'>(START_SIDE)
  const [bloom, setBloom] = useState(START_BLOOM)
  const [refName, setRefName] = useState<string | null>(null)
  /** Bumped whenever the burn is rebuilt: the pool is a new object and the tree has to see it. */
  const [generation, setGeneration] = useState(0)
  /** Whether the sheet can be located yet — see `SheetReady`. Nothing is burnt before it. */
  const [sheet, setSheet] = useState(false)

  // Measured off this burn, for the settings in hand — its moments, how much
  // it eats, how long it runs, and when it first cuts a piece loose. The
  // burn is then told exactly when to start dying, the time that measured
  // right, rather than guessing again.
  const plan: BurnPlan = useMemo(() => planBurn(settings.burn), [settings.burn])

  useEffect(() => {
    if (!sheet) return
    burn.setEmit({ embers: layers.embers, smoke: layers.smoke, ash: layers.ash }, settings.rates)
    burn.configure({ ...settings.burn, decayAt: plan.decayAt })
    burn.seek(target)
    setShown(burn.time)
    setGeneration((g) => g + 1)
  }, [burn, sheet, target, layers.embers, layers.smoke, layers.ash, settings.rates, settings.burn, plan])

  // The sheet reads the look every frame; hand it the sidebar's.
  view.look = settings.look

  useEffect(() => {
    if (playing && shown >= plan.duration) {
      setPlaying(false)
      setTarget(shown)
    }
  }, [playing, shown, plan.duration])

  // Smoke off means a clean background: none from the simulator either.
  const fluidParams = useMemo(() => {
    const base = { ...fluid, ...FLUID_OVERRIDES }
    return settings.burn.smoke ? base : { ...base, smoke: 0, smokeProduction: 0 }
  }, [fluid, settings.burn.smoke])
  // The Tune panel's zones, with any `?fire=` zone keys laid over them. Render
  // terms only — they update the shader every frame and never restart the fire.
  const flameZones = useMemo(() => {
    const o = FIRE_OVERRIDES.zones
    const z = settings.zones
    return {
      root: { ...z.root, ...o.root },
      core: { ...z.core, ...o.core },
      body: { ...z.body, ...o.body },
      tip: { ...z.tip, ...o.tip },
    }
  }, [settings.zones])
  const fluidKey = `${generation}:${playing ? 'live' : JSON.stringify(fluidParams)}`

  const phases = plan.phases
  const here = phases.reduce(
    (best, p) => (Math.abs(p.at - shown) < Math.abs(best.at - shown) ? p : best),
    phases[0]!,
  )
  const near = Math.abs(here.at - shown) < 0.3 ? here : null
  const reference = refName ?? near?.reference ?? 'Hero.png'
  const stats = burn.stats

  const jump = (t: number) => {
    setPlaying(false)
    setTarget(t)
  }

  /**
   * Stop where the burn actually is.
   *
   * `target` is where a seek is aimed and `shown` is where playing has got
   * to; they part company the moment you press play. Anything that has to
   * re-seek — pausing, or turning an emitter off — brings the two back
   * together first, or the page would jump back to wherever the last scrub
   * left the aim.
   */
  const hold = () => {
    setPlaying(false)
    setTarget(burn.time)
  }

  /** How much of the sheet burns. A new burn, so it re-seeks from where the burn is. */
  const setAmount = (amount: number) => {
    hold()
    setSettings((s) => ({ ...s, burn: { ...s.burn, amount } }))
  }

  /**
   * Seek and play from there. The fall is live physics, not part of the
   * burn's replay: a seek past the cut drops the piece from where it hung,
   * so to SEE it fall, play through the moment it comes loose.
   */
  const watchFrom = (t: number) => {
    setTarget(Math.max(0, t))
    setPlaying(true)
  }

  /** Layers, the solver's own panel, the field's numbers — see `START_ADVANCED`. */
  const [advanced, setAdvanced] = useState(START_ADVANCED)
  const match = useRef<MatchFlameState>({
    position: null,
    state: 'none',
    blow: 0,
    touching: false,
    time: 0,
    litAt: 0,
  })

  const setLayer = (key: keyof Layers, on: boolean) => {
    hold()
    setLayers((l) => ({ ...l, [key]: on }))
  }

  /**
   * Where the burn starts. It sits in the tool rail beside how much burns
   * rather than among the looks: both decide what HAPPENS — whether a piece
   * falls, how long it all takes — and neither changes how any of it looks.
   */
  const setOrigin = (origin: BurnOrigin) => setSettings((s) => ({ ...s, burn: { ...s.burn, origin } }))

  const resetAll = () => {
    setSettings(DEFAULT_SETTINGS)
    try {
      window.localStorage.removeItem(SETTINGS_KEY)
    } catch {
      // Nothing saved, or nowhere to save it: the defaults are back either way.
    }
    toast('Back to the shipped defaults.')
  }

  const paper = (
    <div className="stage">
      <Paper
        ref={paperRef}
        // Frozen, like every harness that gets photographed: a sheet with an
        // idle sway in it is a different picture on every load, and a
        // capture that cannot be repeated cannot be compared.
        //
        // Only for the flat sheet, though: `reducedMotion` switches every
        // simulation OFF, and the hanging sheet is one. It needs none of the
        // freezing either — no wind, so nothing sways. Passed as an explicit
        // false, which also overrides a system that prefers reduced motion:
        // this is a lab, and a burn that cannot cut a piece loose is not
        // the burn being judged.
        reducedMotion={PHYSICS === undefined}
        content={CONTENT}
        physics={
          typeof PHYSICS === 'object' ? { ...PHYSICS, floor: settings.floor ? FLOOR_Y : -1.4 } : PHYSICS
        }
        damage={view}
        scene={
          {
            lighting: LIGHTING,
            floor: { enabled: settings.floor, y: FLOOR_Y },
          } as ComponentProps<typeof Paper>['scene']
        }
      >
        <SheetReady locate={locate} onReady={() => setSheet(true)} />
        <CameraRig
          view={camera}
          at={at}
          locate={locate}
          burn={burn}
          floor={settings.floor}
          pushFrom={plan.phases.find((p) => p.id === 'catch')?.at ?? 0}
          pushTo={plan.phases.find((p) => p.id === 'peak')?.at ?? plan.duration}
        />
        <FxParticles pool={burn.pool} />
        {layers.fluid && (
          <FxFireFluid
            field={burn.field}
            locate={locate}
            quality={TIER}
            params={fluidParams}
            zones={flameZones}
            heatScale={FIRE_OVERRIDES.heatScale}
            sootScale={FIRE_OVERRIDES.sootScale}
            contrast={FIRE_OVERRIDES.contrast}
            opacity={FIRE_OVERRIDES.opacity}
            warm={FIRE_OVERRIDES.warm}
            thin={FIRE_OVERRIDES.thin}
            sharp={FIRE_OVERRIDES.sharp === undefined ? undefined : FIRE_OVERRIDES.sharp !== 0}
            running={playing}
            // Every seek starts the fire over, warmed up from the rim as it
            // stands; paused, a slider change does too, so it shows at once.
            resetKey={fluidKey}
          />
        )}
        {layers.match && <FxMatchFlame match={match} />}
        {layers.light && (
          <FxFireLight
            field={burn.field}
            locate={locate}
            gain={settings.light}
            shadows={settings.fireShadows}
          />
        )}
        {layers.wisps && settings.burn.smoke && (
          <FxWisps glow={burn.glow} field={burn.field} locate={locate} wind={burn.pool.wind} />
        )}
        {post && (
          <FxPost
            quality={TIER}
            bloom={bloom ? (BLOOM_STRENGTH ?? settings.bloom) : 0}
            threshold={THRESHOLD ?? settings.threshold}
            haze={settings.haze}
            focus={settings.focus}
            field={burn.field}
            locate={locate}
          />
        )}
        <Driver
          burn={burn}
          view={view}
          layers={layers}
          detail={detail}
          playing={playing}
          speed={speed}
          onTime={setShown}
          match={match}
          locate={locate}
          until={plan.duration}
          yields={settings.firelight ?? roomYield(LIGHTING)}
          burstAt={plan.severedAt}
          sound={soundRef}
          soundOn={soundOn}
        />
        <Ready
          plan={plan}
          look={settings.look}
          burn={burn}
          view={view}
          locate={locate}
          armed={generation > 0}
          playing={playing}
          nonce={`${fluidKey}:${camera}:${at.u},${at.v}:${detail}:${post}:${bloom}`}
          onReady={startWhenReady}
        />
      </Paper>
    </div>
  )

  // The capture script's page: the stage and nothing else.
  if (bare) return <div className="lab bare">{paper}</div>

  const fill = plan.duration > 0 ? Math.min(100, (shown / plan.duration) * 100) : 0
  const references = [
    ...new Set([
      ...phases.map((p) => p.reference),
      'Never_this.png',
      'Ember_line.png',
      'Ember_line__annotated.png',
      'Char_and_ash_lip.png',
      'Scorch.png',
      'Flame_base.png',
      'Hero.png',
    ]),
  ]

  return (
    <div className="app lab">
      <header className="topbar">
        <Brand />
        <div className="filename">Fire</div>
        <ModeTabs current="fx-lab" />
        <div className="spacer" />
        <LabExport settings={settings} />
      </header>

      {/* The tool: what happens to the sheet, and where you are looking at it from. */}
      <aside className="left">
        <h2>Where it starts</h2>
        <div className="segmented">
          {(['center', 'corner'] as const).map((origin) => (
            <button
              type="button"
              key={origin}
              aria-pressed={settings.burn.origin === origin}
              onClick={() => setOrigin(origin)}
            >
              {origin === 'center' ? 'Centre' : 'Corner'}
            </button>
          ))}
        </div>
        <p className="rail-caption">
          {settings.burn.origin === 'center' ? 'A hole, eating outward.' : 'From a corner, eating upward.'}
        </p>

        <h2>How much burns</h2>
        <div className="chips">
          {AMOUNTS.map((a) => (
            <button
              type="button"
              key={a.amount}
              className="chip"
              aria-pressed={Math.abs(settings.burn.amount - a.amount) < 0.005}
              onClick={() => setAmount(a.amount)}
            >
              {a.amount === CUT_IN_TWO && settings.burn.origin === 'corner' ? '42%' : a.label}
            </button>
          ))}
        </div>
        <Panel
          controls={emphasize(
            [
              numberControl(
                'amount',
                Math.round(settings.burn.amount * 100),
                { min: 5, max: 100, step: 1, label: 'Of the sheet (%)' },
                (v) => setAmount(v / 100),
              ),
            ],
            'wide',
          )}
        />
        <p className="rail-caption">{burnNote(plan, settings.burn.origin)}</p>
        {plan.severedAt !== null && (
          <button
            type="button"
            className="control-button rail-action"
            onClick={() => watchFrom(plan.severedAt! - 1.5)}
          >
            Watch it fall
          </button>
        )}

        <h2>Moments</h2>
        <ul className="presets">
          {phases.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className={near?.id === p.id ? 'active' : ''}
                aria-pressed={near?.id === p.id}
                onClick={() => jump(p.at)}
              >
                <span className="moment-time">{p.at.toFixed(1)}s</span>
                {p.label}
              </button>
            </li>
          ))}
        </ul>
        {advanced && near?.gap && <p className="rail-caption">{near.gap}</p>}

        <h2>Camera</h2>
        <div className="chips">
          <button
            type="button"
            className="chip"
            onClick={() => setCamera('wide')}
            aria-pressed={camera === 'wide'}
          >
            wide
          </button>
          {rimCrops(burn.field).map((crop) => (
            <button
              type="button"
              key={crop.id}
              className="chip"
              onClick={() => {
                setAt({ u: crop.u, v: crop.v })
                setCamera('close')
              }}
              aria-pressed={camera === 'close' && at.u === crop.u && at.v === crop.v}
            >
              {crop.id}
            </button>
          ))}
        </div>

        <h2>Scene</h2>
        <Panel
          controls={emphasize(
            [
              toggle(
                'floor',
                settings.floor,
                (floor) => setSettings({ ...settings, floor }),
                'Floor under the sheet',
              ),
              toggle('sound', soundOn, () => void toggleSound(), 'Sound'),
            ],
            'wide',
          )}
        />

        {advanced && (
          <>
            <h2>Layers</h2>
            {BUILT.map((row) => (
              <label className="lab-layer" key={row.key} title={row.why}>
                <input
                  type="checkbox"
                  checked={layers[row.key]}
                  onChange={(e) => setLayer(row.key, e.target.checked)}
                />
                <span>{row.name}</span>
              </label>
            ))}
            <Panel
              controls={emphasize(
                [
                  numberControl(
                    'detail',
                    detail,
                    { min: 0, max: 1, step: 0.05, label: 'Edge fray (detail)' },
                    setDetail,
                  ),
                ],
                'wide',
              )}
            />

            <h2>Light &amp; post</h2>
            <Panel
              controls={emphasize(
                [
                  toggle('post', post, setPost, 'HDR + the tone curve (off is the renderer’s own)'),
                  // Bloom reads the HDR frame, so it has nothing to do without it.
                  toggle(
                    'bloom',
                    bloom,
                    (on) => post && setBloom(on),
                    'Bloom — paper never blooms, embers do',
                  ),
                ],
                'wide',
              )}
            />

            <h2>The burn</h2>
            <dl className="lab-stats">
              <dt>ignition</dt>
              <dd>
                {settings.burn.origin} · u {ORIGINS[settings.burn.origin].u}, v{' '}
                {ORIGINS[settings.burn.origin].v} · held {HOLD.toFixed(2)}s
              </dd>
              <dt>front</dt>
              <dd>{(stats.front * 100).toFixed(2)}%</dd>
              <dt>remaining</dt>
              <dd>{(stats.remaining * 100).toFixed(1)}%</dd>
              <dt>charred</dt>
              <dd>{stats.charred} cells this step</dd>
              <dt>tier</dt>
              <dd>{TIER}</dd>
            </dl>
          </>
        )}
      </aside>

      <main className="viewport">
        {paper}
        <Feedback context={() => ({ page: 'fx-lab' })} />
      </main>

      {/* The settings: how every layer of the burn looks — or the still it is judged against. */}
      <aside className="right">
        <div className="rail-head">
          <div className="segmented">
            <button type="button" aria-pressed={side === 'tune'} onClick={() => setSide('tune')}>
              Tune
            </button>
            <button type="button" aria-pressed={side === 'refs'} onClick={() => setSide('refs')}>
              References
            </button>
          </div>
          <label
            className="control-toggle"
            title="Layers, the fire simulator's own panel, the field's numbers and the constants"
          >
            <input
              type="checkbox"
              checked={advanced}
              aria-label="Advanced"
              onChange={(e) => setAdvanced(e.target.checked)}
            />
            <span className="control-toggle-track" aria-hidden="true" />
          </label>
          <span className="rail-head-label">Advanced</span>
        </div>
        {savedState !== 'defaults' && (
          <p className="rail-notice">
            {savedState === 'stale'
              ? 'A tune saved in this browser was set aside — the defaults have changed since it was saved. This is what the library ships.'
              : 'Showing a tune saved in this browser, not the shipped defaults. The reset at the bottom of Tune goes back to them.'}
          </p>
        )}
        {side === 'tune' ? (
          <Tune settings={settings} onChange={setSettings} advanced={advanced} onReset={resetAll} />
        ) : (
          <div className="rail-body lab-reference">
            <div className="preset-picker">
              <Select
                className="preset-select"
                label="Reference still"
                value={reference}
                options={references}
                onChange={(name) => setRefName(name)}
              />
              <button
                type="button"
                className="chip"
                aria-pressed={refName === null}
                title="Show the still for whichever moment the burn is at"
                onClick={() => setRefName(null)}
              >
                follow
              </button>
            </div>
            <p className="rail-caption">{near ? near.shows : 'Scrub to a moment to follow its reference.'}</p>
            <Reference key={reference} name={reference} />
          </div>
        )}
      </aside>

      {/* Time, where the editor keeps it. */}
      <footer className="transport">
        <button
          type="button"
          className="play"
          aria-label={playing ? 'Pause' : 'Play'}
          onClick={() => (playing ? hold() : setPlaying(true))}
        >
          {playing ? '❚❚' : '▶'}
        </button>
        <input
          type="range"
          className="scrubber"
          min={0}
          max={plan.duration}
          step={1 / 120}
          value={shown}
          style={{ '--fill': `${fill}%` } as React.CSSProperties}
          aria-label="Time in the burn"
          onChange={(e) => jump(Number(e.target.value))}
        />
        <span className="transport-time">
          {shown.toFixed(2)}s of {plan.duration.toFixed(1)}s · {near ? near.id : '—'}
        </span>
        <div className="segmented">
          <button type="button" onClick={() => setSpeed(1)} aria-pressed={speed === 1}>
            1×
          </button>
          <button type="button" onClick={() => setSpeed(0.25)} aria-pressed={speed === 0.25}>
            ¼×
          </button>
        </div>
        <button type="button" className="chip" onClick={() => jump(0)}>
          Restart
        </button>
      </footer>
      <UIHost />
    </div>
  )
}

/**
 * The lab's way out, in the one place every Paperlab screen keeps it.
 *
 * What the lab makes is a TUNE — every knob behind the burn — so that is what
 * it exports: copied as JSON to hand over and become the default, or kept in
 * this browser for next time. There is no picture here: `<Paper>` draws
 * without a preserved buffer, and the capture scripts photograph the page
 * with `?ui=0` instead.
 */
function LabExport({ settings }: { settings: LabSettings }) {
  const [open, setOpen] = useState(false)
  const [done, setDone] = useState<'copy' | 'save' | null>(null)
  /** The JSON, when the clipboard refused it — handed over in a box instead. */
  const [fallback, setFallback] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])

  const flash = (what: 'copy' | 'save') => {
    setDone(what)
    setTimeout(() => setDone((d) => (d === what ? null : d)), 1600)
  }

  const copy = () => {
    const text = JSON.stringify(settings, null, 2)
    if (!navigator.clipboard) {
      setFallback(text)
      return
    }
    navigator.clipboard.writeText(text).then(
      () => {
        setFallback(null)
        flash('copy')
      },
      () => setFallback(text),
    )
  }

  const save = () => {
    try {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...settings, stamp: DEFAULTS_STAMP }))
      flash('save')
    } catch {
      toast('This browser would not save it — copy it instead.', 'error')
    }
  }

  return (
    <div className="export-menu" ref={rootRef}>
      <button type="button" className="export" onClick={() => setOpen((v) => !v)}>
        Export
      </button>
      {open && (
        <div className="export-dropdown">
          <p className="export-group">This tune</p>
          <button type="button" className="export-primary" onClick={copy}>
            <strong>Copy settings</strong>
            <span>JSON — send it over and it becomes the default</span>
            {done === 'copy' && <span className="copied-badge">Copied ✓</span>}
          </button>
          <div className="export-secondary">
            <button type="button" onClick={save}>
              <strong>Save in this browser</strong>
              <span>it loads next time you open the lab</span>
              {done === 'save' && <span className="copied-badge">Saved ✓</span>}
            </button>
          </div>
          {fallback && (
            <>
              <p className="export-note">The clipboard is blocked here — copy it from the box.</p>
              <textarea className="export-fallback" readOnly rows={8} value={fallback} />
            </>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * The Tune rail: every layer of the burn, live, each group with its own
 * reset — in the editor's own controls, so a slider here is dragged, scrubbed
 * and typed into exactly the way one is in the inspector.
 *
 * Folded, bar the burn: sixty sliders open at once is what finding the look
 * needed, and it is not what looking at one needs.
 */
function Tune({
  settings,
  onChange,
  advanced,
  onReset,
}: {
  settings: LabSettings
  onChange(next: LabSettings): void
  advanced: boolean
  onReset(): void
}) {
  const setLook = (key: keyof Required<DamageLook>, value: number) =>
    onChange({ ...settings, look: { ...settings.look, [key]: value } })
  const setFluid = (fluid: FireFluidParams) => onChange({ ...settings, fluid })
  const setZone = (zone: keyof FireZones, patch: Record<string, number | string>) =>
    onChange({
      ...settings,
      zones: { ...settings.zones, [zone]: { ...settings.zones[zone], ...patch } } as FireZones,
    })
  const fluid = settings.fluid
  const groups = [...new Set(SLIDERS.map((s) => s.group))]
  const burn = settings.burn
  const setBurn = (next: Partial<BurnSettings>) => onChange({ ...settings, burn: { ...burn, ...next } })
  const resetGroup = (group: string) => {
    const look = { ...settings.look }
    for (const s of SLIDERS) if (s.group === group) look[s.key] = DAMAGE_LOOK_DEFAULTS[s.key]
    onChange({ ...settings, look })
  }

  /** One slider, its unit carried in the label — the readout is a number and nothing else. */
  const slider = (
    key: string,
    value: number,
    range: { min: number; max: number; step: number },
    label: string,
    onInput: (v: number) => void,
    unit?: string,
  ): Control => numberControl(key, value, { ...range, label: unit ? `${label} (${unit})` : label }, onInput)
  const wide = (controls: Control[]) => emphasize(controls, 'wide')

  const controls: Control[] = [
    folder('Burn', [
      ...wide([
        slider(
          'decay',
          burn.decay,
          { min: 0.5, max: 6, step: 0.1 },
          'Takes this long to die',
          (v) => setBurn({ decay: v }),
          's',
        ),
        slider(
          'smoulder',
          burn.smoulder,
          { min: 0.2, max: 6, step: 0.1 },
          'Beads smoulder for up to',
          (v) => setBurn({ smoulder: v }),
          's',
        ),
        slider('ash', burn.ash, { min: 0, max: 3, step: 0.05 }, 'Ash off the cooling edge', (v) =>
          setBurn({ ash: v }),
        ),
        toggle('smoke', burn.smoke, (smoke) => setBurn({ smoke }), 'Smoke — off keeps the background clean'),
      ]),
      button('Reset burn', () => onChange({ ...settings, burn: DEFAULT_SETTINGS.burn })),
    ]),

    ...groups.map((group) =>
      folder(
        group,
        [
          ...wide(
            SLIDERS.filter((s) => s.group === group).map((s) =>
              slider(s.key, settings.look[s.key], s, s.label, (v) => setLook(s.key, v), s.unit),
            ),
          ),
          button(`Reset ${group.toLowerCase()}`, () => resetGroup(group)),
        ],
        { collapsed: true },
      ),
    ),

    // The flame, in the four zones it actually has (FireZones) — the same
    // pattern as the sheet's zones above, so a flame is art-directed the way
    // a burnt edge is.
    ...FLAME_ZONE_NAMES.map(({ zone, title, note }) =>
      folder(
        `Flame · ${title}`,
        [
          noteControl(`${zone}-note`, note),
          color(`${zone}-color`, settings.zones[zone].color, (v) => setZone(zone, { color: v }), 'Colour'),
          ...wide(
            FLAME_CONTROLS.filter((c) => c.zone === zone).map((c) =>
              slider(
                `${zone}-${c.key}`,
                (settings.zones[zone] as unknown as Record<string, number>)[c.key] ?? 0,
                c,
                c.label,
                (v) => setZone(zone, { [c.key]: v }),
                c.unit,
              ),
            ),
          ),
          button(`Reset ${title.toLowerCase()}`, () => setZone(zone, { ...FIRE_ZONES[zone] })),
        ],
        { collapsed: true },
      ),
    ),

    // The solver's own panel, in the vocabulary of the tool it was borrowed
    // from: seventeen sliders where at least five move the same thing on
    // screen. It found the look and it is the wrong surface for using one,
    // so it lives behind Advanced rather than being deleted — the next time
    // the fire's motion is wrong, this is what fixes it.
    ...(advanced
      ? [
          folder(
            'Fire simulator',
            [
              ...[...new Set(fireFluidControls.map((c) => c.group))].map((group) =>
                folder(group, [
                  ...wide(
                    fireFluidControls
                      .filter((c) => c.group === group)
                      .map((c) =>
                        slider(c.key, fluid[c.key], c, c.label, (v) => setFluid({ ...fluid, [c.key]: v })),
                      ),
                  ),
                  ...(group === 'Emission'
                    ? wide([
                        slider(
                          'initialVelocityY',
                          fluid.initialVelocity[1],
                          { min: 0, max: 5, step: 0.05 },
                          'Initial velocity Y',
                          (v) =>
                            setFluid({
                              ...fluid,
                              initialVelocity: [fluid.initialVelocity[0], v, fluid.initialVelocity[2]],
                            }),
                        ),
                      ])
                    : []),
                ]),
              ),
              button('Reset fire simulator', () => setFluid(fireFluidDefaults)),
            ],
            { collapsed: true },
          ),
        ]
      : []),

    folder(
      'Fire light',
      wide([
        slider('light', settings.light, { min: 0, max: 80, step: 1 }, 'Gain', (v) =>
          onChange({ ...settings, light: v }),
        ),
        slider(
          'firelight',
          settings.firelight ?? roomYield(LIGHTING),
          { min: 0, max: 1, step: 0.01 },
          'How much the room yields at the fire’s height',
          (v) => onChange({ ...settings, firelight: v }),
        ),
        toggle(
          'fireShadows',
          settings.fireShadows,
          (fireShadows) => onChange({ ...settings, fireShadows }),
          'Casts shadows (one extra shadow pass a frame)',
        ),
      ]),
      { collapsed: true },
    ),

    folder(
      'Bloom & haze',
      wide([
        slider('bloom', settings.bloom, { min: 0, max: 3, step: 0.05 }, 'Bloom strength', (v) =>
          onChange({ ...settings, bloom: v }),
        ),
        // A correctness constant, not a look: below it paper blooms, which is
        // the painted-glow failure the whole pass exists to prevent. It is
        // not something to tune a fire with, so it is only here to be ruled
        // out when something is wrong.
        ...(advanced
          ? [
              slider(
                'threshold',
                settings.threshold,
                { min: 1, max: 6, step: 0.05 },
                'Bloom starts at (a correctness constant — below ~1.6 paper blooms)',
                (v) => onChange({ ...settings, threshold: v }),
              ),
            ]
          : []),
        slider('focus', settings.focus, { min: 0, max: 1, step: 0.01 }, 'Shallow focus on the burn', (v) =>
          onChange({ ...settings, focus: v }),
        ),
        // Last polish item, not a look — see `fxQualityTiers.haze`. It is off
        // on this lab's tier, and it is still placed from where the sprite
        // flames stand rather than from where the fluid burns.
        ...(advanced
          ? [
              slider(
                'haze',
                settings.haze,
                { min: 0, max: 6, step: 0.1 },
                'Heat haze (off on this tier)',
                (v) => onChange({ ...settings, haze: v }),
                'px',
              ),
            ]
          : []),
      ]),
      { collapsed: true },
    ),

    folder(
      'Particles',
      wide([
        slider('embers', settings.rates.embers, { min: 0, max: 1, step: 0.01 }, 'Embers', (v) =>
          onChange({ ...settings, rates: { ...settings.rates, embers: v } }),
        ),
        slider('smoke-rate', settings.rates.smoke, { min: 0, max: 0.3, step: 0.005 }, 'Smoke puffs', (v) =>
          onChange({ ...settings, rates: { ...settings.rates, smoke: v } }),
        ),
        slider('ash-rate', settings.rates.ash, { min: 0, max: 1, step: 0.01 }, 'Ash flakes', (v) =>
          onChange({ ...settings, rates: { ...settings.rates, ash: v } }),
        ),
      ]),
      { collapsed: true },
    ),
  ]

  return (
    <>
      <div className="rail-body">
        <p className="rail-caption">
          Every layer of the burn, live. When a combination looks right, Export copies it — send it over and
          it becomes the default.
        </p>
      </div>
      <Panel controls={controls} />
      <div className="rail-body">
        <button type="button" className="control-button" onClick={onReset}>
          Reset everything to the shipped defaults
        </button>
      </div>
    </>
  )
}

/** One still, or the one sentence that says where they are meant to be. */
function Reference({ name }: { name: string }) {
  const [missing, setMissing] = useState(false)
  if (missing) {
    return (
      <p className="lab-missing">
        <code>{name}</code> did not load. The reference stills live outside this repo — set{' '}
        <code>PAPERLAB_FX_REFS</code> to the <code>fx-refs</code> directory that holds them and restart the
        dev server.
      </p>
    )
  }
  return <img src={`${REF_BASE}/${name}`} alt={name} onError={() => setMissing(true)} />
}

createRoot(document.getElementById('root')!).render(<Lab />)
