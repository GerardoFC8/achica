/** A growable byte buffer. Closure-based because the project bans parameter properties. */
export type ByteWriter = {
  byte(value: number): void
  u16le(value: number): void
  u16be(value: number): void
  u32be(value: number): void
  bytes(data: ArrayLike<number>): void
  ascii(text: string): void
  readonly length: number
  /** A copy of what was written, trimmed to size. */
  finish(): Uint8Array<ArrayBuffer>
}

export function createByteWriter(initialCapacity = 1024): ByteWriter {
  let buffer = new Uint8Array(Math.max(16, initialCapacity))
  let length = 0

  const reserve = (extra: number): void => {
    if (length + extra <= buffer.length) return
    let capacity = buffer.length
    while (capacity < length + extra) capacity *= 2
    const grown = new Uint8Array(capacity)
    grown.set(buffer.subarray(0, length))
    buffer = grown
  }

  const byte = (value: number): void => {
    reserve(1)
    buffer[length] = value & 0xff
    length += 1
  }

  return {
    byte,
    u16le(value) {
      byte(value)
      byte(value >>> 8)
    },
    u16be(value) {
      byte(value >>> 8)
      byte(value)
    },
    u32be(value) {
      byte(value >>> 24)
      byte(value >>> 16)
      byte(value >>> 8)
      byte(value)
    },
    bytes(data) {
      reserve(data.length)
      buffer.set(data, length)
      length += data.length
    },
    ascii(text) {
      reserve(text.length)
      for (let index = 0; index < text.length; index += 1) {
        buffer[length] = text.charCodeAt(index) & 0xff
        length += 1
      }
    },
    get length() {
      return length
    },
    finish() {
      return buffer.slice(0, length)
    },
  }
}
