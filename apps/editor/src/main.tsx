import { createRoot } from 'react-dom/client'
import { App } from './App'
import { CrashScreen } from './CrashScreen'
import { startSessionMemory } from './session'
import { useEditor } from './store'
import './styles.css'

// The store restores the last session on import; this keeps it current.
startSessionMemory(useEditor)

// Wrapped, because a render error with nothing to catch it unmounts the
// whole tree and leaves a blank page — see CrashScreen.
createRoot(document.getElementById('root')!).render(
  <CrashScreen>
    <App />
  </CrashScreen>,
)
