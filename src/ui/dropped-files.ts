/**
 * Turning a drop into a list of files, folders included.
 *
 * The traversal is written against a narrow shape rather than against
 * `FileSystemEntry` so it can be driven by fakes in Node. The browser edge is
 * one function at the bottom of this file.
 */

export type DroppedEntry =
  | {
      readonly isFile: true
      readonly isDirectory: false
      readonly name: string
      file(resolve: (file: File) => void, reject: (cause: unknown) => void): void
    }
  | {
      readonly isFile: false
      readonly isDirectory: true
      readonly name: string
      createReader(): {
        readEntries(
          resolve: (entries: readonly DroppedEntry[]) => void,
          reject: (cause: unknown) => void,
        ): void
      }
    }
  | null

/** Leftovers from the file system, not files anybody chose to compress. */
const isHidden = (name: string): boolean => name.startsWith('.')

function readFile(entry: Extract<DroppedEntry, { isFile: true }>): Promise<File | null> {
  return new Promise((resolve) => {
    // A file that cannot be read must cost that file and not the other 199,
    // which is the same rule the queue follows for a corrupt image.
    entry.file(resolve, () => resolve(null))
  })
}

/**
 * `readEntries` returns at most a hundred children per call and signals the
 * end with an empty list. Calling it once passes every small test and quietly
 * loses everything past the first hundred in a real folder.
 */
async function readDirectory(
  entry: Extract<DroppedEntry, { isDirectory: true }>,
): Promise<readonly DroppedEntry[]> {
  const reader = entry.createReader()
  const all: DroppedEntry[] = []

  for (;;) {
    const batch = await new Promise<readonly DroppedEntry[]>((resolve) => {
      reader.readEntries(resolve, () => resolve([]))
    })

    if (batch.length === 0) return all
    all.push(...batch)
  }
}

export async function collectFiles(entries: readonly DroppedEntry[]): Promise<File[]> {
  const files: File[] = []

  for (const entry of entries) {
    if (entry === null) continue
    if (isHidden(entry.name)) continue

    if (entry.isFile) {
      const file = await readFile(entry)
      if (file !== null) files.push(file)
      continue
    }

    files.push(...(await collectFiles(await readDirectory(entry))))
  }

  return files
}

/**
 * The browser edge.
 *
 * `webkitGetAsEntry` is the only way to see a dropped folder at all — a
 * DataTransfer's `files` list contains the folder as a zero-byte entry and
 * none of its contents. The name is prefixed and the standard never caught
 * up, but every browser this app targets implements it.
 */
export async function filesFromDrop(transfer: DataTransfer): Promise<File[]> {
  const items = [...transfer.items].filter((item) => item.kind === 'file')
  const entries = items.map((item) => item.webkitGetAsEntry() as DroppedEntry)

  if (entries.some((entry) => entry !== null)) return collectFiles(entries)

  // No entry API available: the flat file list is all there is.
  return [...transfer.files]
}
