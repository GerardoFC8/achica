import { renderToString } from 'react-dom/server'
import { App } from './ui/App'

/**
 * The first screen as markup, for scripts/prerender.mjs to put into the built
 * index.html.
 *
 * Only the empty queue is ever rendered here, and that is the screen every
 * visit starts on: the toolbar and the drop zone. Link previews, crawlers that
 * do not run JavaScript and a slow first load all read this. main.tsx then
 * replaces it with the live tree; the markup is the same, so nothing moves.
 */
export function render(): string {
  return renderToString(<App />)
}
