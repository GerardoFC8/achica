import { describe, expect, it } from 'vitest'
import type { JobError } from '../workers/protocol'
import { en, es } from './copy'
import { MAX_ENTRIES } from '../core/har'
import { createFormatters, DEFAULT_LOCALE } from './format'
import { MAX_HAR_BYTES, type IntakeError } from './har-intake'
import { describeIntakeError, describeJobError } from './messages'

/**
 * The core reports failures as codes so the wording can live here. Every
 * message has to say what happened and what to do about it: a queue of three
 * hundred files is exactly where "algo salió mal" is useless.
 */

describe('describeJobError', () => {
  it('tells an iPhone user what to do about HEIC', () => {
    const message = describeJobError(
      { code: 'unsupported-format', format: 'heic' },
      es,
      'comprimir',
    )

    expect(message).toContain('HEIC')
    expect(message).toContain('JPEG')
  })

  it('names the format that is not supported', () => {
    expect(
      describeJobError({ code: 'unsupported-format', format: 'tiff' }, es, 'comprimir'),
    ).toContain('TIFF')
  })

  it('does not blame the image when the worker died', () => {
    const message = describeJobError(
      { code: 'worker-crashed', detail: 'out of memory' },
      es,
      'comprimir',
    )

    expect(message).toContain('memoria')
    expect(message).not.toContain('out of memory')
  })

  it('names the format of a file it could not read', () => {
    const message = describeJobError(
      { code: 'decode-failed', format: 'png', detail: 'bad IHDR' },
      es,
      'comprimir',
    )

    expect(message).toContain('PNG')
    // The codec's own message is for logs. It is not an instruction to a user.
    expect(message).not.toContain('bad IHDR')
  })

  it('has a message for every code the core can produce', () => {
    const codes: JobError[] = [
      { code: 'empty-file' },
      { code: 'unknown-format', leadingBytes: '00 01' },
      { code: 'unsupported-format', format: 'gif' },
      { code: 'decode-failed', format: 'jpeg', detail: 'x' },
      { code: 'encode-failed', format: 'webp', detail: 'x' },
      { code: 'strip-unsupported', format: 'avif' },
      { code: 'corrupt', format: 'png', detail: 'x' },
      { code: 'worker-crashed', detail: 'x' },
    ]

    for (const copy of [es, en]) {
      for (const error of codes) {
        const message = describeJobError(error, copy, 'comprimir')
        expect(message.length).toBeGreaterThan(10)
        expect(message).not.toContain('undefined')
      }
    }
  })
})

describe('describeIntakeError', () => {
  const formatters = createFormatters(DEFAULT_LOCALE)
  const say = (error: IntakeError, copy = es): string =>
    describeIntakeError(error, copy, formatters)

  const ALL: readonly IntakeError[] = [
    { code: 'not-json' },
    { code: 'not-har' },
    { code: 'too-many-entries', count: 60_000 },
    { code: 'too-large', bytes: MAX_HAR_BYTES + 1 },
    { code: 'several-files' },
    { code: 'read-failed' },
    { code: 'no-images', imageEntries: 0, noContent: false },
    { code: 'no-images', imageEntries: 4, noContent: false },
    { code: 'no-images', imageEntries: 4, noContent: true },
  ]

  it('has a readable sentence for every error, in both languages', () => {
    for (const error of ALL) {
      for (const copy of [es, en]) {
        const message = say(error, copy)
        expect(message.length, error.code).toBeGreaterThan(15)
        expect(message, error.code).not.toContain('undefined')
        expect(message, error.code).not.toContain('NaN')
      }
    }
  })

  it('tells the user what to do, not only what went wrong', () => {
    expect(say({ code: 'not-json' })).toMatch(/Expórtalo/)
    expect(say({ code: 'not-har' })).toMatch(/Expórtalo/)
    expect(say({ code: 'not-json' }, en)).toMatch(/Export/)
    expect(say({ code: 'several-files' })).toMatch(/un solo archivo/)
  })

  it('names the limits it enforces, not invented ones', () => {
    const entries = say({ code: 'too-many-entries', count: 60_000 })
    const size = say({ code: 'too-large', bytes: MAX_HAR_BYTES + 1 })

    expect(entries).toContain(formatters.count(MAX_ENTRIES))
    expect(entries).toContain(formatters.count(60_000))
    expect(size).toContain(formatters.bytes(MAX_HAR_BYTES))
  })

  it('points at re-exporting with contents only when a body was missing', () => {
    const hinted = say({ code: 'no-images', imageEntries: 4, noContent: true })
    const plain = say({ code: 'no-images', imageEntries: 4, noContent: false })

    expect(hinted).toMatch(/contenido de las respuestas/)
    expect(plain).not.toMatch(/contenido de las respuestas/)
    expect(say({ code: 'no-images', imageEntries: 0, noContent: false })).toMatch(
      /ninguna petición/,
    )
  })
})
