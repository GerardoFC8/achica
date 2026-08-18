import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
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
  /** Read off the original once it loads; the queue never stored it. */
  const [source, setSource] = useState<{ width: number; height: number } | null>(null)
  const dialog = useRef<HTMLDivElement>(null)
  /** The box the images fill: the curtain is a percentage of this, not of the
   *  scrolling area around it, which is what the drag has to measure against. */
  const frame = useRef<HTMLDivElement>(null)
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

  const clamp = (value: number): number => Math.max(0, Math.min(100, value))

  const splitAt = (clientX: number): void => {
    const box = frame.current?.getBoundingClientRect()
    if (box === undefined || box.width === 0) return
    setSplit(clamp(((clientX - box.left) / box.width) * 100))
  }

  const nudge = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const step = event.shiftKey ? 10 : 1

    if (event.key === 'ArrowLeft') setSplit((value) => clamp(value - step))
    else if (event.key === 'ArrowRight') setSplit((value) => clamp(value + step))
    else if (event.key === 'Home') setSplit(0)
    else if (event.key === 'End') setSplit(100)
    else return

    event.preventDefault()
  }

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
        {/*
          Not a drag target. A click anywhere used to teleport the curtain,
          which reads as a glitch rather than a control — and it also stole
          the scroll from the 1:1 view on a touch screen.
        */}
        <div className="relative flex-1 overflow-auto border border-rule bg-raised">
          {urls === null ? null : (
            /*
             * One box, and both images fill it. That is the whole fix: before
             * this the original sat in the layout at its own size while the
             * result was positioned at another, so the curtain crossed two
             * pictures at different scales and compared nothing.
             *
             * The clip and the curtain line are both percentages of this same
             * box, which is what keeps them on top of each other.
             */
            <div
              ref={frame}
              className={actualSize ? 'relative' : 'absolute inset-0'}
              style={
                actualSize
                  ? { width: `${outcome.width}px`, height: `${outcome.height}px` }
                  : undefined
              }
            >
              <img
                src={urls.before}
                alt={`${item.name}, original`}
                onLoad={(event) =>
                  setSource({
                    width: event.currentTarget.naturalWidth,
                    height: event.currentTarget.naturalHeight,
                  })
                }
                className="absolute inset-0 size-full object-contain"
              />
              <img
                src={urls.after}
                alt={`${item.name}, comprimida`}
                style={{ clipPath: `inset(0 0 0 ${split}%)` }}
                className="absolute inset-0 size-full object-contain"
              />
              {/*
                The curtain is a control, so it looks like one and behaves like
                one: it is grabbed, not aimed at, and the arrow keys move it for
                anyone not using a pointer.
              */}
              <div
                role="slider"
                tabIndex={0}
                aria-label="Cortina de comparación"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(split)}
                aria-valuetext={`${Math.round(split)} % del ancho`}
                onKeyDown={nudge}
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture(event.pointerId)
                  dragging.current = true
                }}
                onPointerMove={(event) => {
                  if (dragging.current) splitAt(event.clientX)
                }}
                onPointerUp={(event) => {
                  dragging.current = false
                  event.currentTarget.releasePointerCapture(event.pointerId)
                }}
                className="absolute inset-y-0 w-6 -translate-x-1/2 cursor-ew-resize touch-none coarse:w-11"
                style={{ left: `${split}%` }}
              >
                <div className="pointer-events-none absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-ink" />
                <div className="pointer-events-none absolute top-1/2 left-1/2 grid size-7 -translate-x-1/2 -translate-y-1/2 place-content-center rounded-sm bg-ink text-[11px] text-paper">
                  ‹›
                </div>
              </div>
            </div>
          )}

          <p className="tnum pointer-events-none absolute top-3 left-3 bg-ink px-2 py-0.5 text-[11px] text-paper">
            antes · {formatters.bytes(item.bytesBefore)}
            {source === null ? '' : ` · ${formatters.dimensions(source.width, source.height)}`}
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
        Arrastra la cortina para cruzar el antes y el después, o muévela con las flechas. Los
        artefactos de compresión solo se ven a 1:1.
      </p>
    </div>
  )
}
