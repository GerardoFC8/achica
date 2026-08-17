/**
 * Counts what the page actually requests, split by who asked for it.
 *
 * The product's central claim is that nothing leaves the device, and the spec
 * asks for that to be verifiable in DevTools. So the count has to survive
 * someone checking it against the network panel — which means it must not
 * under-report.
 *
 * The trap: the edge injects a hidden iframe and loads its scripts inside it.
 * A document's performance timeline does not include resources fetched by a
 * child document, so counting only our own timeline reports zero while
 * DevTools shows three. Same-origin frames are therefore swept too, and any
 * frame that cannot be inspected is reported rather than ignored.
 */

export type RequestOrigin = 'own' | 'edge' | 'thirdParty'

export type NetworkAudit = {
  readonly own: number
  readonly edge: number
  readonly thirdParty: number
  /** Frames whose timeline we cannot read. An audit with blind spots says so. */
  readonly blindFrames: number
}

/** Cloudflare serves its injected scripts from this path on our own origin. */
const EDGE_PATH_PREFIX = '/cdn-cgi/'

/**
 * Pure on purpose: the origin is passed in rather than read from location, so
 * the classification can be tested without a browser.
 */
export function classifyRequest(url: string, origin: string): RequestOrigin {
  if (url !== origin && !url.startsWith(`${origin}/`)) return 'thirdParty'

  const path = url.slice(origin.length)
  return path.startsWith(EDGE_PATH_PREFIX) ? 'edge' : 'own'
}

/** Pure counting, so the part that decides the verdict is testable in Node. */
export function countRequests(
  urls: readonly string[],
  origin: string,
  blindFrames: number,
): NetworkAudit {
  const counts = { own: 0, edge: 0, thirdParty: 0 }

  for (const url of urls) {
    counts[classifyRequest(url, origin)] += 1
  }

  return { ...counts, blindFrames }
}

type Collected = { readonly urls: string[]; readonly blindFrames: number }

function collectRequestUrls(): Collected {
  // The document itself is a request; leaving it out would undercount.
  const urls = performance.getEntriesByType('navigation').map(() => globalThis.location.href)
  urls.push(...performance.getEntriesByType('resource').map((entry) => entry.name))

  let blindFrames = 0

  for (const frame of document.querySelectorAll('iframe')) {
    try {
      const timeline = frame.contentWindow?.performance
      if (timeline === undefined) {
        blindFrames += 1
        continue
      }
      urls.push(...timeline.getEntriesByType('resource').map((entry) => entry.name))
    } catch {
      // Cross-origin frame: its timeline is unreadable by design.
      blindFrames += 1
    }
  }

  return { urls, blindFrames }
}

export function auditNetwork(origin: string): NetworkAudit {
  const { urls, blindFrames } = collectRequestUrls()
  return countRequests(urls, origin, blindFrames)
}

/**
 * Keeps the figures live.
 *
 * Two triggers, because one is not enough: the observer catches our own
 * requests immediately, and the interval sweeps injected frames, whose
 * resources never reach our observer. The sweep does not stop, so a request
 * arriving long after load still shows up in front of the reader instead of
 * slipping past a settling window.
 */
export function observeNetwork(origin: string, onChange: (audit: NetworkAudit) => void): void {
  const emit = (): void => {
    onChange(auditNetwork(origin))
  }

  new PerformanceObserver(emit).observe({ type: 'resource', buffered: true })
  setInterval(emit, 1000)
  emit()
}
