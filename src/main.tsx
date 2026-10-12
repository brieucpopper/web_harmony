import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './app/App.tsx'

const rootEl = document.getElementById('root')
if (rootEl === null) throw new Error('Missing #root element in index.html')

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
