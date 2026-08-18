import { useCallback, useEffect, useRef, useState } from 'react'
import {
  saveAsZip,
  saveOne,
  saveToFolder,
  supportsFolderPicker,
  type SaveOutcome,
} from '../output/save'
import type { QueueItem } from '../state/queue'
import type { Formatters } from './format'
import { saveList } from './save-list'

/**
 * Saving, and what to say about it afterwards.
 *
 * Which road is taken is decided at the moment of saving, not at load: the
 * folder picker exists in Chromium and nowhere else, and a capability cached
 * at startup is how a page ends up wrong about itself.
 */

const ARCHIVE_NAME = 'achica.zip'
const FLASH_MS = 3_200

export type Save = {
  readonly flash: string
  /** Whether this browser can offer the folder road at all. */
  readonly canUseFolder: boolean
  /** The default: straight to the download folder, no dialog. */
  download(items: readonly QueueItem[]): Promise<void>
  /** The other road, and only where the browser has it. */
  toFolder(items: readonly QueueItem[]): Promise<void>
  saveRow(item: QueueItem): void
}

export function useSave(formatters: Formatters): Save {
  const [flash, setFlash] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current)
    },
    [],
  )

  const announce = useCallback((message: string) => {
    setFlash(message)
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = setTimeout(() => setFlash(''), FLASH_MS)
  }, [])

  const report = useCallback(
    (outcome: SaveOutcome, said: (files: string, bytes: string) => string) => {
      // Closing a picker is a decision, and a message about it would be the
      // app answering back to a user who just said no.
      if (outcome.status === 'cancelled') return

      if (outcome.status === 'failed') {
        announce(`No se pudo guardar: ${outcome.detail}`)
        return
      }

      announce(
        said(
          `${formatters.count(outcome.files)} ${outcome.files === 1 ? 'imagen' : 'imágenes'}`,
          formatters.bytes(outcome.bytes),
        ),
      )
    },
    [announce, formatters],
  )

  const download = useCallback(
    async (items: readonly QueueItem[]) => {
      const files = saveList(items)
      const [only] = files
      if (only === undefined) return

      /*
       * One image is handed over as one image. An archive holding a single
       * file is a chore for the person on the other side, and the button says
       * which of the two is about to happen either way.
       */
      if (files.length === 1) {
        report(saveOne(only), (count) => `${count} descargada`)
        return
      }

      report(await saveAsZip(files, ARCHIVE_NAME), (count, bytes) => `ZIP con ${count} · ${bytes}`)
    },
    [report],
  )

  const toFolder = useCallback(
    async (items: readonly QueueItem[]) => {
      const files = saveList(items)
      if (files.length === 0) return

      report(
        await saveToFolder(files),
        (count, bytes) => `${count} en la carpeta que elegiste · ${bytes}`,
      )
    },
    [report],
  )

  const saveRow = useCallback(
    (item: QueueItem) => {
      const [file] = saveList([item])
      if (file === undefined) return

      const outcome = saveOne(file)
      announce(
        outcome.status === 'saved'
          ? `${file.name} descargada`
          : `No se pudo guardar: ${outcome.status === 'failed' ? outcome.detail : ''}`,
      )
    },
    [announce],
  )

  return { flash, canUseFolder: supportsFolderPicker(), download, toFolder, saveRow }
}
