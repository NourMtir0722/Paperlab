/**
 * The fire simulator's controls — by the names, and at the defaults, of the
 * fluid-fire tool it was modelled on (Emission, Combustion, Fuel & air, Motion
 * & turbulence), so the lab's panel reads like that one.
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
 *   heat              temperature released with the gas — paper's gas leaves
 *                     it hot, and that heat is what lets its soot form and
 *                     glow before it has burnt (swept to 1, most of the flame
 *                     went out).
 *   flame persistence how long glowing soot lasts in open air before it
 *                     burns away — the soot a flame's light comes from.
 *   air mixing        how fast air works into the fuel, and so how far up a
 *                     tongue's fuel core survives.
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
  /**
   * How fast air works its way into the fuel, 0..1. Ours, not the panel's.
   * Low and the fuel core survives a long way up — tall tongues with long
   * tips; high and the fuel burns out close to the paper — short licks.
   */
  airMixing: number
  // Motion & turbulence
  turbulence: number
  turbulenceScale: number
  vorticity: number
  wind: number
  /** How long smoke lingers, in seconds — long enough and it hangs as a haze. Ours, not the panel's. */
  smokeFade: number
  /**
   * How long a spot of the rim goes on smoking once its flame is out, in
   * seconds. Ours, not the panel's. Paper does not stop smoking when it stops
   * burning: the char is still hot, and a thin thread goes on rising from it.
   */
  smokeAfter: number
}

/**
 * The defaults — the panel's names, at the values tuned in the lab. No turbulence of its own: the motion comes from vorticity,
 * the radial impulse and the uneven rim that feeds it.
 */
