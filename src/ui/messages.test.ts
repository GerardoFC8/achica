import { describe, expect, it } from 'vitest'
import type { JobError } from '../workers/protocol'
import { en, es } from './copy'
import { MAX_ENTRIES } from '../core/har'
import { createFormatters, DEFAULT_LOCALE } from './format'
import { MAX_HAR_BYTES, type IntakeError } from './har-intake'
import type { AnimationFailure, VideoFailure } from '../core/pipeline'
import { describeIntakeError, describeJobError, formatName } from './messages'

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
      { code: 'animation-failed', reason: 'not-animated', detail: 'x' },
      { code: 'video-failed', reason: 'stalled', detail: 'x' },
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

describe('describeJobError for animations', () => {
  const REASONS = [
    'empty-file',
    'not-animated',
    'animation-unsupported',
    'unsupported-format',
    'corrupt',
    'too-large',
    'resize-failed',
    'no-frames',
    'too-many-frames',
    'bad-dimensions',
    'size-mismatch',
    'bad-frame-data',
    'bad-delay',
    'bad-option',
    'compression-unavailable',
    'compression-failed',
  ] as const satisfies readonly AnimationFailure['reason'][]

  const say = (reason: AnimationFailure['reason'], copy = es): string =>
    describeJobError(
      { code: 'animation-failed', reason, detail: 'internal detail' },
      copy,
      'comprimir',
    )

  it('has an actionable sentence for every reason, in both languages', () => {
    for (const copy of [es, en]) {
      for (const reason of REASONS) {
        const message = say(reason, copy)
        expect(message.length, reason).toBeGreaterThan(10)
        expect(message, reason).not.toContain('undefined')
        // The detail is for a bug report, never for the user.
        expect(message, reason).not.toContain('internal detail')
      }
    }
  })

  it('sends a still image to the tools that handle stills', () => {
    expect(say('not-animated')).toContain('Comprimir o Redimensionar')
    expect(say('not-animated', en)).toContain('Compress or Resize')
  })

  it('names the browsers that can read animations', () => {
    expect(say('animation-unsupported')).toMatch(/Chrome, Edge o Firefox/)
    expect(say('animation-unsupported', en)).toMatch(/Chrome, Edge or Firefox/)
  })

  it('tells the user to try a shorter or smaller animation when it is too large', () => {
    expect(say('too-large')).toContain('más corta o más pequeña')
    expect(say('too-large', en)).toContain('shorter or smaller')
  })

  it('says which formats are readable when the file is not one of them', () => {
    expect(say('unsupported-format')).toContain('GIF, APNG y WebP animado')
  })

  it('names APNG in a sentence', () => {
    expect(formatName('apng')).toBe('APNG')
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

describe('describeJobError for videos', () => {
  const REASONS = [
    'unsupported-video',
    'codec-unsupported',
    'no-video-track',
    'corrupt',
    'stalled',
    'aborted',
    'bad-options',
    'internal',
  ] as const satisfies readonly VideoFailure['reason'][]

  const say = (reason: VideoFailure['reason'], copy = es): string =>
    describeJobError({ code: 'video-failed', reason, detail: 'internal detail' }, copy, 'discord')

  it('has a sentence for every reason, in both languages, never the internal detail', () => {
    for (const copy of [es, en]) {
      for (const reason of REASONS) {
        const message = say(reason, copy)
        expect(message.length, reason).toBeGreaterThan(10)
        expect(message, reason).not.toContain('undefined')
        expect(message, reason).not.toContain('internal detail')
      }
    }
  })

  it('tells a HEVC user which browsers to try and what to convert to', () => {
    expect(say('codec-unsupported')).toContain('HEVC')
    expect(say('codec-unsupported')).toContain('Chrome, Edge o Firefox')
    expect(say('codec-unsupported')).toContain('H.264')
    expect(say('codec-unsupported', en)).toContain('Chrome, Edge or Firefox')
    expect(say('codec-unsupported', en)).toContain('H.264')
  })

  it('asks to keep the tab visible when no frame arrived', () => {
    expect(say('stalled')).toContain('pestaña visible')
    expect(say('stalled', en)).toContain('tab visible')
  })

  it('does not blame a crashed worker for a video that could not be read', () => {
    for (const reason of REASONS) {
      expect(say(reason)).not.toBe(es.errors.workerCrashed)
    }
  })

  it('says which containers are readable', () => {
    expect(say('unsupported-video')).toContain('MP4 y WebM')
    expect(say('unsupported-video', en)).toContain('MP4 and WebM')
  })
})
