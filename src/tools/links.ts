/**
 * Where a tool lives in each language, read from the registry (D57).
 *
 * The interface never writes a route by hand: the language link and the tool
 * navigation both ask here, so a route changed in the registry changes
 * everywhere, and the anti-drift test on the pages covers it.
 */

import { REGISTRY, type Language, type ToolId } from './registry'

/** The route of a tool in a language, e.g. `/en/resize-images/`. */
export function pathFor(tool: ToolId, language: Language): string {
  const found = REGISTRY.tools.find((candidate) => candidate.id === tool)
  if (found === undefined) throw new Error(`No tool is registered as "${tool}"`)
  return found.locales[language].path
}

/** Every tool with its route in one language, in the registry's order. */
export function linksIn(
  language: Language,
): readonly { readonly id: ToolId; readonly path: string }[] {
  return REGISTRY.tools.map((tool) => ({ id: tool.id, path: tool.locales[language].path }))
}
