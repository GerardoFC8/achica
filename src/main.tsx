import './styles.css'
import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { copyFor, CopyProvider } from './ui/copy'
import { loadTool } from './tools/loaders'

const mount = document.querySelector('#app')

if (mount === null) {
  throw new Error('Mount point #app is missing from the page')
}

// Each page states its language in <html lang> and its tool in <body
// data-tool>, and the interface follows the page rather than the browser
// (D54, D57). loadTool throws with a clear message if the tool is unknown.
const copy = copyFor(document.documentElement.lang)
const { App, tool } = await loadTool(document.body.dataset['tool'])

/**
 * Says the page is live. The first screen is prerendered (D52), so a file
 * input exists and looks usable before any script has run, and one that is
 * handed a file in that window silently drops it: its handler is attached
 * only when React mounts. That window is longer than it looks, because the
 * tool's module is a separate download (D57). The smoke test waits for this
 * attribute before it touches the page, which is what a patient visitor does
 * by looking at it.
 */
function Ready() {
  useEffect(() => {
    document.body.dataset['ready'] = 'true'
  }, [])
  return null
}

createRoot(mount).render(
  <StrictMode>
    <CopyProvider value={copy}>
      <App tool={tool} />
      <Ready />
    </CopyProvider>
  </StrictMode>,
)
