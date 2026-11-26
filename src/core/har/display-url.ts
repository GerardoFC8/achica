/**
 * What the interface may show about a URL.
 *
 * URLs in a HAR are where the secrets hide: `?token=`, `#access_token=`,
 * `user:pass@`, and `data:` URLs that are the whole image. The display form
 * is built from parsed parts (protocol, host, path) rather than by cutting
 * the original string, so nothing outside those parts can survive.
 */

export const UNREADABLE_URL = '(URL ilegible)'

const MAX_DISPLAY_LENGTH = 300
const DATA_TYPE = /^[a-z]+\/[a-z0-9.+-]{1,40}$/i

export type UrlParts = {
  readonly display: string
  /** Path segments in order, for naming. Empty for data: and unreadable URLs. */
  readonly segments: readonly string[]
}

export function describeUrl(raw: string): UrlParts {
  if (/^data:/i.test(raw)) {
    // Only the declared type, and only if it looks like one: anything else
    // before the first comma could be arbitrary text.
    const header = raw.slice(5, 5 + 80).split(/[;,]/, 1)[0] ?? ''
    const type = DATA_TYPE.test(header) ? header.toLowerCase() : 'unknown'
    return { display: `data:${type} (inline)`, segments: [] }
  }

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { display: UNREADABLE_URL, segments: [] }
  }

  // blob:, file:, chrome-extension: and friends are not web images worth listing.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { display: UNREADABLE_URL, segments: [] }
  }

  // `host` keeps a non-default port, `pathname` drops query and fragment, and
  // credentials are simply never read.
  let display = `${url.protocol}//${url.host}${url.pathname}`
  if (display.length > MAX_DISPLAY_LENGTH) display = `${display.slice(0, MAX_DISPLAY_LENGTH)}…`

  const segments = url.pathname.split('/').filter((segment) => segment !== '')
  return { display, segments }
}
