import { createRoot } from 'react-dom/client'
import '@xterm/xterm/css/xterm.css'
import './main.css'
import { App } from './App'

// No StrictMode: its double-mount would attach every terminal twice for no benefit here.
createRoot(document.getElementById('root')!).render(<App />)
