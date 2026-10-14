import { useEffect, useId, useRef, useState } from 'react'
import { PERFILES, profilesByGroup, type Profile } from '../core/profiles'
import {
  BUDGET_PRESETS,
  MAX_KILOBYTES,
  MIN_KILOBYTES,
  parseKilobytes,
  withBudget,
  type BudgetChoice,
  type PngUnderBudget,
} from './budget'
import type { Formatters } from './format'

/**
 * The product's differentiator, as a control.
 *
 * It is called "Destino" and not "Perfil" or "Calidad" because that is the
 * whole idea: the user says where the image is going and the app works out the
 * format, the bound and the quality.
 *
 * The groups come from the catalogue rather than from a list written here. An
 * earlier version hardcoded them so that "Trámites" could be listed while
 * empty; with that group gone (D48) a hardcoded list could only drift from the
 * data it describes.
 *
 * The weight ceiling lives in the same panel, under the destinations (D53). It
 * is the same decision seen from the other end, "where is this going" and "how
 * much may it weigh", and a second control in the toolbar would not fit on a
 * phone, where the toolbar already runs out of room.
 */

type Props = {
  readonly selected: Profile
  readonly budget: BudgetChoice
  readonly formatters: Formatters
  readonly onSelect: (profile: Profile) => void
  readonly onBudget: (budget: BudgetChoice) => void
}

const PNG_CHOICES: readonly { readonly value: PngUnderBudget; readonly label: string }[] = [
  { value: 'webp', label: 'Pasarlo a WebP, que conserva la transparencia' },
  { value: 'keep', label: 'Dejarlo en PNG y achicar sus dimensiones' },
]

/**
 * The one line of numbers a destination is scanned by.
 *
 * The format appears only when the profile changes it, because that is the
 * surprising part — the other three hand back what they were given, and saying
 * so on every row would be noise. A weight ceiling wins the line when a profile
 * sets one, since it is the harder promise.
 */
function summaryOf(profile: Profile, formatters: Formatters): string {
  if (profile.maxBytes !== undefined) return `máx. ${formatters.bytes(profile.maxBytes)}`

  const bound = profile.maxWidth ?? profile.maxHeight
  const size = bound === undefined ? 'tamaño original' : `${bound} px`

  return profile.format === 'keep' ? size : `WebP · ${size}`
}

