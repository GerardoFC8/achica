import { createContext, useContext } from 'react'
import { en } from './en'
import { es, type Copy } from './es'

export type { Copy } from './es'
export { es } from './es'
export { en } from './en'

export type Language = Copy['lang']

/**
 * The language of a page is decided by the page, not by the browser: `/` is
 * Spanish and `/en/` is English, each with its own lang attribute (D54). A
 * visitor who lands on one language from a search stays in it, and a crawler
 * sees two stable pages instead of one that changes under it.
 */
export function copyFor(language: string): Copy {
  return language === 'en' ? en : es
}

/** Spanish when nothing says otherwise, which is also what every test renders. */
const CopyContext = createContext<Copy>(es)

export const CopyProvider = CopyContext.Provider

export function useCopy(): Copy {
  return useContext(CopyContext)
}
