import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadExpected, loadFixture, rgbSha256 } from '../../../test/helpers/animation-fixtures'
import { decodeAnimation } from './decode'

/**
 * The oracle is ffmpeg: the fixtures' `.expected.json` hold what it decodes
 * (SHA-256 of each frame's RGB24 bytes, and the delays). Nothing here
 * compares the decoder with itself.
 */

afterEach(() => {
  vi.unstubAllGlobals()
})

function must<T, E>(result: { ok: true; value: T } | { ok: false; error: E }): T {
  if (!result.ok) throw new Error(JSON.stringify(result.error))
  return result.value
}

describe('decodeAnimation against ffmpeg', () => {
  it.each(['anim-opaque.gif', 'anim-wide.gif', 'anim.apng', 'anim.webp', 'anim-delays.gif'])(
    '%s has the same frames, delays and RGB bytes',
    async (name) => {
      const expected = await loadExpected(name)
      const decoded = must(
        await decodeAnimation(await loadFixture(name), { fit: { kind: 'none' } }),
      )

      expect(decoded.width).toBe(expected.width)
      expect(decoded.height).toBe(expected.height)
      expect(decoded.frames).toHaveLength(expected.frames.length)
      expect(decoded.frames.map((frame) => frame.delayMs)).toEqual(
        expected.frames.map((frame) => frame.delayMs),
      )
      const hashes = await Promise.all(decoded.frames.map((frame) => rgbSha256(frame.data)))
      expect(hashes).toEqual(expected.frames.map((frame) => frame.sha256))
    },
  )

  it('reads every format as itself', async () => {
    const formats = await Promise.all(
      ['anim-opaque.gif', 'anim.apng', 'anim.webp'].map(async (name) => {
        return must(await decodeAnimation(await loadFixture(name), { fit: { kind: 'none' } }))
          .format
      }),
    )
    expect(formats).toEqual(['gif', 'apng', 'webp'])
  })

  it('keeps the delays that differ from frame to frame', async () => {
    const decoded = must(await decodeAnimation(await loadFixture('anim-delays.gif')))
    expect(new Set(decoded.frames.map((frame) => frame.delayMs)).size).toBeGreaterThan(2)
  })

  it('reads transparency as straight, binary alpha', async () => {
    const decoded = must(
      await decodeAnimation(await loadFixture('anim-transparent.gif'), { fit: { kind: 'none' } }),
    )
    expect(decoded.frames).toHaveLength(12)
    expect(decoded.width).toBe(96)
    expect(decoded.height).toBe(96)
    expect(decoded.frames.every((frame) => frame.delayMs === 100)).toBe(true)
    for (const frame of decoded.frames) {
      let clear = 0
      let solid = 0
      for (let at = 3; at < frame.data.length; at += 4) {
        const alpha = frame.data[at] ?? 0
        if (alpha <= 2) clear += 1
        else if (alpha >= 253) solid += 1
        else throw new Error(`partial alpha ${alpha}`)
      }
      // The circle is opaque and the corners are clear, on every frame.
      expect(solid).toBeGreaterThan(3000)
      expect(clear).toBeGreaterThan(1500)
      // Transparent pixels must not carry stray colour into a later resample.
      expect(frame.data[3]).toBe(0)
    }
  })

  it('frames while decoding: a sticker is exactly 320x320 and an emoji keeps the ratio', async () => {
    const sticker = must(
      await decodeAnimation(await loadFixture('anim-wide.gif'), {
        fit: { kind: 'sticker', size: 320 },
      }),
    )
    expect(sticker.frames.every((frame) => frame.width === 320 && frame.height === 320)).toBe(true)
    expect(sticker.sourceWidth).toBe(160)
    const emoji = must(
      await decodeAnimation(await loadFixture('anim-opaque.gif'), {
        fit: { kind: 'emoji', maxSide: 48 },
      }),
    )
    expect(emoji.frames.every((frame) => frame.width === 48 && frame.height === 48)).toBe(true)
  })
})

describe('decodeAnimation errors', () => {
  const code = async (bytes: Uint8Array, options = {}): Promise<string> => {
    const result = await decodeAnimation(bytes, options)
    return result.ok ? 'ok' : result.error.code
  }

  it('does not take a static PNG or a one-frame GIF for an animation', async () => {
    expect(await code(await loadFixture('static.png'))).toBe('not-animated')
    expect(await code(await loadFixture('single-frame.gif'))).toBe('not-animated')
  })

  it('rejects a JPEG, an empty file and unknown bytes', async () => {
    expect(await code(await loadFixture('orientation-1.jpg'))).toBe('unsupported-format')
    expect(await code(new Uint8Array(0))).toBe('empty-file')
    const noise = new Uint8Array(500).map((_, at) => (at * 37 + 11) % 251)
    expect(await code(noise)).toBe('unsupported-format')
  })

  it('reports a truncated GIF as a typed error, not an exception', async () => {
    const whole = await loadFixture('anim-opaque.gif')
    const result = await decodeAnimation(whole.subarray(0, Math.floor(whole.length * 0.6)))
    // Either it refuses the file or it decodes fewer frames; what it must not do is throw.
    if (result.ok) expect(result.value.frames.length).toBeLessThan(12)
    else expect(['corrupt', 'not-animated', 'too-large']).toContain(result.error.code)
  })

  it('reports garbage behind a valid signature as corrupt', async () => {
    const noise = new Uint8Array(400).map((_, at) => (at * 53 + 7) % 256)
    for (const head of [
      [0x47, 0x49, 0x46, 0x38, 0x39, 0x61],
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    ]) {
      const bytes = new Uint8Array(noise)
      bytes.set(head)
      const result = await decodeAnimation(bytes)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(['corrupt', 'not-animated', 'too-large']).toContain(result.error.code)
    }
  })

  it('refuses too many frames and absurd canvases before decoding them', async () => {
    expect(await code(await loadFixture('anim-opaque.gif'), { maxFrames: 5 })).toBe('too-large')
    expect(await code(await loadFixture('anim-opaque.gif'), { maxSourcePixels: 1000 })).toBe(
      'too-large',
    )
    const hostile = new Uint8Array(await loadFixture('anim-opaque.gif'))
    hostile.set([0xff, 0xff, 0xff, 0xff], 6) // 65535 x 65535
    expect(await code(hostile)).toBe('too-large')
  })

  it('says the browser is the wrong one when ImageDecoder is missing', async () => {
    vi.stubGlobal('ImageDecoder', undefined)
    const result = await decodeAnimation(await loadFixture('anim-opaque.gif'))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('animation-unsupported')
  })

  it('says so when the browser has ImageDecoder but not the type', async () => {
    vi.stubGlobal('ImageDecoder', {
      isTypeSupported: () => Promise.resolve(false),
    })
    const result = await decodeAnimation(await loadFixture('anim.webp'))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('animation-unsupported')
  })
})
