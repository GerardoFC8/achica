/**
 * Counts what the page actually requests, split by who asked for it.
 *
 * The product's central claim is that nothing leaves the device. The spec
 * asks for that to be verifiable in DevTools, which means the honest version
 * of the claim has to survive someone actually checking it. The edge injects
 * a few same-origin requests of its own (bot protection), so a flat "zero
 * requests" would be false on the first look. This reports the real split
 * instead, and the number that carries the promise is thirdParty.
 */

export type RequestOrigin = 'own' | 'edge' | 'thirdParty'

export type NetworkAudit = {
  readonly own: number
  readonly edge: number
  readonly thirdParty: number
}

/** Cloudflare serves its injected scripts from this path on our own origin. */
const EDGE_PATH_PREFIX = '/cdn-cgi/'

/**
 * Pure on purpose: the origin is passed in rather than read from location, so
 * the classification can be tested without a browser.
 */
export function classifyRequest(url: string, origin: string): RequestOrigin {
  if (!url.startsWith(`${origin}/`) && url !== origin) return 'thirdParty'

  const path = url.slice(origin.length)
  return path.startsWith(EDGE_PATH_PREFIX) ? 'edge' : 'own'
}

export function auditNetwork(origin: string): NetworkAudit {
  const counts = { own: 0, edge: 0, thirdParty: 0 }

  // The document itself is a request, and leaving it out would undercount.
  counts.own += performance.getEntriesByType('navigation').length

  for (const entry of performance.getEntriesByType('resource')) {
    counts[classifyRequest(entry.name, origin)] += 1
  }

  return counts
}

/**
 * Reports again whenever a new request lands, so the figures stay honest
 * after the first paint rather than freezing on a snapshot.
 */
export function observeNetwork(origin: string, onChange: (audit: NetworkAudit) => void): void {
  new PerformanceObserver(() => {
    onChange(auditNetwork(origin))
  }).observe({ type: 'resource', buffered: true })
}
