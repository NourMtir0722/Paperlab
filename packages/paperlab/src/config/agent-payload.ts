import type { PaperConfig } from './schema'
import { getStock } from '../core/stock'
import { diffConfig } from './diff'

/**
 * The primary export consumer is a coding agent; the human is the courier.
 * This template IS product surface: versioned, snapshot-tested, regenerated
 * from the config. Anatomy is fixed — install → inlined code → placement
 * contract → a verification step the agent can self-check → pre-empted
 * failure modes.
 */
/**
 * v2: field exports (multi-preset galleries with inlined preset consts).
 * v3: interaction states, sheet/backing fields, drop zones, carry/flight.
 */
export const AGENT_PAYLOAD_VERSION = 3

const BEHAVIOR_PHRASES: Record<string, (o: Record<string, unknown>) => string> = {
  peel: (o) => `its ${String(o.corner ?? 'bottom-right').replace('-', ' ')} corner peeling up`,
  unroll: (o) =>
    (o.progress as number) < 0.35
      ? 'mostly wound into a roll at the bottom'
      : 'unrolling from a paper roll at the bottom',
  flip: () => 'mid page-turn',
  'letter-fold': () => 'tri-folding like a letter',
  hang: () => 'hanging from its top edge, rippling',
  fly: () => 'arched and fluttering like it is airborne',
  fall: () => 'rippling with one corner lifted, like a dropped sheet',
  ribbon: (o) =>
    `hanging the full drop of the room and pooling on the floor, about ${Math.round((o as { pool: number }).pool * 100)}% of its length lying over`,
  settle: (o) =>
    (o as { relax: number }).relax > 0.7
      ? 'lying where it landed, flat but for one corner the stiffness kept'
      : 'just come to rest, still holding a little of the shape it fell in',
  carry: () => 'drooping from a pinched corner, fluttering as if being carried',
  flight: (o) =>
    o.path === 'loop' ? 'tumbling through a seamless airborne loop' : 'tumbling across the scene on the wind',
  crumple: (o) =>
    (o.progress as number) < 0.3
      ? 'lightly handled — a few soft creases across it'
      : (o.progress as number) < 0.7
        ? 'crushed into irregular creased facets, as if screwed up and flattened out again'
        : 'balled up in a fist',
}

/** One line an agent can verify against what it sees after `npm run dev`. */
export function describeConfig(config: PaperConfig): string {
  const stock = getStock(config.stock)
  const size = `${config.sheet.width}×${config.sheet.height}`

  let contentPhrase = 'a blank sheet'
  if (config.content.type === 'image') contentPhrase = 'a sheet printed with an image'
  if (config.content.type === 'text') contentPhrase = 'a sheet with typeset text'
  if (config.content.type === 'receipt') contentPhrase = `a store receipt for "${config.content.store}"`

  const parts = [`${contentPhrase} on ${stock.label.toLowerCase()} paper stock (${size})`]

  if (typeof config.physics === 'object') {
    parts.push(
      config.physics.pins === 'none'
        ? 'falling and settling as cloth'
        : `pinned (${config.physics.pins}) and moving like cloth in wind`,
    )
  } else if (config.behavior) {
    const phrase = BEHAVIOR_PHRASES[config.behavior.type]
    if (phrase) parts.push(phrase(config.behavior as Record<string, unknown>))
  }

  if (config.surface.deckle) {
    parts.push(
      `torn (deckled) ${config.surface.deckle.edges.join(' and ')} edge${config.surface.deckle.edges.length > 1 ? 's' : ''}`,
    )
  }
  if ((config.surface.aging ?? 0) > 0.3) parts.push('visibly aged and yellowed')

  return parts.join(', ')
}

function componentName(config: PaperConfig): string {
  const raw = config.meta.name === 'untitled' ? 'PaperlabPaper' : config.meta.name
  const pascal = raw
    .replace(/[^a-zA-Z0-9]+(.)/g, (_, c: string) => c.toUpperCase())
    .replace(/^./, (c) => c.toUpperCase())
    .replace(/[^a-zA-Z0-9]/g, '')
  return /^[A-Za-z]/.test(pascal) ? pascal : `Paper${pascal}`
}

/** The self-contained integration brief — one paste into a coding agent. */
export function buildAgentPayload(config: PaperConfig): string {
  const name = componentName(config)
  const preset = JSON.stringify(diffConfig(config), null, 2)

  return `Integrate a Paperlab paper component into this project. (paperlab agent-payload v${AGENT_PAYLOAD_VERSION})

1. Install the dependencies:

   npm i paperlab three @react-three/fiber gsap

2. Create the component below as \`components/${name}.tsx\` (or the project's
   component convention). It is self-contained and owns its own <Canvas>:

\`\`\`tsx
import { Paper, type PaperConfigInput } from 'paperlab'

const preset = ${preset.replace(/\n/g, '\n')} satisfies PaperConfigInput

export function ${name}() {
  return <Paper preset={preset} />
}
\`\`\`

3. Sizing: the component fills its parent container. Place it where I ask;
   give the parent an explicit height.

4. Verify: run the dev server. You should see ${describeConfig(config)}.
   If the canvas is blank, the parent container almost certainly has no height —
   give it one (this is the classic React Three Fiber integration bug, not a
   paperlab bug).

Constraints: don't modify the preset values; three >= 0.160 and React 19 are
required; the component needs no props.`
}
