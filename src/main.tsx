import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './app/App.tsx'
import { useProjectStore } from './store/projectStore'
import { useSelectionStore } from './store/selectionStore'
import { useZoomPan } from './editor/useZoomPan'
import { undoStack } from './store/undo'

const rootEl = document.getElementById('root')
if (rootEl === null) throw new Error('Missing #root element in index.html')

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// E2E/debug hook (M3): drive + assert editor state from Playwright.
// Shape: { project, selection, zoom, undo } zustand stores + undo singleton.
declare global {
  interface Window {
    __harmony?: {
      project: typeof useProjectStore
      selection: typeof useSelectionStore
      zoom: typeof useZoomPan
      undo: typeof undoStack
    }
  }
}
window.__harmony = { project: useProjectStore, selection: useSelectionStore, zoom: useZoomPan, undo: undoStack }
