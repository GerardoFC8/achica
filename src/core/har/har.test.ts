import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { FIXTURES } from '../../../test/fixtures/paths'
import { b64, entry, har, imageEntry } from '../../../test/helpers/har-builders'
import { detectSupportedFormat } from '../detect'
import { fnv1a } from './names'
import { parseHar } from './parse'
import type { HarAudit } from './types'

const read = async (path: string): Promise<Uint8Array> => new Uint8Array(await readFile(path))

const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0, 0, 0, 0x3b])
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>'
const AVIF = new Uint8Array([
  0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66, 0, 0, 0, 0, 0x61, 0x76, 0x69, 0x66,
  0x6d, 0x69, 0x66, 0x31,
])

function audit(text: string): HarAudit {
  const result = parseHar(text)
  if (!result.ok) throw new Error(`unexpected error ${result.error.code}`)
  return result.value
}

describe('A. secrets never leave the reader', () => {
  const S = {
    token: 'SENTINEL_TOKEN',
    pass: 'SENTINEL_PASS',
    user: 'SENTINEL_USER',
    frag: 'SENTINEL_FRAG',
    body: 'SENTINEL_BODY',
    bad: 'SENTINEL_BAD',
    skip: 'SENTINEL_SKIPPED',
    data: 'SENTINEL_DATA',
  }
  const all = Object.values(S)

  it('keeps every sentinel out of the result, names, URLs and skipped rows', async () => {
    const jpeg = await read(FIXTURES.noExif)
    const png = await read(FIXTURES.rgbaPng)
    const secrets = all
    const text = har([
      imageEntry(
        `https://${S.user}:${S.pass}@cdn.example.com/a/photo.jpg?token=${S.token}#${S.frag}`,
        jpeg,
      ),
      imageEntry(`https://cdn.example.com/b/${S.token}.png`.replace(S.token, 'plain'), png, {
        mimeType: 'image/png',
      }),
      entry(
        {
          url: `https://x.example/app.js?t=${S.token}`,
          mimeType: 'application/javascript',
          text: `var k="${S.body}"`,
        },
        secrets,
      ),
      entry(
        { url: 'https://x.example/page', mimeType: 'text/html', text: `<p>${S.body}</p>` },
        secrets,
      ),
      entry(
        {
          url: `https://x.example/api?token=${S.token}`,
          mimeType: 'application/json',
          text: `{"k":"${S.body}"}`,
        },
        secrets,
      ),
      // skipped rows must not echo their query either
      entry(
        { url: `https://x.example/gone.png?token=${S.skip}`, status: 404, mimeType: 'image/png' },
        secrets,
      ),
      entry(
        { url: `data:image/png;base64,${S.data}AAAA`, mimeType: 'image/png', text: '', size: 10 },
        secrets,
      ),
      entry({ url: `http://[${S.bad}`, mimeType: 'image/png', text: '', size: 10 }, secrets),
      entry(
        { url: `https://x.example/c.svg?k=${S.skip}`, mimeType: 'image/svg+xml', text: SVG },
        secrets,
      ),
    ])

    const out = audit(text)
    const dump = JSON.stringify({
      ...out,
      images: out.images.map((i) => ({ ...i, bytes: i.bytes.length })),
    })
    for (const secret of all) expect(dump, secret).not.toContain(secret)
    expect(dump).not.toMatch(/[?#]/)
    expect(dump).not.toContain('@')
    expect(out.images.map((i) => i.displayUrl)).toContain('https://cdn.example.com/a/photo.jpg')
    expect(out.skipped.map((s) => s.displayUrl)).toEqual(
      expect.arrayContaining(['data:image/png (inline)', '(URL ilegible)']),
    )
  })

  it('reports errors as codes only', () => {
    const r = parseHar(`not json ${S.token}`)
    expect(r.ok).toBe(false)
    expect(JSON.stringify(r)).not.toContain(S.token)
  })

  it('does not let the result keep the parsed document alive through its bytes', async () => {
    const jpeg = await read(FIXTURES.noExif)
    const out = audit(har([imageEntry('https://a.example/x.jpg', jpeg)]))
    const bytes = out.images[0]?.bytes as Uint8Array<ArrayBuffer>
    expect(bytes.byteOffset).toBe(0)
    expect(bytes.buffer.byteLength).toBe(bytes.length)
  })
})

describe('B. skip reasons and counters', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 1, 2, 3, 4, 5])

  it('classifies each reason with its weight', async () => {
    const real = await read(FIXTURES.noExif)
    const out = audit(
      har([
        imageEntry('https://a.example/ok.jpg', real, { transferSize: 555 }),
        imageEntry('https://a.example/f0.jpg', real, { status: 0 }),
        imageEntry('https://a.example/f404.jpg', real, { status: 404, size: 900 }),
        imageEntry('https://a.example/p.jpg', real, { status: 206 }),
        entry({ url: 'https://a.example/c304.jpg', status: 304, mimeType: 'image/jpeg', size: 0 }),
        entry({
          url: 'https://a.example/cache.jpg',
          mimeType: 'image/jpeg',
          size: 0,
          transferSize: 0,
        }),
        entry({
          url: 'https://a.example/nocontent.jpg',
          mimeType: 'image/jpeg',
          size: 4321,
          transferSize: 1000,
        }),
        entry({
          url: 'https://a.example/enc.jpg',
          mimeType: 'image/jpeg',
          text: 'abc',
          encoding: 'gzip',
          size: 3,
        }),
        entry({ url: 'https://a.example/plain.jpg', mimeType: 'image/jpeg', text: 'abc', size: 3 }),
        entry({
          url: 'https://a.example/badb64.jpg',
          mimeType: 'image/jpeg',
          text: '@@@@',
          encoding: 'base64',
          size: 3,
        }),
        entry({
          url: 'https://a.example/notimg.jpg',
          mimeType: 'image/jpeg',
          text: b64(new Uint8Array([1, 2, 3, 4])),
          encoding: 'base64',
          size: 4,
        }),
        entry({
          url: 'https://a.example/g.gif',
          mimeType: 'image/gif',
          text: b64(GIF),
          encoding: 'base64',
          size: GIF.length,
        }),
        entry({
          url: 'https://a.example/s.svg',
          mimeType: 'image/svg+xml',
          text: SVG,
          size: SVG.length,
        }),
        entry({
          url: 'https://a.example/s64.svg',
          mimeType: 'image/svg+xml',
          text: b64(new TextEncoder().encode(SVG)),
          encoding: 'base64',
          size: SVG.length,
        }),
        entry({
          url: 'https://a.example/script.js',
          mimeType: 'application/javascript',
          text: 'x',
        }),
      ]),
    )
    const reasons = Object.fromEntries(out.skipped.map((s) => [s.displayUrl.split('/').pop(), s]))
    expect(out.images.map((i) => i.transferBytes)).toEqual([555])
    expect(reasons['f0.jpg']?.reason).toBe('failed-request')
    expect(reasons['f404.jpg']).toMatchObject({
      reason: 'failed-request',
      bytes: 900,
      mimeType: 'image/jpeg',
    })
    expect(reasons['p.jpg']?.reason).toBe('partial')
    expect(reasons['c304.jpg']?.reason).toBe('cached')
    expect(reasons['cache.jpg']?.reason).toBe('cached')
    expect(reasons['nocontent.jpg']).toMatchObject({ reason: 'no-content', bytes: 4321 })
    expect(reasons['enc.jpg']?.reason).toBe('unreadable-content')
    expect(reasons['plain.jpg']?.reason).toBe('unreadable-content')
    expect(reasons['badb64.jpg']?.reason).toBe('unreadable-content')
    expect(reasons['notimg.jpg']?.reason).toBe('unreadable-content')
    expect(reasons['g.gif']?.reason).toBe('unsupported-format')
    expect(reasons['s.svg']?.reason).toBe('unsupported-format')
    expect(reasons['s64.svg']?.reason).toBe('unsupported-format')
    expect(out.entryCount).toBe(15)
    expect(out.imageEntryCount).toBe(14)
    expect(out.images.length + out.skipped.length + out.duplicatesIgnored).toBe(out.imageEntryCount)
  })

  it('counts a full URL once, and the query makes a different URL', () => {
    const out = audit(
      har([
        imageEntry('https://a.example/x.jpg', jpeg),
        imageEntry('https://a.example/x.jpg', jpeg),
        imageEntry('https://a.example/x.jpg?v=2', jpeg),
        imageEntry('https://a.example/x.jpg', jpeg),
      ]),
    )
    expect(out.images).toHaveLength(2)
    expect(out.duplicatesIgnored).toBe(2)
    expect(out.imageEntryCount).toBe(4)
  })

  it('lets a later successful response replace an earlier failed one for the same URL', () => {
    const out = audit(
      har([
        imageEntry('https://a.example/x.jpg', jpeg, { status: 0 }),
        imageEntry('https://a.example/x.jpg', jpeg),
      ]),
    )
    expect(out.images).toHaveLength(1)
    expect(out.skipped).toHaveLength(0)
    expect(out.images.length + out.skipped.length + out.duplicatesIgnored).toBe(out.imageEntryCount)
  })

  it('shows data: URLs by type only, and extracts them when readable', () => {
    const body = jpeg
    const out = audit(har([imageEntry(`data:image/jpeg;base64,${b64(body)}`, body)]))
    expect(out.images[0]?.displayUrl).toBe('data:image/jpeg (inline)')
    expect(out.images[0]?.name).toBe('imagen.jpg')
  })

  it('decides by the bytes when the mime type is missing, and ignores non-images', () => {
    const out = audit(
      har([
        entry({ url: 'https://a.example/nomime', text: b64(jpeg), encoding: 'base64', size: 10 }),
        entry({
          url: 'https://a.example/nomime2',
          mimeType: '',
          text: b64(new TextEncoder().encode('hello world')),
          encoding: 'base64',
        }),
        entry({ url: 'https://a.example/blank', mimeType: 'x-unknown', status: 0 }),
      ]),
    )
    expect(out.images).toHaveLength(1)
    expect(out.imageEntryCount).toBe(1)
    expect(out.entryCount).toBe(3)
  })

  it('returns an empty audit for a HAR with no images, and detects AVIF', () => {
    expect(audit(har([])).images).toEqual([])
    const out = audit(har([imageEntry('https://a.example/a', AVIF, { mimeType: 'image/avif' })]))
    expect(out.images[0]?.format).toBe('avif')
    expect(out.images[0]?.name).toBe('a.avif')
  })

  it('rejects more than 50,000 entries', () => {
    const r = parseHar(JSON.stringify({ log: { entries: new Array(50_001).fill(0) } }))
    expect(r).toEqual({ ok: false, error: { code: 'too-many-entries', count: 50_001 } })
  })
})

