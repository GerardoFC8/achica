import './styles.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './ui/App'

const mount = document.querySelector('#app')

if (mount === null) {
  throw new Error('Mount point #app is missing from index.html')
}

createRoot(mount).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
