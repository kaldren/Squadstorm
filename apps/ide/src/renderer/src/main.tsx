import { createRoot } from 'react-dom/client'
import '@xterm/xterm/css/xterm.css'
import './main.css'
import { App } from './App'

// No StrictMode: its double-mount would attach every terminal twice for no benefit here.
// Files dropped anywhere but an agent tile are ignored instead of opened in the window.
for (const type of ['dragover', 'drop'] as const) window.addEventListener(type, (e) => e.preventDefault())

createRoot(document.getElementById('root')!).render(<App />)
