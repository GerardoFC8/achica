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
import { isToolId, type ToolId } from './registry'

export interface ToolModule {
  /** The tool's screen. One component serves every tool; the id says which one it is. */
  App: ComponentType<{ readonly tool: ToolId }>
}

/** What a page gets back: its module and the id it was validated as. */
export interface LoadedTool extends ToolModule {
  readonly tool: ToolId
}

// Typed by id: a tool in the registry without a loader does not compile.
// Today they all share one screen; a tool with its own would import its own.
const screen = (): Promise<ToolModule> => import('../ui/App')

export const loaders: Record<ToolId, () => Promise<ToolModule>> = {
  comprimir: screen,
  redimensionar: screen,
  convertir: screen,
}

/** Resolves a tool's module from the id a page declares in `<body data-tool>`. */
export async function loadTool(id: string | undefined): Promise<LoadedTool> {
  if (id === undefined || !isToolId(id)) {
    throw new Error(`No tool is registered under data-tool="${id ?? ''}"`)
  }
  return { ...(await loaders[id]()), tool: id }
}
