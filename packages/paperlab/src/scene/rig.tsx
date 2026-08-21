import { createContext, useContext, type ReactNode } from 'react'
import type { LightingName } from '../config/schema'
import { getLightingPreset, type LightingPreset } from './lighting'

/**
 * The rig in force, for anything that has to agree with the lamps.
 *
 * Transmission is the reason this exists. `translucencyValues()` reads the
 * key light's own position and colour so a sheet's backlit glow can never
 * disagree with the lamp casting its shadow — but it read it from the
 * paper's OWN `scene.lighting`, and in stage mode the banners never carried
 * one. Every banner in every stage computed its glow from `studio`, a lamp
 * up and to the right, while the hall was lit by `nave` from behind. The
 * coupling was correct and the wire was missing.
 *
 * So the scene publishes the rig it is actually using, and the paper reads
 * that in preference to its own name. Outside a stage there is no provider,
 * nothing changes, and a paper lights itself as it always did.
 */
const LightRigContext = createContext<LightingPreset | null>(null)

export function LightRig({ rig, children }: { rig: LightingPreset; children: ReactNode }) {
  return <LightRigContext.Provider value={rig}>{children}</LightRigContext.Provider>
}

/** The scene's rig if one is published, otherwise the paper's own preset. */
export function useLightRig(own: LightingName): LightingPreset {
  return useContext(LightRigContext) ?? getLightingPreset(own)
}
