import { Suspense, lazy } from 'react'
import type { ComponentType } from 'react'
import type { FilmName } from '../config/schema'
import type { StageGradeConfig } from './schema'

export interface GradeProps {
  grade: StageGradeConfig
  film: FilmName
}

/**
 * The print pass, loaded only if it is actually going to run.
 *
 * `@react-three/postprocessing` and `postprocessing` are declared OPTIONAL
 * peers, and that declaration was a lie for two releases: `./Grade` imports
 * them at module scope, `PaperStage` imported `./Grade` at module scope, and
 * so `import 'paperlab/stage'` threw `ERR_MODULE_NOT_FOUND` in any consumer
 * who took the package at its word and installed neither. The subpath split
 * kept the specifier out of the MAIN entry; nothing kept it out of stage's.
 *
 * A dynamic import is what makes the word "optional" true, because it is the
 * only thing that moves resolution from load time to the moment the effect is
 * wanted. Two consequences worth stating, since both are the point:
 *
 * - **A missing peer must not throw.** `React.lazy` turns a rejected import
 *   into a render error, which is a worse failure than the one being fixed —
 *   a consumer who never asked for a graded stage would get a crash instead of
 *   a scene. So the rejection resolves to a component that renders nothing,
 *   and the stage draws ungraded. That IS the optional contract: the tone
 *   curve, bloom and grain are what you lose by not installing them.
 * - **It is warned about once, not silently dropped.** A stage that quietly
 *   renders flat is a bug report; a stage that says why is a two-line install.
 *
 * CI cannot see any of this — the workspace always has both peers installed,
 * so `publint` and `arethetypeswrong` never exercise the path. `consumer
 * install` in `tools/` is what guards it, and it guards `paperlab/fx` by the
 * same test for the same reason.
 */
const Grade = lazy(() =>
  import('./Grade')
    .then((m) => ({ default: m.Grade as ComponentType<GradeProps> }))
    .catch(() => {
      warnOnce()
      return { default: (() => null) as ComponentType<GradeProps> }
    }),
)

let warned = false
function warnOnce() {
  if (warned) return
  warned = true
  console.warn(
    '[paperlab/stage] Rendering without the print pass — tone curve, bloom, vignette and grain are off.\n' +
      'They need two optional peers:\n' +
      '  npm i @react-three/postprocessing postprocessing\n' +
      'Set `grade` to all zeros to turn the pass off deliberately and silence this.',
  )
}

/**
 * `fallback={null}` is correct rather than lazy: the scene behind it is
 * already drawn, and a grade is a pass over a finished frame. There is
 * nothing to stand in for while it loads — one ungraded frame, then a graded
 * one.
 */
export function GradePass(props: GradeProps) {
  return (
    <Suspense fallback={null}>
      <Grade {...props} />
    </Suspense>
  )
}
