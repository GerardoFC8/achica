import { describe, expect, it } from 'vitest'
import type { QueueItem } from '../state/queue'
import { saveList } from './save-list'

/**
 * What a save is handed: the finished rows, renamed for the format they came
 * out as, with collisions already resolved. Both save paths read this list, so
 * neither can invent a name of its own.
 */

const source = (name: string): File => new File([new Uint8Array(2)], name)

function done(name: string, format: 'webp' | 'jpeg'): QueueItem {
  return {
    id: name,
    file: source(name),
    name,
    bytesBefore: 1000,
    status: 'done',
    blob: new Blob([new Uint8Array(100)]),
    ms: 10,
    outcome: {
      format,
      bytesBefore: 1000,
      bytesAfter: 100,
      width: 10,
      height: 10,
      quality: 70,
      withinBudget: true,
      shrunkForBudget: null,
      encodes: 1,
    },
  }
}

describe('saveList', () => {
  it('renames each file for the format it actually came out as', () => {
    expect(saveList([done('foto.jpg', 'webp')]).map((file) => file.name)).toEqual(['foto.webp'])
  })

  it('resolves a collision the conversion created', () => {
    // foto.jpg and foto.png both become foto.webp. Nothing collided until we
    // converted them, which makes this ours to fix rather than the user's.
    const names = saveList([done('foto.jpg', 'webp'), done('foto.png', 'webp')]).map((f) => f.name)

    expect(names).toEqual(['foto.webp', 'foto-2.webp'])
  })

  it('leaves out everything that has no result to save', () => {
    const pending: QueueItem = {
      id: 'p',
      file: source('espera.jpg'),
      name: 'espera.jpg',
      bytesBefore: 10,
      status: 'pending',
    }
    const failed: QueueItem = {
      id: 'f',
      file: source('roto.png'),
      name: 'roto.png',
      bytesBefore: 10,
      status: 'failed',
      error: { code: 'empty-file' },
    }

    expect(saveList([pending, done('ok.jpg', 'jpeg'), failed])).toHaveLength(1)
  })

  it('carries the blob itself, not a copy of its bytes', () => {
    const item = done('foto.jpg', 'webp')
    if (item.status !== 'done') return

    expect(saveList([item])[0]?.blob).toBe(item.blob)
  })
})
