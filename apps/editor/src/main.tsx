import { createRoot } from 'react-dom/client'
import { App } from './App'
import { startSessionMemory } from './session'
import { useEditor } from './store'
import './styles.css'

// The store restores the last session on import; this keeps it current.
startSessionMemory(useEditor)

createRoot(document.getElementById('root')!).render(<App />)
