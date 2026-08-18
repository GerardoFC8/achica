import { outputName, uniqueNames } from '../output/names'
import type { SaveFile } from '../output/save'
import type { QueueItem } from '../state/queue'

/**
 * The finished rows, ready to be written.
 *
 * Naming happens once here rather than inside each save path, so writing into
 * a folder and streaming a ZIP cannot disagree. Collisions matter more than
 * they look: converting foto.jpg and foto.png both to WebP creates a clash
 * that did not exist until we made it.
 */
export function saveList(items: readonly QueueItem[]): SaveFile[] {
  const finished = items.filter((item) => item.status === 'done')
  const names = uniqueNames(finished.map((item) => outputName(item.name, item.outcome.format)))

  // The blob itself, never a copy: it is a handle the browser may be keeping
  // on disk, and reading it into memory to save it would undo that.
  return finished.map((item, index) => ({ name: names[index] ?? item.name, blob: item.blob }))
}
