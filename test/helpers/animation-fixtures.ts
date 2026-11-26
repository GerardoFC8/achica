/**
 * Loads the animated fixtures in test/fixtures/generated from a browser test.
 * The `.expected.json` files are what ffmpeg itself decodes from each file:
 * the SHA-256 of every frame's RGB24 bytes, and its delay in milliseconds.
 */

const URLS = import.meta.glob('../fixtures/generated/*.{gif,apng,webp,png,jpg,json}', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>

export type ExpectedAnimation = {
  readonly width: number
  readonly height: number
  readonly frames: readonly { readonly sha256: string; readonly delayMs: number }[]
}

export async function loadFixture(name: string): Promise<Uint8Array<ArrayBuffer>> {
  const key = Object.keys(URLS).find((path) => path.endsWith(`/${name}`))
  const url = key === undefined ? undefined : URLS[key]
  if (url === undefined) throw new Error(`fixture not found: ${name}`)
  return new Uint8Array(await (await fetch(url)).arrayBuffer())
}

export async function loadExpected(name: string): Promise<ExpectedAnimation> {
  const bytes = await loadFixture(`${name}.expected.json`)
  return JSON.parse(new TextDecoder().decode(bytes)) as ExpectedAnimation
}

/** SHA-256 of the RGB bytes of an RGBA buffer (alpha dropped), as lowercase hex. */
export async function rgbSha256(rgba: Uint8ClampedArray): Promise<string> {
  const rgb = new Uint8Array((rgba.length / 4) * 3)
  for (let from = 0, to = 0; from < rgba.length; from += 4, to += 3) {
    rgb[to] = rgba[from] ?? 0
    rgb[to + 1] = rgba[from + 1] ?? 0
    rgb[to + 2] = rgba[from + 2] ?? 0
  }
  const digest = await crypto.subtle.digest('SHA-256', rgb)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
