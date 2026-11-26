import { readExif, type ExifInfo } from './exif'
import { REMOVED_KIND_ORDER, type RemovedKind, type RemovedMetadata } from './types'

/**
 * Keeps the books of what a walker threw away.
 *
 * The report is built here, from the calls the walker makes at the moment it
 * drops something, so "removed" can only ever describe bytes that really left
 * the file.
 */
export type Ledger = {
  /** Records a removed span. `bytes` is its size in the input. */
  drop(kind: RemovedKind, bytes: number): void
  /** Records a removed span that sat after the end-of-image marker. */
  dropTrailing(bytes: number): void
  /** Looks inside a removed EXIF block, for the report and for the orientation. */
  noteExif(tiff: Uint8Array): void
  /** The orientation worth writing back: 2 to 8, or null. */
  orientationToWrite(): number | null
  finish(): RemovedMetadata
}

export function createLedger(): Ledger {
  const kinds = new Set<RemovedKind>()
  let bytesRemoved = 0
  let trailingBytes = 0
  let exifSeen = false
  let exifRead = false
  let orientation: number | null = null
  let hadGps = false
  let hadCameraInfo = false

  const absorb = (info: ExifInfo): void => {
    exifRead = true
    if (orientation === null) orientation = info.orientation
    hadGps ||= info.hadGps
    hadCameraInfo ||= info.hadCameraInfo
    if (info.hasThumbnail) kinds.add('thumbnail')
  }

  // Orientation 1 is "as stored", so writing it would add a block for nothing.
  const toWrite = (): number | null =>
    orientation !== null && orientation > 1 ? orientation : null

  return {
    drop(kind, bytes) {
      kinds.add(kind)
      bytesRemoved += bytes
      if (kind === 'exif') exifSeen = true
    },
    dropTrailing(bytes) {
      kinds.add('trailing-data')
      bytesRemoved += bytes
      trailingBytes += bytes
    },
    noteExif(tiff) {
      const info = readExif(tiff)
      if (info.readable) absorb(info)
    },
    orientationToWrite: toWrite,
    finish() {
      return {
        kinds: REMOVED_KIND_ORDER.filter((kind) => kinds.has(kind)),
        bytesRemoved,
        trailingBytes,
        orientation: toWrite(),
        exifUnreadable: exifSeen && !exifRead,
        hadGps,
        hadCameraInfo,
      }
    },
  }
}
