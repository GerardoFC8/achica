/**
 * How each tool's screen is loaded (D57). Kept apart from registry.ts because
 * these are real imports of UI code, and the registry has to stay readable
 * from Node scripts and vite.config.ts.
 *
 * The module is resolved before rendering, in the browser and in the prerender
 * alike: React.lazy does not work with renderToString, and main.tsx does not
 * hydrate. A page therefore awaits its tool, then renders it.
 */

import type { ComponentType } from 'react'

export interface ToolModule {
  /** The tool's screen. */
  App: ComponentType
}

export const loaders: Record<string, () => Promise<ToolModule>> = {
  comprimir: () => import('../ui/App'),
}

/** Resolves a tool's module from the id a page declares in `<body data-tool>`. */
export function loadTool(id: string | undefined): Promise<ToolModule> {
  const load = id === undefined ? undefined : loaders[id]
  if (load === undefined) {
    return Promise.reject(new Error(`No tool is registered under data-tool="${id ?? ''}"`))
  }
  return load()
}
