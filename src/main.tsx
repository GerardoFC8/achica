import './styles.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { copyFor, CopyProvider } from './ui/copy'
import { App } from './ui/App'

const mount = document.querySelector('#app')

if (mount === null) {
  throw new Error('Mount point #app is missing from index.html')
}

// Each page states its language in <html lang>, and the interface follows
// the page rather than the browser (D54).
const copy = copyFor(document.documentElement.lang)

createRoot(mount).render(
  <StrictMode>
    <CopyProvider value={copy}>
      <App />
    </CopyProvider>
  </StrictMode>,
)
