/**
 * The fire simulator's controls — by the names, and at the defaults, of the
 * fluid-fire tool Noor pointed at (Emission, Combustion, Fuel & air, Motion
 * & turbulence), so the lab's panel reads like the one she knows.
 *
 * The numbers are the panel's, not the solver's. `solverUniforms` is the one
 * place they are turned into this solver's units — world units (a default
 * sheet is one unit, 210 mm, across) and seconds — so a value can be copied
 * between the two tools and mean roughly the same thing, and so tuning the
 * look never means renaming a control.
 *
 * What the chemistry terms mean here, since no tool documents its own:
 *
 *   fuel              gas released at the burning rim, per second.
 *   premixed oxygen   the share of that gas that arrives already mixed with
 *                     oxygen — it can burn the moment it leaves the paper.
 *   ambient oxygen    oxygen in the surrounding air, which fuel burns with as
 *                     it mixes in. At 0 only the premixed share ever burns,
 *                     so flames stay close to the rim.
 *   heat              temperature released with the gas; hot gas glows and
 *                     rises.
 *   flame persistence how long a parcel that has just burnt keeps looking
 *                     like flame.
 */
export interface FireFluidParams {
  // Emission
  fuel: number
  premixedOxygen: number
  heat: number
  smoke: number
  radialImpulse: number
  initialVelocity: readonly [number, number, number]
  // Combustion
  burnRate: number
  gasExpansion: number
  buoyancy: number
  cooling: number
  smokeProduction: number
  // Fuel & air
  ambientOxygen: number
  flamePersistence: number
  // Motion & turbulence
  turbulence: number
  turbulenceScale: number
  vorticity: number
  wind: number
  /** How long smoke lingers, in seconds — long enough and it hangs as a haze. Ours, not the panel's. */
  smokeFade: number
}

/**
 * The defaults — the panel's names, at the values Noor tuned in the lab on
 * 2026-09-12. No turbulence of its own: the motion comes from vorticity,
 * the radial impulse and the uneven rim that feeds it.
 */
export const fireFluidDefaults: FireFluidParams = {
  fuel: 33.5,
  premixedOxygen: 0.28,
  heat: 3.2,
  smoke: 0.7,
  // Was 5 — a full unit a second, 210 mm/s, of gas pushed sideways out of the
  // rim. Against a buoyancy of 1.7 units/s² that is what rolled the flames
  // into mushroom caps: the grey spirals over the text that the review called
  // the most synthetic thing in the frame. A flame leaves paper going UP.
  radialImpulse: 0.8,
  initialVelocity: [0, 0.5, 0],
  burnRate: 6.1,
  // Was 0.65. Expansion is divergence where the gas burns, and it pushes the
  // gas SIDEWAYS as much as up: at 0.65 each tongue swelled into a puff and
  // the smoke billowed out over the paper. Your web reference is thin licking
  // tongues, and swept at 0.2 / 0.65 / 1.3 the low end is the one that looks
  // like it.
  gasExpansion: 0.3,
  // Was 1.9. With the flame body authored below paper white (see
  // `fx/emission.ts`) a tongue stops registering sooner, so it needs to be
  // carried further before it cools out of sight — 3 puts the tall ones back
  // up into the text the way Hero.png does, and cooling keeps them apart.
  buoyancy: 3,
  // Was 0.92. Gas that stays hot all the way up pools into ONE column: the
  // rim's forty-odd emission points merge a few centimetres above the paper
  // and the fire reads as a single plume with a couple of licks beside it.
  // Hero.png is many separate tongues around the whole rim — tall above,
  // short below — and cooling them faster is what keeps them apart, because
  // each one runs out of glow before it can merge with its neighbour. 1.7
  // stunted them; 1.15 keeps the tall ones and still holds them apart.
  cooling: 1.15,
  // Was 1.4, which made a thick grey column. Noor's direction is light smoke.
  smokeProduction: 0.5,
  ambientOxygen: 0.47,
  // Was 0.005 — the slider's own floor, which is to say switched off. The
  // flame channel decayed with a 5 ms time constant, so it was an
  // instantaneous quantity with no history and therefore no shape.
  flamePersistence: 0.06,
  // Was 0, also switched off, with all the motion coming from vorticity and
  // the radial impulse — a few big eddies instead of many small ones, which
  // is the difference between a fire that tears and one that curls. Swept
  // against the peak frame: at 2 the flames are still a single plume, at 9
  // they break into separate tongues around the rim.
  turbulence: 9,
  // Finer eddies with it: 6.8 was ~24 mm, 12 is ~14 mm, and the smoke stops
  // reading as a few big hooks.
  turbulenceScale: 12,
  // Was 6.1. Vorticity confinement gives back the swirls the grid smooths
  // away; at 6 it was manufacturing swirls the flow never had.
  vorticity: 3,
  wind: 0.8,
  smokeFade: 4.2,
}

