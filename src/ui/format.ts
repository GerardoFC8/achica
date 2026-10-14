/**
 * Every number the interface shows is formatted here.
 *
 * The locale is an argument, never read from the platform inside this module.
 * That keeps the arithmetic pure and the tests identical on any machine, and
 * it is the same shape the rest of the project uses to keep the platform at
 * the edges.
 */

/**
 * Latin American Spanish, which is what the paperwork profiles are for.
 *
 * Verified rather than assumed: `es` renders 1.234.567,89 and 66 %, while
 * `es-419` renders 1,234,567.89 and 66%. In an app that is a table of figures,
 * the wrong separator shows up on every row.
 */
export const DEFAULT_LOCALE = 'es-419'

/**
 * Numbers follow the language the page is written in. Honouring an unrelated
 * locale would put German separators inside Spanish sentences, so the browser
 * only gets to pick the region: es-PE on the Spanish page, en-GB on the
 * English one (D54).
 */
export function preferredLocale(
  languages: readonly string[],
  language = 'es',
  fallback = DEFAULT_LOCALE,
): string {
  return (
    languages.find(
      (candidate) =>
        candidate.toLowerCase().startsWith(language.toLowerCase()) && isLocaleTag(candidate),
    ) ?? fallback
  )
}

/**
 * Whether Intl accepts the tag at all. Browsers can hand over a POSIX name
 * such as `en-US@posix`, read from the system, and Intl.NumberFormat throws on
 * it: one odd setting would take down every number on the page.
 */
function isLocaleTag(tag: string): boolean {
  try {
    return Intl.getCanonicalLocales(tag).length === 1
  } catch {
    return false
  }
}

export type Formatters = {
  /** Null means there is no value yet, which is not the same as zero. */
  bytes(value: number | null): string
  percent(ratio: number): string
  dimensions(width: number, height: number): string
  count(value: number): string
  ms(value: number): string
}

/**
 * Thousands, not 1024s.
 *
 * The profiles state their budgets as round decimal numbers — 500000 for
 * "máx. 500 KB". Dividing by 1024 would print that same limit as 488 KB,
 * directly beneath the label that promised 500.
 */
const KILO = 1000
const MEGA = KILO * KILO

/**
 * Below ten of a unit the decimal carries real information — 0.4 KB is a file
 * and 0 KB is nothing. Above ten it is noise: nobody needs 500.0 KB, and the
 * extra digit widens every column in the table.
 */
const DECIMAL_BELOW = 10

export function createFormatters(locale: string): Formatters {
  const plain = new Intl.NumberFormat(locale)
  const oneDecimal = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })
  const whole = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 })
  const ratio = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 })

  return {
    bytes(value) {
      if (value === null) return '—'

      const mega = Math.abs(value) >= MEGA
      const scaled = value / (mega ? MEGA : KILO)
      const digits = Math.abs(scaled) < DECIMAL_BELOW ? oneDecimal : whole

      return `${digits.format(scaled)} ${mega ? 'MB' : 'KB'}`
    },

    percent(value) {
      return ratio.format(value)
    },

    dimensions(width, height) {
      return `${plain.format(width)} × ${plain.format(height)}`
    },

    count(value) {
      return plain.format(value)
    },

    ms(value) {
      return `${whole.format(value)} ms`
    },
  }
}
