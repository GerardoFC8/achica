import { renderToString } from 'react-dom/server'
import { copyFor, CopyProvider } from './ui/copy'
import { loadTool } from './tools/loaders'

/**
 * The first screen as markup, for scripts/prerender.mjs to put into each
 * built page: the tool a page declares, in the language it declares.
 *
 * Asynchronous because the tool's module is resolved first, as main.tsx does
 * (React.lazy does not work with renderToString).
 *
 * Only the empty queue is ever rendered here, and that is the screen every
 * visit starts on: the toolbar and the drop zone. Link previews, crawlers that
 * do not run JavaScript and a slow first load all read this. main.tsx then
 * replaces it with the live tree; the markup is the same, so nothing moves.
 */
export async function render(language: string, toolId: string): Promise<string> {
  const { App, tool } = await loadTool(toolId)

  return renderToString(
    <CopyProvider value={copyFor(language)}>
      <App tool={tool} />
    </CopyProvider>,
  )
}