describe('C. hostile names', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 1, 2, 3])
  const names = (urls: string[]): string[] =>
    audit(har(urls.map((u) => imageEntry(u, jpeg)))).images.map((i) => i.name)

  it('flattens traversal, separators, nulls, empty paths, length, emoji and dotfiles', () => {
    const result = names([
      'https://a.example/..%2F..%2Fetc%2Fpasswd.jpg',
      'https://a.example/a/b\\c.png',
      'https://a.example/x%00y.jpg',
      'https://a.example/',
      `https://a.example/${'z'.repeat(500)}.jpg`,
      'https://a.example/%F0%9F%98%80%F0%9F%98%80.jpg',
      'https://a.example/CON.jpg',
      'https://a.example/nul.tar.png',
      'https://a.example/.hidden',
      'https://a.example/%E0%A4%A.jpg',
    ])
    for (const name of result) {
      expect(name).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]*\.jpg$/)
      expect(name.length).toBeLessThanOrEqual(80)
      expect(name).not.toMatch(/\.\.|--/)
    }
    expect(result[0]).toBe('etc-passwd.jpg')
    expect(result[1]).toBe('c.jpg')
    expect(result[2]).toBe('x-y.jpg')
    expect(result[3]).toBe('imagen.jpg')
    expect(result[5]).toMatch(/^imagen-[0-9a-f]{8}.jpg$/)
    expect(result[6]).toBe('img-CON.jpg')
    expect(result[7]).toBe('img-nul.tar.jpg')
    expect(result[8]).toBe('hidden.jpg')
  })

  it('takes the extension from the bytes, not from the URL', () => {
    expect(names(['https://a.example/photo.png'])).toEqual(['photo.jpg'])
    expect(names(['https://a.example/v1.2'])).toEqual(['v1.2.jpg'])
  })

  it('keeps names that differ only by case apart', () => {
    const result = names(['https://a.example/x/Foto.jpg', 'https://a.example/y/foto.JPG'])
    expect(new Set(result.map((n) => n.toLowerCase())).size).toBe(2)
    expect(result[0]).toBe('Foto.jpg')
  })

  it('tells ten thumb.jpg apart, deterministically, each paired with its URL', () => {
    const urls = Array.from(
      { length: 10 },
      (_, i) => `https://a.example/p${i % 5}/thumb.jpg?v=${i}`,
    )
    const first = audit(har(urls.map((u) => imageEntry(u, jpeg))))
    const second = audit(har(urls.map((u) => imageEntry(u, jpeg))))
    const list = first.images.map((i) => i.name)
    expect(new Set(list.map((n) => n.toLowerCase())).size).toBe(10)
    expect(list).toEqual(second.images.map((i) => i.name))
    expect(first.images.map((i) => i.displayUrl)).toEqual(
      urls.map((_, i) => `https://a.example/p${i % 5}/thumb.jpg`),
    )
    expect(list[0]).toBe('thumb.jpg')
    expect(list[1]).toBe('p1-thumb.jpg')
    expect(list[5]).toBe('p0-thumb.jpg')
  })

  it('falls back to a hash of the full URL when the folder is not enough', () => {
    const urls = [
      'https://a.example/p/thumb.jpg?v=1',
      'https://a.example/p/thumb.jpg?v=2',
      'https://a.example/p/thumb.jpg?v=3',
    ]
    const list = names(urls)
    expect(list).toEqual(['thumb.jpg', 'p-thumb.jpg', `thumb-${fnv1a(urls[2] as string)}.jpg`])
  })

  it('computes FNV-1a like the reference vectors', () => {
    expect(fnv1a('')).toBe('811c9dc5')
    expect(fnv1a('a')).toBe('e40c292c')
    expect(fnv1a('foobar')).toBe('bf9cf968')
  })
})

