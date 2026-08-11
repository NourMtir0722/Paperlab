import type { ContentConfig, PaperConfig, PaperStatesInput } from './schema'
import { diffConfig } from './diff'
import { AGENT_PAYLOAD_VERSION } from './agent-payload'
import { getLayout } from '../field/layouts'

/**
 * Field-mode export. Every preset a field references is INLINED as a const —
 * receivers don't have the sender's local preset library. Same fixed payload
 * anatomy as the single-paper export, same version.
 */

export interface FieldExportPaper {
  /** Display name of the preset this slot uses (const naming + description). */
  presetName: string
  /** The RESOLVED preset config (user presets included — nothing to fetch). */
  preset: PaperConfig
  content?: ContentConfig
  /** Per-slot state overrides (slot 3's hover deeper than slot 4's). */
  states?: PaperStatesInput
}

export interface FieldExportZone {
  id: string
  accept?: string[]
  bounds: { position: [number, number, number]; size: [number, number] }
  highlight?: 'none' | 'glow' | 'outline'
}

export interface FieldExportInput {
  layout: string
  layoutOptions?: Record<string, unknown>
  motion?: { driver?: 'autoplay' | 'drag' | 'none'; speed?: number }
  entrance?: { type?: 'rise' | 'scatter' | 'none'; stagger?: number; duration?: number }
  papers: FieldExportPaper[]
  /** Drop zones — exported as `<DropZone>` children with an onPlace stub. */
  zones?: FieldExportZone[]
}

const MOTION_DEFAULTS = { driver: 'autoplay', speed: 0.5 }
const ENTRANCE_DEFAULTS = { type: 'rise', stagger: 0.06, duration: 0.9 }

function camel(name: string): string {
  const id = name.replace(/[^a-zA-Z0-9]+(.)/g, (_, c: string) => c.toUpperCase()).replace(/[^a-zA-Z0-9]/g, '')
  const safe = /^[A-Za-z]/.test(id) ? id : `preset${id}`
  return safe.charAt(0).toLowerCase() + safe.slice(1)
}

interface DistinctPreset {
  varName: string
  presetName: string
  preset: PaperConfig
}

/** Distinct presets in slot order, with collision-safe const names. */
export function distinctFieldPresets(input: FieldExportInput): DistinctPreset[] {
  const byKey = new Map<string, DistinctPreset>()
  const usedNames = new Set<string>()
  for (const paper of input.papers) {
    const key = JSON.stringify(paper.preset)
    if (byKey.has(key)) continue
    let varName = camel(paper.presetName)
    while (usedNames.has(varName)) varName += '2'
    usedNames.add(varName)
    byKey.set(key, { varName, presetName: paper.presetName, preset: paper.preset })
  }
  return [...byKey.values()]
}

function nonDefault<T extends Record<string, unknown>>(
  value: T | undefined,
  defaults: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value ?? {})) {
    if (v !== undefined && v !== defaults[k]) out[k] = v
  }
  return out
}

/** The layout/motion/entrance props of the export, defaults stripped. */
export function diffFieldProps(input: FieldExportInput): Record<string, unknown> {
  const out: Record<string, unknown> = { layout: input.layout }
  const layout = getLayout(input.layout)
  const layoutOptions = nonDefault(input.layoutOptions ?? {}, layout.defaults as Record<string, unknown>)
  if (Object.keys(layoutOptions).length > 0) out.layoutOptions = layoutOptions
  const motion = nonDefault(input.motion, MOTION_DEFAULTS)
  if (Object.keys(motion).length > 0) out.motion = motion
  const entrance = nonDefault(input.entrance, ENTRANCE_DEFAULTS)
  if (Object.keys(entrance).length > 0) out.entrance = entrance
  return out
}

const LAYOUT_PHRASES: Record<string, string> = {
  ring: 'a ring you can see around',
  fan: 'a fanned swatch deck hinged at one corner',
  spread: 'a stack slid sideways, each sheet bowing further than the last',
  pile: 'a heap on a desk, the sheets underneath pressed flat',
  wall: 'a pinned studio wall of sheets, none hanging quite square',
  spill: 'a dropped stack caught mid-air, each sheet bent its own way',
  sheet: 'a stamp-block grid on a shared backing sheet',
}

