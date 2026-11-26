/**
 * Test-only helpers: hand-written HAR documents. Not imported by src code.
 */

export type EntrySpec = {
  url?: unknown
  status?: unknown
  mimeType?: unknown
  text?: unknown
  encoding?: unknown
  size?: unknown
  bodySize?: unknown
  transferSize?: unknown
}

export const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64')

/** A realistic entry that also carries every secret-bearing field a HAR has. */
export function entry(spec: EntrySpec, secrets: string[] = []): Record<string, unknown> {
  const content: Record<string, unknown> = {}
  if ('mimeType' in spec) content.mimeType = spec.mimeType
  if ('text' in spec) content.text = spec.text
  if ('encoding' in spec) content.encoding = spec.encoding
  if ('size' in spec) content.size = spec.size
  const response: Record<string, unknown> = {
    status: 'status' in spec ? spec.status : 200,
    headers: [
      { name: 'Set-Cookie', value: `session=${secrets.join('|')}` },
      { name: 'X-Secret', value: secrets.join('|') },
    ],
    cookies: [{ name: 'sid', value: secrets.join('|') }],
    content,
  }
  if ('bodySize' in spec) response.bodySize = spec.bodySize
  if ('transferSize' in spec) response._transferSize = spec.transferSize
  return {
    startedDateTime: '2026-01-01T00:00:00.000Z',
    request: {
      method: 'GET',
      url: spec.url,
      headers: [{ name: 'Authorization', value: `Bearer ${secrets.join('|')}` }],
      cookies: [{ name: 'sid', value: secrets.join('|') }],
      queryString: [{ name: 'token', value: secrets.join('|') }],
      postData: { mimeType: 'application/json', text: secrets.join('|') },
    },
    response,
  }
}

export const har = (entries: unknown[]): string =>
  JSON.stringify({ log: { version: '1.2', creator: { name: 'test' }, entries } })

export function imageEntry(
  url: string,
  bytes: Uint8Array,
  extra: EntrySpec = {},
): Record<string, unknown> {
  return entry({
    url,
    mimeType: 'image/jpeg',
    text: b64(bytes),
    encoding: 'base64',
    size: bytes.length,
    ...extra,
  })
}
