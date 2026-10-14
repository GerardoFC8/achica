import { useMemo } from 'react'
import { useCopy } from './copy'
import { createFormatters, preferredLocale, type Formatters } from './format'

/**
 * The platform edge for number formatting: this is the only place that reads
 * the browser's language. Everything downstream takes a locale as data.
 */
export function useFormatters(): Formatters {
  const { lang, numberLocale } = useCopy()
  return useMemo(
    () => createFormatters(preferredLocale(navigator.languages, lang, numberLocale)),
    [lang, numberLocale],
  )
}