/** Slider ranges for the lab, grouped the way the panel groups them. */
export const fireFluidControls: readonly {
  group: string
  key: Exclude<keyof FireFluidParams, 'initialVelocity'>
  label: string
  min: number
  max: number
  step: number
}[] = [
  { group: 'Emission', key: 'fuel', label: 'Fuel', min: 0, max: 50, step: 0.1 },
  { group: 'Emission', key: 'premixedOxygen', label: 'Premixed oxygen', min: 0, max: 1, step: 0.01 },
  { group: 'Emission', key: 'heat', label: 'Heat', min: 0, max: 5, step: 0.1 },
  { group: 'Emission', key: 'smoke', label: 'Smoke', min: 0, max: 2, step: 0.05 },
  { group: 'Emission', key: 'radialImpulse', label: 'Radial impulse', min: 0, max: 5, step: 0.1 },
  { group: 'Combustion', key: 'burnRate', label: 'Burn rate', min: 0, max: 10, step: 0.1 },
  { group: 'Combustion', key: 'gasExpansion', label: 'Gas expansion', min: 0, max: 3, step: 0.05 },
  { group: 'Combustion', key: 'buoyancy', label: 'Buoyancy', min: 0, max: 6, step: 0.1 },
  { group: 'Combustion', key: 'cooling', label: 'Cooling', min: 0, max: 3, step: 0.01 },
  { group: 'Combustion', key: 'smokeProduction', label: 'Smoke production', min: 0, max: 4, step: 0.05 },
  { group: 'Fuel & air', key: 'ambientOxygen', label: 'Ambient oxygen', min: 0, max: 1, step: 0.01 },
  {
    group: 'Fuel & air',
    key: 'flamePersistence',
    label: 'Flame persistence',
    min: 0.005,
    max: 1,
    step: 0.005,
  },
  // 0–10 while the default was 0. Now that turbulence is what breaks the
  // flames into tongues, the tuned value has to sit somewhere a slider can
  // move in BOTH directions — see the test.
  { group: 'Motion & turbulence', key: 'turbulence', label: 'Turbulence', min: 0, max: 20, step: 0.1 },
  {
    group: 'Motion & turbulence',
    key: 'turbulenceScale',
    label: 'Turbulence scale',
    min: 0.5,
    max: 24,
    step: 0.1,
  },
  { group: 'Motion & turbulence', key: 'vorticity', label: 'Vorticity', min: 0, max: 8, step: 0.1 },
  { group: 'Motion & turbulence', key: 'wind', label: 'Wind', min: -3, max: 3, step: 0.05 },
  { group: 'Look', key: 'smokeFade', label: 'Smoke lingers (s)', min: 0.2, max: 10, step: 0.1 },
]

/** What the solver's passes read, in its own units. */
export interface SolverUniforms {
  fuel: number
  premixed: number
  heat: number
  smoke: number
  radial: number
  initialVelocity: [number, number]
  burnRate: number
  heatRelease: number
  expansion: number
  buoyancy: number
  cooling: number
  smokeProduction: number
  smokeFade: number
  ambient: number
  persistence: number
  turbulence: number
  turbulenceScale: number
  vorticity: number
  wind: number
}

/**
 * The panel's numbers, in the solver's units. Every scale here is a tuning
 * decision made by eye against the references, stated once so it is never
 * smeared across shaders.
 */
export function solverUniforms(p: FireFluidParams): SolverUniforms {
  const finite = (x: number, fallback: number) => (Number.isFinite(x) ? x : fallback)
  return {
    // Gas per second per unit of source strength.
    fuel: Math.max(0, finite(p.fuel, 0)) * 0.12,
    premixed: Math.min(1, Math.max(0, finite(p.premixedOxygen, 0))),
    // Temperature released with the gas, per second. At 1.8 the gas at the
    // source settled near a third of glowing — cooling took the heat faster
    // than the rim gave it — and the fire was a faint blush, not a flame.
    heat: Math.max(0, finite(p.heat, 0)) * 7,
    smoke: Math.max(0, finite(p.smoke, 0)) * 0.45,
    // World units a second: A4 flames climb a few tens of centimetres a second.
    radial: Math.max(0, finite(p.radialImpulse, 0)) * 0.2,
    initialVelocity: [finite(p.initialVelocity[0], 0) * 0.25, finite(p.initialVelocity[1], 0) * 0.25],
    // Per second.
    burnRate: Math.max(0, finite(p.burnRate, 0)) * 2,
    // Temperature a unit of burnt fuel adds.
    heatRelease: 3,
    // Divergence per unit of burning a second — the gas expanding as it burns.
    expansion: Math.max(0, finite(p.gasExpansion, 0)) * 1.5,
    // World units a second squared per unit of temperature.
    buoyancy: Math.max(0, finite(p.buoyancy, 0)) * 0.9,
    // Per second: a flame at A4 scale has cooled out of sight 10–40 mm up.
    cooling: Math.max(0, finite(p.cooling, 0)) * 6,
    smokeProduction: Math.max(0, finite(p.smokeProduction, 0)) * 0.3,
    smokeFade: Math.max(0.05, finite(p.smokeFade, 2.5)),
    ambient: Math.min(1, Math.max(0, finite(p.ambientOxygen, 0))),
    persistence: Math.max(0.005, finite(p.flamePersistence, 0.085)),
    turbulence: Math.max(0, finite(p.turbulence, 0)) * 0.35,
    // Noise frequency per world unit: 4.6 → ~36 mm eddies.
    turbulenceScale: Math.max(0.1, finite(p.turbulenceScale, 4.6)) * 6,
    vorticity: Math.max(0, finite(p.vorticity, 0)),
    wind: finite(p.wind, 0) * 0.3,
  }
}
