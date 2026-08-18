import { useSyncExternalStore } from 'react'

/**
 * Reads a media query without a render-time guess.
 *
 * `useSyncExternalStore` matters here rather than an effect: the table renders
 * a different structure on a narrow screen, and an effect would paint the wide
 * one first and then swap it.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = matchMedia(query)
      list.addEventListener('change', onChange)
      return () => list.removeEventListener('change', onChange)
    },
    () => matchMedia(query).matches,
    () => false,
  )
}
