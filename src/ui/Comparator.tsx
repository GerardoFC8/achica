import { useEffect, useRef, useState } from 'react'
import type { Profile } from '../core/profiles'
import type { QueueItem } from '../state/queue'
import type { Formatters } from './format'
import { rowKind } from './row-model'
import { TEXT_TONE } from './tone'

/**
 * Before and after, one file at a time.
 *
 * One at a time is not a simplification, it is the memory rule: showing a
 * preview means the browser decodes the image again, and a thumbnail on every
 * row would be two hundred live decodes — the exact thing phase 2 was spent
 * avoiding. Both object URLs are revoked when this closes.
 *
 * A curtain rather than two pictures side by side, because compression damage
 * is a difference between two pixels in the same place, and eyes cannot hold
 * that across a gap. And a 1:1 view, because at any other zoom the browser's
 * own resampling hides exactly what is being judged.
 */

type Props = {
  readonly item: Extract<QueueItem, { status: 'done' }>
  readonly profile: Profile
  readonly formatters: Formatters
  readonly onClose: () => void
}

export function Comparator({ item, profile, formatters, onClose }: Props) {
  const [split, setSplit] = useState(50)
  const [actualSize, setActualSize] = useState(false)
  const [urls, setUrls] = useState<{ before: string; after: string } | null>(null)
  const surface = useRef<HTMLDivElement>(null)
  const dialog = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  useEffect(() => {
    const before = URL.createObjectURL(item.file)
    const after = URL.createObjectURL(item.blob)
    setUrls({ before, after })

    return () => {
      // Not housekeeping: an object URL keeps the decoded image alive for as
      // long as the document does.
      URL.revokeObjectURL(before)
      URL.revokeObjectURL(after)
    }
  }, [item])

  useEffect(() => {
    const previous = document.activeElement
    dialog.current?.focus()

    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }

    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      if (previous instanceof HTMLElement) previous.focus()
    }
  }, [onClose])

  useEffect(() => {
    const move = (event: PointerEvent): void => {
      if (!dragging.current) return
      const box = surface.current?.getBoundingClientRect()
      if (box === undefined) return
      setSplit(Math.max(0, Math.min(100, ((event.clientX - box.left) / box.width) * 100)))
    }
    const up = (): void => {
      dragging.current = false
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [])

  const kind = rowKind(item, profile)
  const { outcome } = item

  return (
    <div
      ref={dialog}
      role="dialog"
      aria-modal="true"
      aria-label={`Comparar ${item.name}`}
      tabIndex={-1}
      className="fixed inset-0 z-60 flex flex-col bg-paper"
    >
      <header className="flex h-14 shrink-0 items-center gap-4 border-b border-rule px-4">
        <h2 className="truncate text-[15px] leading-5 font-semibold">{item.name}</h2>
        <div className="flex-1" />

        <div className="flex items-center">
          <button
            type="button"
            onClick={() => setActualSize(false)}
            aria-pressed={!actualSize}
            className={`h-7 rounded-l-sm border border-r-0 border-rule px-2.5 text-[13px] coarse:h-11 ${
              actualSize ? 'text-ink-soft' : 'bg-ink text-paper'
            }`}
          >
            Ajustada
          </button>
          <button
            type="button"
            onClick={() => setActualSize(true)}
            aria-pressed={actualSize}
            className={`tnum h-7 rounded-r-sm border border-rule px-2.5 text-[13px] coarse:h-11 ${
              actualSize ? 'bg-ink text-paper' : 'text-ink-soft'
            }`}
          >
            1:1
          </button>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="h-7 rounded-sm border border-rule px-2.5 text-[13px] hover:border-ink-soft coarse:h-11"
        >
          Cerrar
        </button>
      </header>

      <div className="flex min-h-0 flex-1 p-4">
        <div
          ref={surface}
          onPointerDown={(event) => {
            dragging.current = true
            const box = surface.current?.getBoundingClientRect()
            if (box !== undefined) {
              setSplit(Math.max(0, Math.min(100, ((event.clientX - box.left) / box.width) * 100)))
            }
          }}
          className="relative flex-1 cursor-ew-resize overflow-auto border border-rule bg-raised touch-none"
        >
          {urls === null ? null : (
            <div
              className={`relative ${actualSize ? 'inline-block' : 'grid h-full w-full place-items-center'}`}
            >
              <img
                src={urls.before}
                alt={`${item.name}, original`}
                className={actualSize ? 'block max-w-none' : 'max-h-full max-w-full object-contain'}
              />
              <img
                src={urls.after}
                alt={`${item.name}, comprimida`}
                style={{ clipPath: `inset(0 0 0 ${split}%)` }}
                className={
                  actualSize
                    ? 'absolute inset-0 block max-w-none'
                    : 'absolute inset-0 m-auto max-h-full max-w-full object-contain'
                }
              />
              <div
                className="pointer-events-none absolute inset-y-0 w-0.5 bg-ink"
                style={{ left: `${split}%` }}
              />
            </div>
          )}

          <p className="tnum pointer-events-none absolute top-3 left-3 bg-ink px-2 py-0.5 text-[11px] text-paper">
            antes · {formatters.bytes(item.bytesBefore)}
          </p>
          <p
            className={`tnum pointer-events-none absolute top-3 right-3 bg-paper px-2 py-0.5 text-[11px] ${TEXT_TONE[kind]}`}
          >
            después · {formatters.bytes(outcome.bytesAfter)} ·{' '}
            {formatters.dimensions(outcome.width, outcome.height)} · {outcome.format.toUpperCase()}
          </p>
        </div>
      </div>

      <p className="shrink-0 border-t border-rule px-4 py-2.5 text-xs leading-4 text-pretty text-ink-soft">
        Arrastra la cortina para cruzar el antes y el después. Los artefactos de compresión solo se
        ven a 1:1.
      </p>
    </div>
  )
}
