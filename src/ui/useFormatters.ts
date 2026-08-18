import { useMemo } from 'react'
import { createFormatters, preferredLocale, type Formatters } from './format'

/**
 * The platform edge for number formatting: this is the only place that reads
 * the browser's language. Everything downstream takes a locale as data.
 */
export function useFormatters(): Formatters {
  return useMemo(() => createFormatters(preferredLocale(navigator.languages)), [])
}
