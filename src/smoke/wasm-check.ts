import decodePng from '@jsquash/png/decode'

/**
 * Phase 0 scaffolding. Replaced by the real interface in phase 3.
 *
 * The spec asks for hosting problems to surface in phase 0 rather than in
 * phase 5, but a genuinely empty page cannot prove anything: with no .wasm
 * in the build there is no MIME type to check and no instantiation to fail.
 * So the "empty" deployment decodes one real image through a real codec and
 * reports what the host actually did.
 *
 * Three things are worth knowing on the deployed URL:
 *   - the .wasm was fetched and instantiated, so the host serves it correctly
 *   - the Content-Type the host attached to it
 *   - whether the page is cross-origin isolated, which decides whether AVIF
 *     can use its multithreaded encoder later
 */

/** 2x2 RGBA PNG: red, green / blue, fully transparent. */
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAE0lEQVR42mP4z8DwHwyBNIhgAAA/0gX7f+ZqKwAAAABJRU5ErkJggg=='

const EXPECTED_PIXELS = [
  [255, 0, 0, 255],
  [0, 255, 0, 255],
  [0, 0, 255, 255],
  [0, 0, 0, 0],
]

export type SmokeReport = {
  readonly decoded: boolean
  readonly pixelsMatch: boolean
  readonly wasmContentType: string | null
  readonly crossOriginIsolated: boolean
  readonly error: string | null
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

function pixelsMatch(image: ImageData): boolean {
  return EXPECTED_PIXELS.every((expected, index) =>
    expected.every((channel, offset) => image.data[index * 4 + offset] === channel),
  )
}

/**
 * Reads the Content-Type the host served the wasm with.
 *
 * The URL is taken from resource timing rather than imported, so we inspect
 * the request the codec actually made instead of a second copy of the asset.
 * The follow-up request is served from cache.
 */
async function readWasmContentType(): Promise<string | null> {
  const entry = performance
    .getEntriesByType('resource')
    .find((resource) => resource.name.endsWith('.wasm'))

  if (entry === undefined) return null

  try {
    const response = await fetch(entry.name)
    return response.headers.get('content-type')
  } catch {
    return null
  }
}

export async function runWasmSmoke(): Promise<SmokeReport> {
  const isolated = globalThis.crossOriginIsolated

  try {
    const image = await decodePng(base64ToBytes(PNG_BASE64).buffer as ArrayBuffer)

    return {
      decoded: true,
      pixelsMatch: pixelsMatch(image),
      wasmContentType: await readWasmContentType(),
      crossOriginIsolated: isolated,
      error: null,
    }
  } catch (cause) {
    return {
      decoded: false,
      pixelsMatch: false,
      wasmContentType: await readWasmContentType(),
      crossOriginIsolated: isolated,
      error: cause instanceof Error ? cause.message : String(cause),
    }
  }
}
