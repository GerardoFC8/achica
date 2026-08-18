import { describe, expect, it } from 'vitest'
import type { JobError } from '../workers/protocol'
import { describeJobError } from './messages'

/**
 * The core reports failures as codes so the wording can live here. Every
 * message has to say what happened and what to do about it: a queue of three
 * hundred files is exactly where "algo salió mal" is useless.
 */

describe('describeJobError', () => {
  it('tells an iPhone user what to do about HEIC', () => {
    const message = describeJobError({ code: 'unsupported-format', format: 'heic' })

    expect(message).toContain('HEIC')
    expect(message).toContain('JPEG')
  })

  it('names the format that is not supported', () => {
    expect(describeJobError({ code: 'unsupported-format', format: 'tiff' })).toContain('TIFF')
  })

  it('does not blame the image when the worker died', () => {
    const message = describeJobError({ code: 'worker-crashed', detail: 'out of memory' })

    expect(message).toContain('memoria')
    expect(message).not.toContain('out of memory')
  })

  it('names the format of a file it could not read', () => {
    const message = describeJobError({ code: 'decode-failed', format: 'png', detail: 'bad IHDR' })

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
      { code: 'worker-crashed', detail: 'x' },
    ]

    for (const error of codes) {
      const message = describeJobError(error)
      expect(message.length).toBeGreaterThan(10)
      expect(message).not.toContain('undefined')
    }
  })
})
