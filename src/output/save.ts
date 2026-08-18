import { downloadZip } from 'client-zip'

/**
 * Getting the results out, by the two roads the platform offers.
 *
 * Writing straight into a folder is the better experience and only Chromium
 * has it. Everywhere else the answer is a ZIP, which is why the fallback is
 * not a consolation prize: for Firefox and Safari it is the only road.
 *
 * Both take the same list of named blobs, so the naming rules in names.ts
 * decide once for both and they cannot disagree.
 */

export type SaveFile = {
  readonly name: string
  readonly blob: Blob
}

export type SaveOutcome =
  | { readonly status: 'saved'; readonly files: number; readonly bytes: number }
  /** The user closed the picker. Not an error, and not worth an error message. */
  | { readonly status: 'cancelled' }
  | { readonly status: 'failed'; readonly detail: string }

/**
 * Chromium has the File System Access API; Firefox and Safari do not, and
 * neither does any browser inside a cross-origin frame. Asked at the moment of
 * saving rather than cached at load, because the answer is cheap and a cached
 * capability is how a page ends up wrong after being embedded.
 */
export function supportsFolderPicker(): boolean {
  return typeof (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function'
}

export type DirectoryPicker = () => Promise<FileSystemDirectoryHandle>

const openFolder: DirectoryPicker = () =>
  (globalThis as unknown as { showDirectoryPicker: DirectoryPicker }).showDirectoryPicker()

/** A user closing a picker throws AbortError, which is a decision, not a fault. */
const isAbort = (cause: unknown): boolean =>
  cause instanceof DOMException && cause.name === 'AbortError'

const describe = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause)

export async function saveToFolder(
  files: readonly SaveFile[],
  pick: DirectoryPicker = openFolder,
): Promise<SaveOutcome> {
  let directory: FileSystemDirectoryHandle

  try {
    directory = await pick()
  } catch (cause) {
    return isAbort(cause) ? { status: 'cancelled' } : { status: 'failed', detail: describe(cause) }
  }

  let bytes = 0

  try {
    for (const file of files) {
      const handle = await directory.getFileHandle(file.name, { create: true })
      const writable = await handle.createWritable()

      /*
       * The blob goes to the stream whole rather than through an ArrayBuffer.
       * Reading it into memory first would undo the reason results are kept as
       * blobs at all, and a batch is exactly when that matters.
       */
      await writable.write(file.blob)
      await writable.close()
      bytes += file.blob.size
    }
  } catch (cause) {
    // Permission can be revoked mid-write, and a disk can fill up. Whatever
    // was already written stays written; the count says how far it got.
    return { status: 'failed', detail: describe(cause) }
  }

  return { status: 'saved', files: files.length, bytes }
}

/**
 * The archive, built as a stream and collected into a Blob.
 *
 * client-zip streams so the whole archive never exists in one buffer, but a
 * browser without the folder API also has no way to stream to disk — the only
 * way to hand a file over is a Blob and a download link. A Blob is at least a
 * handle the browser may keep on disk, which is the same reason results are
 * held as blobs in the first place.
 */
export async function buildZip(files: readonly SaveFile[]): Promise<Blob> {
  return downloadZip(files.map((file) => ({ name: file.name, input: file.blob }))).blob()
}

export type Downloader = (blob: Blob, name: string) => void

const download: Downloader = (blob, name) => {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')

  link.href = url
  link.download = name
  link.click()

  // Revoked on the next turn, not immediately: the click starts the download
  // asynchronously and a revoked URL cancels it.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** One file needs no archive: a ZIP holding a single image is a chore. */
export function saveOne(file: SaveFile, send: Downloader = download): SaveOutcome {
  try {
    send(file.blob, file.name)
    return { status: 'saved', files: 1, bytes: file.blob.size }
  } catch (cause) {
    return { status: 'failed', detail: describe(cause) }
  }
}

export async function saveAsZip(
  files: readonly SaveFile[],
  archiveName: string,
  send: Downloader = download,
): Promise<SaveOutcome> {
  try {
    const blob = await buildZip(files)
    send(blob, archiveName)
    return { status: 'saved', files: files.length, bytes: blob.size }
  } catch (cause) {
    return { status: 'failed', detail: describe(cause) }
  }
}
