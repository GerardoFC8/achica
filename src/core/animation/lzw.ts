/**
 * GIF's variable-width LZW, written from the format description.
 *
 * Codes are 3 to 12 bits wide and start at `minCodeSize + 1` bits. When the
 * table reaches 4096 entries the encoder emits a clear code and starts again,
 * which is what keeps every decoder happy (none is required to support a
 * table that keeps growing). The width grows when the next entry to be
 * assigned no longer fits in the current width, the same rule the decoder
 * applies one step later.
 */

const MAX_CODES = 4096
const HASH_BITS = 13

/** The raw LZW byte stream, without the min-code-size byte or sub-block framing. */
export function lzwCompress(indices: Uint8Array, minCodeSize: number): Uint8Array<ArrayBuffer> {
  const clearCode = 1 << minCodeSize
  const endCode = clearCode + 1
  const mask = clearCode - 1
  const out = new Uint8Array(Math.max(64, indices.length + (indices.length >> 1) + 16))
  let length = 0
  let accumulator = 0
  let accumulatorBits = 0
  let codeSize = minCodeSize + 1
  let nextCode = endCode + 1
  let bytes = out

  const emit = (code: number): void => {
    accumulator |= code << accumulatorBits
    accumulatorBits += codeSize
    while (accumulatorBits >= 8) {
      if (length >= bytes.length) {
        const grown = new Uint8Array(bytes.length * 2)
        grown.set(bytes)
        bytes = grown
      }
      bytes[length] = accumulator & 0xff
      length += 1
      accumulator >>>= 8
      accumulatorBits -= 8
    }
  }

  const keys = new Int32Array(1 << HASH_BITS).fill(-1)
  const codes = new Int32Array(1 << HASH_BITS)

  emit(clearCode)
  if (indices.length > 0) {
    let prefix = (indices[0] ?? 0) & mask
    for (let i = 1; i < indices.length; i += 1) {
      const suffix = (indices[i] ?? 0) & mask
      const key = (prefix << 8) | suffix
      let slot = Math.imul(key, 2654435761) >>> (32 - HASH_BITS)
      while (keys[slot] !== -1 && keys[slot] !== key) slot = (slot + 1) & ((1 << HASH_BITS) - 1)
      if (keys[slot] === key) {
        prefix = codes[slot] ?? 0
        continue
      }
      emit(prefix)
      if (nextCode === MAX_CODES) {
        emit(clearCode)
        nextCode = endCode + 1
        codeSize = minCodeSize + 1
        keys.fill(-1)
      } else {
        if (nextCode >= 1 << codeSize) codeSize += 1
        keys[slot] = key
        codes[slot] = nextCode
        nextCode += 1
      }
      prefix = suffix
    }
    emit(prefix)
    // A decoder adds an entry for every code after the first, including the
    // last one, and widens its codes if that entry fills the width. Mirror
    // that here, or the end code is written one bit too narrow.
    if (indices.length > 1 && nextCode < MAX_CODES && nextCode >= 1 << codeSize) codeSize += 1
  }
  emit(endCode)
  if (accumulatorBits > 0) {
    if (length >= bytes.length) {
      const grown = new Uint8Array(bytes.length + 1)
      grown.set(bytes)
      bytes = grown
    }
    bytes[length] = accumulator & 0xff
    length += 1
  }
  return bytes.slice(0, length)
}

/** The image data section: min code size, then the stream cut into sub-blocks of at most 255 bytes, then a zero-length block. */
export function lzwImageData(indices: Uint8Array, minCodeSize: number): Uint8Array<ArrayBuffer> {
  const stream = lzwCompress(indices, minCodeSize)
  const blocks = Math.ceil(stream.length / 255)
  const result = new Uint8Array(1 + stream.length + blocks + 1)
  result[0] = minCodeSize
  let at = 1
  for (let start = 0; start < stream.length; start += 255) {
    const size = Math.min(255, stream.length - start)
    result[at] = size
    result.set(stream.subarray(start, start + size), at + 1)
    at += size + 1
  }
  result[at] = 0
  return result
}
