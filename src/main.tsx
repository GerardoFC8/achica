import './styles.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { copyFor, CopyProvider } from './ui/copy'
import { loadTool } from './tools/loaders'

const mount = document.querySelector('#app')

if (mount === null) {
  throw new Error('Mount point #app is missing from the page')
}

// Each page states its language in <html lang> and its tool in <body
// data-tool>, and the interface follows the page rather than the browser
// (D54, D57).
const copy = copyFor(document.documentElement.lang)
const { App } = await loadTool(document.body.dataset['tool'])

createRoot(mount).render(
  <StrictMode>
    <CopyProvider value={copy}>
      <App />
    </CopyProvider>
  </StrictMode>,
)