export const fireFluidDefaults: FireFluidParams = {
  fuel: 33.5,
  premixedOxygen: 0.28,
  heat: 3.2,
  smoke: 0.7,
  // Was 5 — a full unit a second, 210 mm/s, of gas pushed sideways out of the
  // rim. Against a buoyancy of 1.7 units/s² that is what rolled the flames
  // into mushroom caps: the grey spirals over the text that a visual review called
  // the most synthetic thing in the frame. A flame leaves paper going UP.
  radialImpulse: 0.8,
  // In world units a second now (see `solverUniforms`): 1.4 is ~0.3 m/s, the
  // speed gas leaves burning paper with. It was 0.5 at a quarter scale —
  // 26 mm/s — and gas held that slow pooled into a bulb at the rim before
  // buoyancy stretched it into a neck: every flame was a droplet.
  initialVelocity: [0, 1.4, 0],
  burnRate: 6.1,
  // Was 0.65. Expansion is divergence where the gas burns, and it pushes the
  // gas SIDEWAYS as much as up: at 0.65 each tongue swelled into a puff and
  // the smoke billowed out over the paper. Your web reference is thin licking
  // tongues, and swept at 0.2 / 0.65 / 1.3 the low end is the one that looks
  // like it.
  gasExpansion: 0.3,
  // Was 3, when the flame body was authored below paper white and a tongue
  // needed carrying further to register. Now the gas leaves the rim at its
  // real speed and glows above paper white, and 3 threw tongues past the
  // text; 2 holds them lower. (1.5 was no shorter — height is set by how
  // soon the gas cools, below — only broader and slower.)
  buoyancy: 2,
  // Was 0.92. Gas that stays hot all the way up pools into ONE column: the
  // rim's forty-odd emission points merge a few centimetres above the paper
  // and the fire reads as a single plume with a couple of licks beside it.
  // Hero.png is many separate tongues around the whole rim — tall above,
  // short below — and cooling them faster is what keeps them apart, because
  // each one runs out of glow before it can merge with its neighbour.
  //
  // 1.8 since a flame's light comes from soot that only lives in hot gas:
  // cooling is now what sets a tongue's HEIGHT. Swept in live play: 1.15
  // reached the text (~150 mm), 1.6 ~100 mm, 2.1 short licks (~60 mm);
  // Hero.png's tallest is ~70 mm.
  cooling: 1.8,
  // Was 1.4, which made a thick grey column, then 0.5. The direction is
  // light smoke, and with MacCormack advection keeping the smoke's fine
  // structure it needs less of it to read: at 0.5 it veiled the upper sheet.
  smokeProduction: 0.25,
  ambientOxygen: 0.47,
  // Was 0.005 — the slider's own floor, which is to say switched off. The
  // flame channel decayed with a 5 ms time constant, so it was an
  // instantaneous quantity with no history and therefore no shape.
  flamePersistence: 0.06,
  airMixing: 0.5,
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
  // Was 4.2 s. Smoke that lingers that long is stretched by the flow into
  // long grey veins, and sharper advection keeps every one of them — so the
  // whole upper sheet and the black stage behind it came out MARBLED. Real
  // paper smoke thins out within a second or two. Swept in live play against
  // the default: 1.5 s is thin threads and a clean sheet.
  smokeFade: 1.5,
  smokeAfter: 4,
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
  { group: 'Fuel & air', key: 'airMixing', label: 'Air mixing', min: 0, max: 1, step: 0.01 },
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
  { group: 'Look', key: 'smokeAfter', label: 'Smoke after the flames (s)', min: 0, max: 12, step: 0.1 },
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
  /** Share of the neighbours' oxygen mixed in per step, in the plane. */
  mixing: number
  /** Per second: air drawn in from in front of and behind the slice. */
  entrain: number
  /** Fuel density at which entrainment is down to 1/e — dense fuel keeps air out. */
  fuelBlock: number
  /** Soot formed per unit of hot fuel a second. */
  sootYield: number
  /** The temperature soot needs to form and glow at. */
  sootHeat: number
  /** Units of air a unit of fuel burns with. */
  stoich: number
  /** Smoke a second, per unit of smouldering strength, where a flame has gone out. */
  smoulderSmoke: number
  /** Heat with it — enough that the smoke rises, not enough to glow. */
  smoulderHeat: number
  turbulence: number
  turbulenceScale: number
  /** Noise units a second the turbulence changes by, on top of rising with the gas. */
  turbulenceEvolve: number
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
    // World units a second, one to one — a unit is 210 mm.
    initialVelocity: [finite(p.initialVelocity[0], 0), finite(p.initialVelocity[1], 0)],
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
    mixing: Math.min(1, Math.max(0, finite(p.airMixing, 0.5))) * 0.5,
    entrain: Math.min(1, Math.max(0, finite(p.airMixing, 0.5))) * 40,
    fuelBlock: 0.05,
    sootYield: 30,
    sootHeat: 2,
    // Paper's gas takes several times its own mass of air to burn; what
    // matters here is only that it is well above one, so fuel near the rim is
    // denser than the air that can reach it and burns from the outside in.
    stoich: 4,
    // Several times the rim's own smoke per unit strength: a smouldering spot
    // has no flame to lift its smoke fast, so it pools and rises slowly, and
    // at 1.5× it read 0.03 at the 99th percentile — about 3% opacity, gone —
    // at 8× 0.07, and at 30× thin wisps you had to look for.
    smoulderSmoke: Math.max(0, finite(p.smoke, 0)) * 0.45 * 80,
    smoulderHeat: 1.2,
    turbulence: Math.max(0, finite(p.turbulence, 0)) * 0.35,
    // Noise frequency per WORLD unit — the pass multiplies by the domain's
    // size, which it did not before (it read UV, and the domain is two units
    // tall, so every eddy was half the size this said). 12 → ~14 mm eddies.
    turbulenceScale: Math.max(0.1, finite(p.turbulenceScale, 4.6)) * 1.25,
    turbulenceEvolve: 3,
    vorticity: Math.max(0, finite(p.vorticity, 0)),
    wind: finite(p.wind, 0) * 0.3,
  }
}
