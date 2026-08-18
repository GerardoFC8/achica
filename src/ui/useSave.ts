import { useCallback, useEffect, useRef, useState } from 'react'
import { saveAsZip, saveOne, saveToFolder, supportsFolderPicker } from '../output/save'
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
  readonly toFolder: boolean
  saveAll(items: readonly QueueItem[]): Promise<void>
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

  const saveAll = useCallback(
    async (items: readonly QueueItem[]) => {
      const files = saveList(items)
      if (files.length === 0) return

      const folder = supportsFolderPicker()
      const outcome = folder ? await saveToFolder(files) : await saveAsZip(files, ARCHIVE_NAME)

      // Closing the picker is a decision, and a message about it would be the
      // app talking back to a user who just said no.
      if (outcome.status === 'cancelled') return

      if (outcome.status === 'failed') {
        announce(`No se pudo guardar: ${outcome.detail}`)
        return
      }

      const count = `${formatters.count(outcome.files)} ${outcome.files === 1 ? 'imagen' : 'imágenes'}`
      announce(
        folder
          ? `${count} en la carpeta que elegiste · ${formatters.bytes(outcome.bytes)}`
          : `ZIP con ${count} · ${formatters.bytes(outcome.bytes)}`,
      )
    },
    [announce, formatters],
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

  return { flash, toFolder: supportsFolderPicker(), saveAll, saveRow }
}
