import { createContext, useContext } from 'react'
import type { ToolId } from '../tools/registry'
import { useCopy } from './copy'
import type { ToolWords } from './copy/es'

/**
 * Which tool the interface is. No default on purpose: a component rendered
 * outside a tool would otherwise behave as the compressor without anyone
 * having said so.
 */
const ToolContext = createContext<ToolId | null>(null)

export const ToolProvider = ToolContext.Provider

export function useTool(): ToolId {
  const tool = useContext(ToolContext)
  if (tool === null) throw new Error('useTool was called outside a ToolProvider')
  return tool
}

/** The words that change with the tool, in the page's language. */
export function useToolWords(): ToolWords {
  return useCopy().tools[useTool()]
}
