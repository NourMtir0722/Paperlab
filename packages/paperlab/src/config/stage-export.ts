import { AGENT_PAYLOAD_VERSION } from './agent-payload'
import { getLayout } from '../field/layouts'
import { stageSchema, type StageConfig, type StageConfigInput } from '../stage/schema'
import { walkNames, walks } from '../stage/walks'
import type { WalkName } from '../stage/walks'

/**
 * Stage-mode export. Same anatomy and version as the paper and field
 * exports, with one addition that matters more than the rest: the scroll
 * variant. `progress` is the whole interaction model of a stage, and a
 * scroll-driven hero is what most people opening this menu actually want —
 * so the export writes the pinning and the scroll math, which is the part
 * that is fiddly to get right and boring to write.
 */

export interface StageExportInput {
  stage: StageConfigInput
  layout: string
  layoutOptions?: Record<string, unknown>
  /** The words the space is built from. Omitted renders blank banners. */
  text?: string
  count?: number
  /** Bind the walk to page scroll, pinned, rather than to the clock. */
  scroll?: boolean
  /** Exported component name. */
  componentName?: string
}

/** How many viewport-heights of scroll the walk is spread over. */
const SCROLL_HEIGHTS = 4

/** Which named walk these points are, if any — the export reads better for it. */
export function walkNameFor(path: StageConfig['path']): WalkName | undefined {
  const key = JSON.stringify({ points: path.points, closed: path.closed })
  return walkNames.find(
    (name) => JSON.stringify({ points: walks[name].points, closed: walks[name].closed }) === key,
  )
}

/** Deep-strip anything that already equals the schema default. */
function stripDefaults(value: unknown, defaults: unknown): unknown {
  if (Array.isArray(value) || Array.isArray(defaults)) {
    return JSON.stringify(value) === JSON.stringify(defaults) ? undefined : value
  }
  if (value && defaults && typeof value === 'object' && typeof defaults === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const kept = stripDefaults(child, (defaults as Record<string, unknown>)[key])
      if (kept !== undefined) out[key] = kept
    }
    return Object.keys(out).length > 0 ? out : undefined
  }
  return value === defaults ? undefined : value
}

/** The stage config with defaults removed — what actually needs writing down. */
export function diffStage(stage: StageConfigInput): Record<string, unknown> {
  const resolved = stageSchema.parse(stage)
  const defaults = stageSchema.parse({})
  const diff = (stripDefaults(resolved, defaults) as Record<string, unknown>) ?? {}
  // A path is atomic. Field-by-field stripping would export a curved walk's
  // points while dropping `closed: false` for matching the default — which
  // parses correctly today and quietly breaks the moment someone edits those
  // points into a loop. Emit the whole walk or none of it.
  if (diff.path !== undefined) diff.path = resolved.path
  return diff
}

/**
 * JSON.stringify, except an array of plain numbers stays on one line. A walk
 * is a list of coordinate pairs, and the default pretty-printer spreads each
 * `[6, 17]` over four lines — twenty lines of punctuation for one gentle
 * curve. Exported code is a product surface; it should read like something a
 * person wrote.
 */
export function stringifyStage(value: unknown, indent = 0): string {
  const pad = '  '.repeat(indent)
  const inner = '  '.repeat(indent + 1)
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    if (value.every((v) => typeof v === 'number')) return `[${value.join(', ')}]`
    const items = value.map((v) => `${inner}${stringifyStage(v, indent + 1)}`)
    return `[\n${items.join(',\n')}\n${pad}]`
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) return '{}'
    const items = entries.map(([k, v]) => `${inner}${JSON.stringify(k)}: ${stringifyStage(v, indent + 1)}`)
    return `{\n${items.join(',\n')}\n${pad}}`
  }
  return JSON.stringify(value)
}

const SHOT_PHRASES: Record<string, string> = {
  follow: 'from behind and a little above them, looking up the walk',
  lead: 'from in front, walking backward as they come on',
  low: 'from down at floor level, looking up the banners',
  wide: 'from off to one side, level with them',
}

/** The one-line visual an agent verifies after `npm run dev`. */
export function describeStage(input: StageExportInput): string {
  const stage = stageSchema.parse(input.stage)
  const count = input.count ?? 22
  const walk = walkNameFor(stage.path)
  const parts: string[] = []

  const shape =
    walk === 'straight' || walk === undefined
      ? 'a straight walk'
      : walk === 'ring'
        ? 'a closed loop of a walk'
        : `an "${walk}" walk that curves as it goes`
  parts.push(`${count} tall paper banners standing along ${shape}`)

  if (input.text?.trim()) {
    parts.push('each printed with a column of your text running down it')
  }
  if (stage.showFigure) {
    parts.push(`a small dark figure walking between them, seen ${SHOT_PHRASES[stage.shot.shot]}`)
  }
  parts.push(
    stage.lighting === 'nave'
      ? 'the whole space dim and lit from behind, so the paper glows and the far end of the walk is a bright void'
      : `lit with the "${stage.lighting}" preset`,
  )
  if (input.scroll) parts.push('and scrolling the page walks the figure deeper into it')
  return parts.join(', ')
}

