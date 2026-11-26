/**
 * Base64 to bytes, without a binary string in between.
 *
 * `atob` produces one JS string character per byte, so a 20 MB image becomes a
 * 20 M-character string before it is copied again into a typed array. This
 * decoder reads the base64 text once to validate and count, then once more to
 * write into an exactly-sized buffer.
 *
 * It accepts what real exporters produce (padding or no padding, line breaks,
 * stray spaces) and rejects everything else, including the URL-safe alphabet:
 * a HAR that says `base64` means the standard one, and guessing would turn
 * garbage into plausible-looking bytes.
 */

const INVALID = -1
const TABLE = new Int8Array(256).fill(INVALID)
{
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  for (let i = 0; i < alphabet.length; i += 1) TABLE[alphabet.charCodeAt(i)] = i
}

const EQUALS = 0x3d
const isSpace = (code: number): boolean =>
  code === 0x20 || code === 0x0a || code === 0x0d || code === 0x09

/**
 * Decodes `text`, or returns null when it is not valid base64.
 *
 * With `prefix` the text is only expected to be the start of a longer
 * stream, so a dangling partial group at the end is dropped instead of
 * rejected. That is how the first bytes of an unlabelled body are sniffed
 * without decoding all of it.
 */
export function decodeBase64(
  text: string,
  options: { readonly prefix?: boolean } = {},
): Uint8Array<ArrayBuffer> | null {
  const length = text.length

  // Pass 1: validate and count the data characters.
  let data = 0
  let padding = 0
  for (let i = 0; i < length; i += 1) {
    const code = text.charCodeAt(i)
    if (isSpace(code)) continue
    if (code === EQUALS) {
      padding += 1
      continue
    }
    // Data after padding, or a character outside the alphabet.
    if (padding > 0 || code > 0xff || TABLE[code] === INVALID) return null
    data += 1
  }

  if (padding > 2) return null
  // One leftover character carries 6 bits, which is not even a byte.
  if (data % 4 === 1 && !options.prefix) return null
  if (padding > 0 && !options.prefix && (data + padding) % 4 !== 0) return null

  const size = Math.floor((data * 6) / 8)
  const out = new Uint8Array(size)

  // Pass 2: write.
  let buffer = 0
  let bits = 0
  let at = 0
  for (let i = 0; i < length && at < size; i += 1) {
    const code = text.charCodeAt(i)
    if (code === EQUALS) break
    if (isSpace(code)) continue
    buffer = (buffer << 6) | (TABLE[code] as number)
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out[at] = (buffer >> bits) & 0xff
      at += 1
      buffer &= (1 << bits) - 1
    }
  }
  return out
}