describe('E. hostile input', () => {
  it('rejects non-HAR documents with a code', () => {
    expect(parseHar('')).toEqual({ ok: false, error: { code: 'not-json' } })
    expect(parseHar('{nope')).toEqual({ ok: false, error: { code: 'not-json' } })
    for (const doc of [
      'null',
      '3',
      '"x"',
      '[]',
      '{}',
      '{"log":null}',
      '{"log":{}}',
      '{"log":{"entries":{}}}',
      '{"log":{"entries":"x"}}',
    ]) {
      expect(parseHar(doc), doc).toEqual({ ok: false, error: { code: 'not-har' } })
    }
  })

  it('survives entries with fields of the wrong type', () => {
    const junk: unknown[] = [
      null,
      1,
      'x',
      [],
      {},
      { request: 1, response: 2 },
      { response: { content: 'x' } },
      {
        request: { url: 5 },
        response: { status: 'a', content: { mimeType: 7, text: 9, encoding: {}, size: 'big' } },
      },
      {
        request: { url: {} },
        response: { status: 200, content: { mimeType: 'image/png', text: ['x'], size: -1 } },
      },
      {
        request: { url: 'https://a.example/x.png' },
        response: {
          status: 1.5,
          bodySize: NaN,
          _transferSize: 'x',
          content: { mimeType: 'image/png', text: 'AAAA', encoding: 'base64' },
        },
      },
      {
        request: { url: 'https://a.example/y.png' },
        response: {
          status: 200,
          content: { mimeType: 'image/png', text: 'AAAA', encoding: 'base64', size: 1e300 },
        },
      },
    ]
    const out = audit(har(junk))
    expect(out.entryCount).toBe(junk.length)
    expect(out.images).toHaveLength(0)
  })

  it('handles a huge fake text quickly', () => {
    const t = Date.now()
    const out = audit(
      har([
        entry({
          url: 'https://a.example/h.jpg',
          mimeType: 'image/jpeg',
          text: 'A'.repeat(20_000_000),
          encoding: 'base64',
          size: 1,
        }),
      ]),
    )
    expect(out.skipped[0]?.reason).toBe('unreadable-content')
    expect(Date.now() - t).toBeLessThan(5000)
  })

  it('never throws on every truncation of a valid HAR nor on 500 seeded mutations', async () => {
    const jpeg = await read(FIXTURES.noExif)
    const valid = har([
      imageEntry('https://u:p@a.example/a.jpg?t=1#f', jpeg, { transferSize: 10, bodySize: 5 }),
      entry({
        url: 'data:image/gif;base64,R0lG',
        mimeType: 'image/gif',
        text: b64(GIF),
        encoding: 'base64',
      }),
      entry({ url: 'https://a.example/s.svg', mimeType: 'image/svg+xml', text: SVG }),
    ])
    for (let cut = 0; cut <= valid.length; cut += 1) {
      expect(() => parseHar(valid.slice(0, cut))).not.toThrow()
    }

    let seed = 12345
    const next = (n: number): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      return seed % n
    }
    const swaps = [
      'null',
      '0',
      '-1',
      '"x"',
      '[]',
      '{}',
      '1e999',
      'true',
      '"image/png"',
      '"base64"',
      '9007199254740993',
    ]
    const doc = JSON.parse(valid) as unknown
    const paths: (string | number)[][] = []
    const walk = (node: unknown, path: (string | number)[]): void => {
      paths.push(path)
      if (typeof node === 'object' && node !== null) {
        for (const [k, v] of Object.entries(node)) walk(v, [...path, k])
      }
    }
    walk(doc, [])
    for (let i = 0; i < 500; i += 1) {
      const clone = JSON.parse(valid) as Record<string, unknown>
      const path = paths[next(paths.length)] as (string | number)[]
      if (path.length === 0) continue
      let parent: Record<string, unknown> = clone
      for (const key of path.slice(0, -1)) parent = parent[key] as Record<string, unknown>
      const last = path[path.length - 1] as string
      if (next(4) === 0) delete parent[last]
      else parent[last] = JSON.parse(swaps[next(swaps.length)] as string)
      const result = parseHar(JSON.stringify(clone))
      if (!result.ok)
        expect(['not-json', 'not-har', 'too-many-entries']).toContain(result.error.code)
    }
  })
})

