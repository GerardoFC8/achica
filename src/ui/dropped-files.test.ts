import { describe, expect, it } from 'vitest'
import { collectFiles, type DroppedEntry } from './dropped-files'

/**
 * The spec asks for dragging a folder, not files, and a folder is where the
 * browser's API turns awkward: `readEntries` hands back at most a hundred
 * children per call and answers with an empty list only when it is finished.
 * Reading it once looks correct against a small folder and silently drops the
 * rest of a real one — which is exactly the shape of bug a fake can force and
 * a manual test cannot.
 */

const fileEntry = (name: string): DroppedEntry => ({
  isFile: true,
  isDirectory: false,
  name,
  file: (resolve) => resolve(new File([new Uint8Array(2)], name)),
})

/** Answers in batches of `batch`, then with an empty list, as Chromium does. */
function directoryEntry(
  name: string,
  children: readonly DroppedEntry[],
  batch = 100,
): DroppedEntry {
  let offset = 0

  return {
    isFile: false,
    isDirectory: true,
    name,
    createReader: () => ({
      readEntries: (resolve) => {
        const slice = children.slice(offset, offset + batch)
        offset += slice.length
        resolve(slice)
      },
    }),
  }
}

describe('collectFiles', () => {
  it('takes plain files as they come', async () => {
    const files = await collectFiles([fileEntry('b.jpg'), fileEntry('a.jpg')])

    expect(files.map((file) => file.name)).toEqual(['b.jpg', 'a.jpg'])
  })

  it('reads a folder to the end, not just its first batch', async () => {
    const children = Array.from({ length: 250 }, (_, index) => fileEntry(`f${index}.jpg`))

    const files = await collectFiles([directoryEntry('fotos', children)])

    expect(files).toHaveLength(250)
  })

  it('goes down through nested folders', async () => {
    const inner = directoryEntry('agosto', [fileEntry('c.jpg')])
    const outer = directoryEntry('fotos', [fileEntry('a.jpg'), inner])

    const files = await collectFiles([outer])

    expect(files.map((file) => file.name)).toEqual(['a.jpg', 'c.jpg'])
  })

  it('skips what the file system left behind', async () => {
    // .DS_Store and friends are not files the user chose to compress, and a
    // row saying "no es una imagen" for each of them is noise, not honesty.
    const files = await collectFiles([
      directoryEntry('fotos', [fileEntry('.DS_Store'), fileEntry('a.jpg')]),
    ])

    expect(files.map((file) => file.name)).toEqual(['a.jpg'])
  })

  it('keeps going when one entry refuses to be read', async () => {
    const broken: DroppedEntry = {
      isFile: true,
      isDirectory: false,
      name: 'bloqueado.jpg',
      file: (_resolve, reject) => reject(new Error('permission denied')),
    }

    const files = await collectFiles([broken, fileEntry('a.jpg')])

    // One unreadable file must not cost the other 199.
    expect(files.map((file) => file.name)).toEqual(['a.jpg'])
  })

  it('ignores an entry the browser could not identify', async () => {
    expect(await collectFiles([null])).toEqual([])
  })
})
