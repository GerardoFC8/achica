let table: Uint32Array | null = null

/** CRC-32 as PNG defines it (IEEE polynomial, reflected, final XOR). */
export function crc32(bytes: Uint8Array): number {
  if (table === null) {
    table = new Uint32Array(256)
    for (let n = 0; n < 256; n += 1) {
      let c = n
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      table[n] = c >>> 0
    }
  }
  let crc = 0xffffffff
  for (let index = 0; index < bytes.length; index += 1) {
    crc = (table[(crc ^ (bytes[index] ?? 0)) & 0xff] ?? 0) ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}