describe('F. real bytes', () => {
  it('returns identical bytes and the real format even when the mime type lies', async () => {
    const jpeg = await read(FIXTURES.noExif)
    const png = await read(FIXTURES.rgbaPng)
    const webp = await read(FIXTURES.sampleWebp)
    const out = audit(
      har([
        imageEntry('https://a.example/one.png', jpeg, { mimeType: 'image/png' }),
        imageEntry('https://a.example/two.webp', png, { mimeType: 'image/webp' }),
        imageEntry('https://a.example/three.jpg', webp, { mimeType: 'image/jpeg' }),
      ]),
    )
    expect(out.images.map((i) => i.format)).toEqual(['jpeg', 'png', 'webp'])
    expect(out.images.map((i) => i.name)).toEqual(['one.jpg', 'two.png', 'three.webp'])
    expect(Buffer.from(out.images[0]?.bytes as Uint8Array).equals(Buffer.from(jpeg))).toBe(true)
    expect(Buffer.from(out.images[1]?.bytes as Uint8Array).equals(Buffer.from(png))).toBe(true)
    expect(Buffer.from(out.images[2]?.bytes as Uint8Array).equals(Buffer.from(webp))).toBe(true)
    for (const image of out.images) {
      const detected = detectSupportedFormat(image.bytes)
      expect(detected.ok && detected.value).toBe(image.format)
    }
  })
})