function propLines(input: StageExportInput, indent: string): string {
  const lines: string[] = []
  if (input.text?.trim()) lines.push(`${indent}text={text}`)
  if (input.count !== undefined) lines.push(`${indent}count={${input.count}}`)
  if (input.layout !== 'colonnade') lines.push(`${indent}layout="${input.layout}"`)
  const layoutOptions = input.layoutOptions ?? {}
  const layoutDefaults = getLayout(input.layout).defaults as Record<string, unknown>
  const changed: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(layoutOptions)) {
    if (JSON.stringify(value) !== JSON.stringify(layoutDefaults[key])) changed[key] = value
  }
  if (Object.keys(changed).length > 0) {
    lines.push(`${indent}layoutOptions={${stringifyStage(changed).replace(/\n\s*/g, ' ')}}`)
  }
  lines.push(`${indent}stage={stage}`)
  return lines.join('\n')
}

/** Component source shared by the JSX snippet and the agent payload. */
export function buildStageComponentSource(input: StageExportInput): string {
  const name = input.componentName ?? 'PaperNave'
  const stage = diffStage(input.stage)
  const stageConst = `const stage = ${stringifyStage(stage)} satisfies StageConfigInput`
  const textConst = input.text?.trim() ? `\n\nconst text = ${JSON.stringify(input.text)}` : ''

  if (!input.scroll) {
    return `import { PaperStage, type StageConfigInput } from 'paperlab'

${stageConst}${textConst}

export function ${name}() {
  return (
    <PaperStage
${propLines(input, '      ')}
    />
  )
}`
  }

  return `import { useEffect, useRef, useState } from 'react'
import { PaperStage, type StageConfigInput } from 'paperlab'

${stageConst}${textConst}

export function ${name}() {
  const ref = useRef<HTMLDivElement>(null)
  const [progress, setProgress] = useState(0)

  // Scroll the section, walk the figure. The stage is pinned for the height
  // of the section, so the page scrolling past it IS the walk.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onScroll = () => {
      const { top, height } = el.getBoundingClientRect()
      const travel = Math.max(height - window.innerHeight, 1)
      setProgress(Math.min(Math.max(-top / travel, 0), 1))
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [])

  return (
    <div ref={ref} style={{ height: '${SCROLL_HEIGHTS * 100}vh' }}>
      <div style={{ position: 'sticky', top: 0, height: '100vh' }}>
        <PaperStage
${propLines(input, '          ')}
          progress={progress}
        />
      </div>
    </div>
  )
}`
}

/** The self-contained stage integration brief — one paste into a coding agent. */
export function buildStageAgentPayload(input: StageExportInput): string {
  const name = input.componentName ?? 'PaperNave'
  const sizing = input.scroll
    ? `4. Sizing: the component brings its own height — it reserves ${SCROLL_HEIGHTS} viewport
   heights of scroll and pins the canvas inside that. Drop it into the page
   flow as a section; do NOT wrap it in a fixed-height container.`
    : `4. Sizing: the component fills its parent container. Place it where I ask;
   give the parent an explicit height.`

  return `Integrate a Paperlab stage — paper as architecture, with a figure walking through it — into this project. (paperlab agent-payload v${AGENT_PAYLOAD_VERSION})

1. Install the dependencies:

   npm i paperlab three @react-three/fiber gsap

2. Create the component below as \`components/${name}.tsx\` (or the project's
   component convention). It is self-contained — it owns its own <Canvas>,
   its own camera and its own lighting:

\`\`\`tsx
${buildStageComponentSource(input)}
\`\`\`

3. Placement: this is a full-bleed scene, not an inline element. Give it the
   full width of the viewport.

${sizing}

5. Verify: run the dev server. You should see ${describeStage(input)}.
   If the canvas is blank, the container almost certainly has no height — give
   it one (this is the classic React Three Fiber integration bug, not a
   paperlab bug).

Constraints: don't modify the stage values; the camera is driven by the
stage's own shot, so don't add OrbitControls; three >= 0.160 and React 19 are
required; the component needs no props.`
}
