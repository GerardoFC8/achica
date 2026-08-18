import { describe, expect, it } from 'vitest'
import { buildZip, saveAsZip, saveToFolder, supportsFolderPicker, type SaveFile } from './save'

/**
 * Both save paths, driven against fakes.
 *
 * The folder picker needs a user gesture, so the real one cannot be opened
 * from a test at all — which is precisely why `saveToFolder` takes the picker
 * as an argument. The cases worth covering are the ones a hand test never
 * reaches anyway: a user closing the dialog, and permission disappearing
 * halfway through a batch.
 */

const file = (name: string, size: number): SaveFile => ({
  name,
  blob: new Blob([new Uint8Array(size)], { type: 'image/webp' }),
})

/** A directory that records what it was told to write. */
function fakeDirectory(failOn: string | null = null) {
  const written: { name: string; size: number }[] = []

  const handle = {
    async getFileHandle(name: string) {
      if (name === failOn) throw new DOMException('permission denied', 'NotAllowedError')

      return {
        async createWritable() {
          let size = 0
          return {
            async write(blob: Blob) {
              size = blob.size
            },
            async close() {
              written.push({ name, size })
            },
          }
        },
      }
    },
  } as unknown as FileSystemDirectoryHandle

  return { handle, written }
}

describe('support detection', () => {
  it('never claims a folder picker the browser does not have', () => {
    // This file runs in both projects, so the assertion cannot be a constant.
    // What must hold either way: the answer matches reality. In Firefox it is
    // false, and every ZIP test below is that browser's only road out.
    expect(supportsFolderPicker()).toBe('showDirectoryPicker' in globalThis)
  })
})

describe('saving into a folder', () => {
  it('writes every file under the name it was given', async () => {
    const { handle, written } = fakeDirectory()

    const outcome = await saveToFolder([file('a.webp', 10), file('b.webp', 20)], async () => handle)

    expect(outcome).toEqual({ status: 'saved', files: 2, bytes: 30 })
    expect(written).toEqual([
      { name: 'a.webp', size: 10 },
      { name: 'b.webp', size: 20 },
    ])
  })

  it('treats closing the picker as a decision, not a failure', async () => {
    const outcome = await saveToFolder([file('a.webp', 10)], async () => {
      throw new DOMException('The user aborted a request.', 'AbortError')
    })

    expect(outcome).toEqual({ status: 'cancelled' })
  })

  it('reports a refused folder as a failure', async () => {
    const outcome = await saveToFolder([file('a.webp', 10)], async () => {
      throw new DOMException('denied', 'NotAllowedError')
    })

    expect(outcome.status).toBe('failed')
  })

  it('keeps what it already wrote when permission disappears mid-batch', async () => {
    const { handle, written } = fakeDirectory('b.webp')

    const outcome = await saveToFolder(
      [file('a.webp', 10), file('b.webp', 20), file('c.webp', 30)],
      async () => handle,
    )

    expect(outcome.status).toBe('failed')
    // The first file is on disk whatever the outcome says, so the interface
    // must not tell the user that nothing was saved.
    expect(written).toEqual([{ name: 'a.webp', size: 10 }])
  })
})

describe('saving as a ZIP', () => {
  it('produces an archive that begins like a ZIP', async () => {
    const blob = await buildZip([file('a.webp', 10), file('b.webp', 20)])
    const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer())

    // PK\x03\x04 — the local file header. A ZIP nobody can open is worse than
    // no ZIP, and this is the cheapest possible check that it is one.
    expect([...head]).toEqual([0x50, 0x4b, 0x03, 0x04])
    expect(blob.size).toBeGreaterThan(30)
  })

  it('carries every name into the archive', async () => {
    const blob = await buildZip([file('primera.webp', 4), file('segunda.webp', 4)])
    const text = await blob.text()

    expect(text).toContain('primera.webp')
    expect(text).toContain('segunda.webp')
  })

  it('hands the archive over under the name it was asked for', async () => {
    const sent: { name: string; size: number }[] = []

    const outcome = await saveAsZip([file('a.webp', 10)], 'achica.zip', (blob, name) => {
      sent.push({ name, size: blob.size })
    })

    expect(outcome.status).toBe('saved')
    expect(sent[0]?.name).toBe('achica.zip')
  })

  it('reports a failure instead of throwing at the interface', async () => {
    const outcome = await saveAsZip([file('a.webp', 10)], 'achica.zip', () => {
      throw new Error('download blocked')
    })

    expect(outcome).toEqual({ status: 'failed', detail: 'download blocked' })
  })
})