/** The one-line visual an agent verifies after `npm run dev`. */
export function describeFieldConfig(input: FieldExportInput): string {
  const n = input.papers.length
  const stateful = input.papers.some((p) => p.preset.states || p.states)
  const zones = input.zones ?? []
  const parts: string[] = []

  if (input.layout === 'sheet') {
    const rows = Number(input.layoutOptions?.rows ?? 2)
    const columns = Number(input.layoutOptions?.columns ?? 5)
    parts.push(`a ${rows}×${columns} sheet of papers on a shared backing`)
  } else {
    const layoutPhrase = LAYOUT_PHRASES[input.layout] ?? `a ${input.layout} layout`
    parts.push(`${n} papers arranged in ${layoutPhrase}`)
  }

  const driver = input.motion?.driver ?? 'autoplay'
  if (stateful) {
    // Stateful fields render static and interactive — the motion driver is moot.
    parts.push('hovering peels/reacts per paper (interaction states)')
    if (zones.length > 0) {
      parts.push(
        `dragging one past its tear threshold detaches it to carry to the ${zones
          .map((z) => z.id)
          .join(' or ')} zone (release elsewhere flutters it back)`,
      )
    }
  } else {
    if (driver === 'autoplay') parts.push('slowly orbiting on their own')
    if (driver === 'drag') parts.push('draggable sideways with the pointer')
    if (zones.length > 0) parts.push(`${zones.length} drop zone${zones.length > 1 ? 's' : ''}`)
  }

  const distinct = distinctFieldPresets(input)
  if (distinct.length > 1) {
    parts.push(`mixing ${distinct.length} paper presets (${distinct.map((d) => d.presetName).join(', ')})`)
  }
  return parts.join(', ')
}

/** Component source shared by the JSX snippet and the agent payload. */
export function buildFieldComponentSource(input: FieldExportInput): string {
  const distinct = distinctFieldPresets(input)
  const varByKey = new Map(distinct.map((d) => [JSON.stringify(d.preset), d.varName]))

  // `satisfies` (not `as const`) — const-asserted arrays turn readonly and
  // stop matching the library's input types.
  const consts = distinct
    .map(
      (d) =>
        `const ${d.varName} = ${JSON.stringify(diffConfig(d.preset), null, 2)} satisfies PaperConfigInput`,
    )
    .join('\n\n')

  const slots = input.papers
    .map((paper) => {
      const varName = varByKey.get(JSON.stringify(paper.preset))!
      const content = paper.content ? `, content: ${JSON.stringify(paper.content)}` : ''
      const states = paper.states ? `, states: ${JSON.stringify(paper.states)}` : ''
      return `  { preset: ${varName}${content}${states} },`
    })
    .join('\n')

  const props = Object.entries(diffFieldProps(input))
    .map(([key, value]) =>
      typeof value === 'string' ? `      ${key}="${value}"` : `      ${key}={${JSON.stringify(value)}}`,
    )
    .join('\n')

  const zones = input.zones ?? []
  const zoneImport = zones.length > 0 ? ', DropZone' : ''
  const zoneChildren = zones
    .map((zone) => {
      const accept = zone.accept ? ` accept={${JSON.stringify(zone.accept)}}` : ''
      const highlight = zone.highlight && zone.highlight !== 'glow' ? ` highlight="${zone.highlight}"` : ''
      return `      <DropZone
        id="${zone.id}"${accept}
        bounds={${JSON.stringify(zone.bounds)}}${highlight}
        onPlace={(paper, zone) => {
          // First-run smoke test — you should see this in the console on drop:
          console.log(paper.presetName, '→', zone.id)
          // Then replace it: stamp a postmark, advance the flow, persist the placement, …
        }}
      />`
    })
    .join('\n')

  if (zones.length === 0) {
    return `import { PaperField, type FieldPaperSlot, type PaperConfigInput${zoneImport} } from 'paperlab'

${consts}

const papers: FieldPaperSlot[] = [
${slots}
]

export function PaperGallery() {
  return (
    <PaperField
      papers={papers}
${props}
    />
  )
}`
  }

  return `import { PaperField, type FieldPaperSlot, type PaperConfigInput${zoneImport} } from 'paperlab'

${consts}

const papers: FieldPaperSlot[] = [
${slots}
]

export function PaperGallery() {
  return (
    <PaperField
      papers={papers}
${props}
    >
${zoneChildren}
    </PaperField>
  )
}`
}

/** The self-contained field integration brief — one paste into a coding agent. */
export function buildFieldAgentPayload(input: FieldExportInput): string {
  return `Integrate a Paperlab paper gallery into this project. (paperlab agent-payload v${AGENT_PAYLOAD_VERSION})

1. Install the dependencies:

   npm i paperlab three @react-three/fiber gsap

2. Create the component below as \`components/PaperGallery.tsx\` (or the
   project's component convention). It is self-contained — every preset it
   uses is inlined, and it owns its own <Canvas>:

\`\`\`tsx
${buildFieldComponentSource(input)}
\`\`\`

3. Sizing: the component fills its parent container. Place it where I ask;
   give the parent an explicit height.

4. Verify: run the dev server. You should see ${describeFieldConfig(input)}.
   If the canvas is blank, the parent container almost certainly has no height —
   give it one (this is the classic React Three Fiber integration bug, not a
   paperlab bug).

Constraints: don't modify the preset values; three >= 0.160 and React 19 are
required; the component needs no props.`
}
