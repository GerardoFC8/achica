import { useEffect, useId, useRef, useState, type RefObject } from 'react'

/**
 * The opening and closing of a toolbar picker, shared by all three.
 *
 * A picker is a button that opens a panel; the panel closes on Escape and on a
 * press outside it. That behaviour is the same for the destination, the resize
 * and the format pickers, and three copies of it would drift the first time one
 * of them learned something (focus handling, say).
 */

export type Picker = {
  readonly open: boolean
  readonly setOpen: (open: boolean) => void
  readonly toggle: () => void
  /** For `aria-controls` on the button and `id` on the panel. */
  readonly panelId: string
  /** Goes on the element that wraps the button and the panel. */
  readonly container: RefObject<HTMLDivElement | null>
}

export function usePicker(): Picker {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const container = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    const onPointer = (event: PointerEvent): void => {
      if (!container.current?.contains(event.target as Node)) setOpen(false)
    }

    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer)
    }
  }, [open])

  return { open, setOpen, toggle: () => setOpen((value) => !value), panelId, container }
}

/** The button that opens a picker: the same box in all three. */
export const PICKER_BUTTON =
  'flex h-8 items-center gap-2 rounded-sm border border-rule px-2.5 text-[13px] leading-4 hover:border-ink-soft coarse:h-11'

/**
 * Pinned to the screen's edges on a phone, where a panel hung from the button
 * would run off the right side.
 */
export const PICKER_PANEL =
  'fixed inset-x-4 top-14 z-40 max-h-[calc(100dvh-4.5rem)] overflow-y-auto border sm:absolute sm:inset-x-auto sm:top-9 sm:left-0 sm:max-h-[calc(100dvh-4rem)] sm:w-80 border-rule bg-paper shadow-[0_8px_24px_rgba(22,24,26,0.12)]'

/** A small choice button: a filled box when active, an outline otherwise. */
export const chip = (active: boolean, numeric: boolean): string =>
  `${numeric ? 'tnum text-[11px]' : 'text-xs'} h-7 rounded-sm border px-2 leading-4 coarse:h-11 ${
    active ? 'border-ink bg-ink text-paper' : 'border-rule hover:border-ink-soft'
  }`
