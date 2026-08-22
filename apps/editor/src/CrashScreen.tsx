import { Component, type ErrorInfo, type ReactNode } from 'react'
import { clearSession } from './session'

/**
 * The editor's error boundary.
 *
 * React unmounts the entire tree when a render throws and nothing catches
 * it, so until now every error in this app — a preset that isn't registered,
 * a stored view a newer build wrote, anything at all — showed up as a **blank
 * white page**. No message, no stack, nothing to report, and reloading walked
 * straight back into it if the cause was persisted.
 *
 * A tool is allowed to break. It is not allowed to disappear. This catches
 * the throw, keeps the error on screen where it can be read and copied, and
 * offers the two ways out that actually work: reload, or forget the
 * remembered session first and then reload — which is the escape hatch when
 * the thing being restored is itself what breaks.
 */
interface State {
  error: Error | null
  info: ErrorInfo | null
}

export class CrashScreen extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, info: null }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ info })
    // Still log it: the console keeps the full stack and the source maps,
    // which is more than any panel should try to reproduce.
    console.error('[paperlab] the editor crashed', error, info.componentStack)
  }

  render() {
    const { error, info } = this.state
    if (!error) return this.props.children

    const report = [
      error.stack ?? `${error.name}: ${error.message}`,
      info?.componentStack ? `\nComponent stack:${info.componentStack}` : '',
    ].join('')

    return (
      <div className="crash">
        <div className="crash-panel">
          <h1>The editor hit an error</h1>
          <p className="crash-message">{error.message || String(error)}</p>
          <p className="crash-hint">
            Your saved presets are safe — they live separately from the view that broke. If this happens again
            the moment you reload, the remembered session is the likely cause; forget it and you'll come back
            up on the default paper.
          </p>
          <div className="crash-actions">
            <button type="button" onClick={() => window.location.reload()}>
              Reload
            </button>
            <button
              type="button"
              onClick={() => {
                clearSession()
                window.location.reload()
              }}
            >
              Forget the session and reload
            </button>
            <button type="button" onClick={() => void navigator.clipboard?.writeText(report)}>
              Copy error
            </button>
          </div>
          <pre className="crash-stack">{report}</pre>
        </div>
      </div>
    )
  }
}
