import { describe, expect, it } from 'vitest'
import { decodeBase64 } from './base64'

/** Deterministic pseudo-random bytes (mulberry32), so a failure is reproducible. */
function randomBytes(length: number, seed: number): Uint8Array {
  let a = seed >>> 0
  const out = new Uint8Array(length)
  for (let i = 0; i < length; i += 1) {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    out[i] = ((t ^ (t >>> 14)) >>> 0) & 0xff
  }
  return out
}

describe('decodeBase64', () => {
  it('matches Buffer for random inputs of many lengths, with and without padding', () => {
    for (let length = 0; length <= 70; length += 1) {
      const bytes = randomBytes(length, length + 1)
      const padded = Buffer.from(bytes).toString('base64')
      const bare = padded.replace(/=+$/, '')
      expect(Buffer.from(decodeBase64(padded) as Uint8Array)).toEqual(Buffer.from(bytes))
      expect(Buffer.from(decodeBase64(bare) as Uint8Array)).toEqual(Buffer.from(bytes))
    }
    const big = randomBytes(100_003, 7)
    expect(Buffer.from(decodeBase64(Buffer.from(big).toString('base64')) as Uint8Array)).toEqual(
      Buffer.from(big),
    )
  })

  it('tolerates line breaks and spaces anywhere', () => {
    const bytes = randomBytes(300, 3)
    const text = Buffer.from(bytes).toString('base64')
    const wrapped = text.replace(/(.{76})/g, '$1\r\n').replace(/(.{10})/g, '$1 ')
    expect(Buffer.from(decodeBase64(wrapped) as Uint8Array)).toEqual(Buffer.from(bytes))
  })

  it('rejects characters outside the standard alphabet', () => {
    for (const bad of ['AAA*', 'AA-A', 'AA_A', 'AAéA', 'AA中A', 'AA\0A', 'AAAA=AAA', 'A===']) {
      expect(decodeBase64(bad), JSON.stringify(bad)).toBeNull()
    }
  })

  it('rejects a lone trailing character and wrong padding', () => {
    expect(decodeBase64('QUJDR')).toBeNull()
    expect(decodeBase64('QUI=')).not.toBeNull()
    expect(decodeBase64('QUI==')).toBeNull()
  })

  it('returns an empty array for empty text and a prefix tolerates a cut group', () => {
    expect(decodeBase64('')?.length).toBe(0)
    expect(decodeBase64('QUJDR', { prefix: true })).toEqual(new Uint8Array([0x41, 0x42, 0x43]))
  })
})