export function DestinationPicker({ selected, budget, formatters, onSelect, onBudget }: Props) {
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [invalid, setInvalid] = useState(false)
  const panelId = useId()
  const customId = useId()
  const container = useRef<HTMLDivElement>(null)

  // Numbers in the mono face, words in the interface one, as everywhere else.
  const chip = (active: boolean, numeric: boolean): string =>
    `${numeric ? 'tnum text-[11px]' : 'text-xs'} h-7 rounded-sm border px-2 leading-4 coarse:h-11 ${
      active ? 'border-ink bg-ink text-paper' : 'border-rule hover:border-ink-soft'
    }`

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

  return (
    <div className="relative" ref={container}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex h-8 items-center gap-2 rounded-sm border border-rule px-2.5 text-[13px] leading-4 hover:border-ink-soft coarse:h-11"
      >
        <span className="text-ink-soft">Destino</span>
        <span className="font-medium">{selected.label}</span>
        <span className="tnum text-[11px] text-ink-soft">
          {summaryOf(withBudget(selected, budget), formatters)}
        </span>
      </button>

      {/*
        Pinned to the screen's edges on a phone, where a panel hung from the
        button would run off the right side.
      */}
      {open ? (
        <div
          id={panelId}
          className="fixed inset-x-4 top-14 z-40 max-h-[calc(100dvh-4.5rem)] overflow-y-auto border sm:absolute sm:inset-x-auto sm:top-9 sm:left-0 sm:max-h-[calc(100dvh-4rem)] sm:w-80 border-rule bg-paper shadow-[0_8px_24px_rgba(22,24,26,0.12)]"
        >
          {[...profilesByGroup(PERFILES)].map(([group, members]) => (
            <div key={group} className="border-b border-rule last:border-b-0">
              <div className="px-3 pt-2 pb-1 text-[11px] leading-4 tracking-wider text-ink-soft uppercase">
                {group}
              </div>

              {members.map((profile) => (
                <button
                  key={profile.id}
                  type="button"
                  onClick={() => {
                    onSelect(profile)
                    setOpen(false)
                  }}
                  aria-current={profile.id === selected.id}
                  className={`grid w-full gap-0.5 px-3 py-2 text-left hover:bg-raised ${
                    profile.id === selected.id ? 'bg-raised' : ''
                  }`}
                >
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="text-[13px] leading-4 font-medium">{profile.label}</span>
                    <span className="tnum text-[11px] text-ink-soft">
                      {summaryOf(profile, formatters)}
                    </span>
                  </span>
                  <span className="text-xs leading-4 text-pretty text-ink-soft">
                    Recomendación nuestra
                    {profile.note === undefined ? '' : `. ${profile.note}`}
                  </span>
                </button>
              ))}
            </div>
          ))}

          <div className="grid gap-2 border-t border-rule px-3 pt-2 pb-3">
            <div className="text-[11px] leading-4 tracking-wider text-ink-soft uppercase">
              Tope por archivo
            </div>

            <div className="flex flex-wrap gap-1">
              <button
                type="button"
                aria-pressed={budget.maxBytes === null}
                onClick={() => onBudget({ ...budget, maxBytes: null })}
                className={chip(budget.maxBytes === null, false)}
              >
                Sin tope
              </button>
              {BUDGET_PRESETS.map((bytes) => (
                <button
                  key={bytes}
                  type="button"
                  aria-pressed={budget.maxBytes === bytes}
                  onClick={() => onBudget({ ...budget, maxBytes: bytes })}
                  className={chip(budget.maxBytes === bytes, true)}
                >
                  {formatters.bytes(bytes)}
                </button>
              ))}
            </div>

            <form
              className="flex items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault()
                const bytes = parseKilobytes(typed)
                setInvalid(bytes === null)
                if (bytes !== null) {
                  onBudget({ ...budget, maxBytes: bytes })
                  setTyped('')
                }
              }}
            >
              <label htmlFor={customId} className="text-xs leading-4 text-ink-soft">
                Otro
              </label>
              <input
                id={customId}
                type="text"
                inputMode="decimal"
                value={typed}
                onChange={(event) => {
                  setTyped(event.target.value)
                  setInvalid(false)
                }}
                aria-invalid={invalid}
                className="tnum h-7 w-20 rounded-sm border border-rule bg-paper px-2 text-right text-[11px] coarse:h-11"
              />
              <span className="tnum text-[11px] text-ink-soft">KB</span>
              <button
                type="submit"
                className="h-7 rounded-sm border border-rule px-2 text-xs leading-4 hover:border-ink-soft coarse:h-11"
              >
                Usar
              </button>
            </form>
            {invalid ? (
              <p role="alert" className="text-xs leading-4 text-over">
                Escribe un número de KB entre {MIN_KILOBYTES} y {formatters.count(MAX_KILOBYTES)}.
              </p>
            ) : null}

            {/*
              Only where the choice can matter: with a ceiling, under a
              destination that keeps the format. The web destination turns
              every PNG into WebP anyway.
            */}
            {budget.maxBytes !== null && selected.format === 'keep' ? (
              <fieldset className="grid gap-1">
                <legend className="pb-1 text-xs leading-4 text-ink-soft">
                  Si un PNG no entra en el tope
                </legend>
                {PNG_CHOICES.map((choice) => (
                  <label key={choice.value} className="flex items-start gap-2 text-xs leading-4">
                    <input
                      type="radio"
                      name={`${panelId}-png`}
                      checked={budget.png === choice.value}
                      onChange={() => onBudget({ ...budget, png: choice.value })}
                      className="mt-0.5 accent-ink"
                    />
                    {choice.label}
                  </label>
                ))}
              </fieldset>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
