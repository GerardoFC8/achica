import { describe, expect, it, vi } from 'vitest'
import { err, ok } from '../core/result'
import type { HarWorkerAudit, HarWorkerResult } from '../workers/har.worker'
import {
  intakeFrom,
  MAX_HAR_BYTES,
  readDroppedHar,
  readHarFile,
  type HarReader,
} from './har-intake'

const bytes = (n: number): ArrayBuffer => new Uint8Array(n).fill(7).buffer

const audit = (patch: Partial<HarWorkerAudit> = {}): HarWorkerAudit => ({
  images: [
    { name: 'a.jpg', displayUrl: 'https://example.com/a.jpg', format: 'jpeg', buffer: bytes(30) },
    { name: 'b.png', displayUrl: 'https://example.com/b.png', format: 'png', buffer: bytes(20) },
  ],
  skipped: [
    {
      displayUrl: 'https://example.com/c.svg',
      mimeType: 'image/svg+xml',
      reason: 'unsupported-format',
      bytes: 9,
    },
  ],
  entryCount: 40,
  imageEntryCount: 4,
  duplicatesIgnored: 1,
  ...patch,
})

const reader = (result: HarWorkerResult): HarReader => vi.fn(async () => result)
const har = (size = 10): File => new File([new Uint8Array(size)], 'page.har')

describe('intakeFrom', () => {
  it('turns the extracted images into files with their real type and safe names', () => {
    const result = intakeFrom(audit())
    if (!result.ok) throw new Error('expected an intake')

    expect(result.value.files.map((file) => [file.name, file.type, file.size])).toEqual([
      ['a.jpg', 'image/jpeg', 30],
      ['b.png', 'image/png', 20],
    ])
  })

  it('keeps counters, the skipped list and where each file came from', () => {
    const result = intakeFrom(audit())
    if (!result.ok) throw new Error('expected an intake')

    expect(result.value.audit).toMatchObject({
      entryCount: 40,
      imageCount: 3,
      measurableCount: 2,
      measurableBytes: 50,
      duplicatesIgnored: 1,
    })
    expect(result.value.audit.skipped).toHaveLength(1)
    expect(result.value.audit.origins.get('a.jpg')).toBe('https://example.com/a.jpg')
  })

  it('is an error, not an empty queue, when nothing can be measured', () => {
    const none = audit({
      images: [],
      skipped: [
        {
          displayUrl: 'https://example.com/a.jpg',
          mimeType: 'image/jpeg',
          reason: 'no-content',
          bytes: 5,
        },
      ],
      imageEntryCount: 1,
      duplicatesIgnored: 0,
    })

    expect(intakeFrom(none)).toEqual(err({ code: 'no-images', imageEntries: 1, noContent: true }))
    expect(
      intakeFrom(audit({ images: [], skipped: [], imageEntryCount: 0, duplicatesIgnored: 0 })),
    ).toEqual(err({ code: 'no-images', imageEntries: 0, noContent: false }))
  })
})

describe('readHarFile', () => {
  it('refuses a file past the limit without reading it', async () => {
    const read = reader(ok(audit()))
    const big = { size: MAX_HAR_BYTES + 1 } as File

    expect(await readHarFile(big, read)).toEqual(
      err({ code: 'too-large', bytes: MAX_HAR_BYTES + 1 }),
    )
    expect(read).not.toHaveBeenCalled()
  })

  it('passes the reader its errors untouched', async () => {
    expect(await readHarFile(har(), reader(err({ code: 'not-json' })))).toEqual(
      err({ code: 'not-json' }),
    )
    expect(await readHarFile(har(), reader(err({ code: 'not-har' })))).toEqual(
      err({ code: 'not-har' }),
    )
    expect(
      await readHarFile(har(), reader(err({ code: 'too-many-entries', count: 70_000 }))),
    ).toEqual(err({ code: 'too-many-entries', count: 70_000 }))
  })

  it('calls a reader that died a read failure, not a crash', async () => {
    const dead: HarReader = () => Promise.reject(new Error('out of memory'))

    expect(await readHarFile(har(), dead)).toEqual(err({ code: 'read-failed' }))
  })
})

describe('readDroppedHar', () => {
  it('takes exactly one file', async () => {
    const read = reader(ok(audit()))

    expect(await readDroppedHar([har(), har()], read)).toEqual(err({ code: 'several-files' }))
    expect(await readDroppedHar([], read)).toEqual(err({ code: 'not-json' }))
    expect(read).not.toHaveBeenCalled()
    expect((await readDroppedHar([har()], read)).ok).toBe(true)
  })
})
