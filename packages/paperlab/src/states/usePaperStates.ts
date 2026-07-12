import { useEffect, useMemo, useRef, useState } from 'react'
import type { PaperConfig } from '../config/schema'
import { PaperStateMachine, stripStates } from './machine'

export interface UsePaperStatesResult {
  /** The config to render this frame — animated when a machine is live. */
  config: PaperConfig
  /** Current state name ('rest' when no machine). */
  state: string
  /** Send triggers through this; null when states are absent or disabled. */
  machine: PaperStateMachine | null
}

/**
 * Bind a state machine to a config with `states`. The machine survives
 * config edits via `rebase` (current state and live values are kept —
 * flipping perforation to torn mid-pick must not snap the stamp to rest);
 * it is only rebuilt when states are toggled on/off.
 */
export function usePaperStates(
  config: PaperConfig,
  enabled: boolean,
  instant: boolean,
  onAction?: (event: string, state: string) => void,
  onStateChange?: (state: string) => void,
): UsePaperStatesResult {
  const live = enabled && Boolean(config.states)
  const key = useMemo(() => JSON.stringify(config), [config])

  // Callbacks live in refs so machine identity doesn't churn on new closures.
  const onActionRef = useRef(onAction)
  onActionRef.current = onAction
  const onStateChangeRef = useRef(onStateChange)
  onStateChangeRef.current = onStateChange

  const machineRef = useRef<PaperStateMachine | null>(null)
  const lastStateRef = useRef<string>('rest')
  const [animated, setAnimated] = useState<{ config: PaperConfig; state: string } | null>(null)

  useEffect(() => {
    if (!live) {
      machineRef.current?.dispose()
      machineRef.current = null
      setAnimated(null)
      return
    }
    if (machineRef.current) {
      machineRef.current.rebase(config)
      return
    }
    const machine = new PaperStateMachine(config, {
      instant,
      onChange: (c, state) => {
        if (state !== lastStateRef.current) {
          lastStateRef.current = state
          onStateChangeRef.current?.(state)
        }
        setAnimated({ config: c, state })
      },
      onAction: (event, state) => onActionRef.current?.(event, state),
    })
    machineRef.current = machine
    lastStateRef.current = machine.state
    setAnimated({ config: machine.config, state: machine.state })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, live, instant])

  useEffect(
    () => () => {
      machineRef.current?.dispose()
      machineRef.current = null
    },
    [],
  )

  return {
    config: live && animated ? animated.config : stripStates(config),
    state: live && animated ? animated.state : 'rest',
    machine: live ? machineRef.current : null,
  }
}
