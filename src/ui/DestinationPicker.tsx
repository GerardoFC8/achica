import { useId, useState } from 'react'
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
import { useCopy, type Copy } from './copy'
import type { Formatters } from './format'
import { chip, PICKER_BUTTON, PICKER_PANEL, usePicker } from './usePicker'

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

const PNG_CHOICES: readonly {
  readonly value: PngUnderBudget
  readonly label: 'pngToWebp' | 'pngKeep'
}[] = [
  { value: 'webp', label: 'pngToWebp' },
  { value: 'keep', label: 'pngKeep' },
]

/**
 * The one line of numbers a destination is scanned by.
 *
 * The format appears only when the profile changes it, because that is the
 * surprising part — the other three hand back what they were given, and saying
 * so on every row would be noise. A weight ceiling wins the line when a profile
 * sets one, since it is the harder promise.
 */
function summaryOf(profile: Profile, formatters: Formatters, copy: Copy): string {
  const words = copy.destination
  if (profile.maxBytes !== undefined) return words.ceiling(formatters.bytes(profile.maxBytes))

  const bound = profile.maxWidth ?? profile.maxHeight
  const size = bound === undefined ? words.originalSize : `${bound} px`

  return profile.format === 'keep' ? size : `WebP · ${size}`
}

export function DestinationPicker({ selected, budget, formatters, onSelect, onBudget }: Props) {
  const copy = useCopy()
  const words = copy.destination
  const { open, setOpen, toggle, panelId, container } = usePicker()
  const [typed, setTyped] = useState('')
  const [invalid, setInvalid] = useState(false)
  const customId = useId()

  return (
    <div className="relative" ref={container}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={panelId}
        className={PICKER_BUTTON}
      >
        <span className="text-ink-soft">{copy.toolbar.destination}</span>
        <span className="font-medium">{words.profile(selected).label}</span>
        <span className="tnum text-[11px] text-ink-soft">
          {summaryOf(withBudget(selected, budget), formatters, copy)}
        </span>
      </button>

      {/*
        Pinned to the screen's edges on a phone, where a panel hung from the
        button would run off the right side.
      */}
      {open ? (
        <div id={panelId} className={PICKER_PANEL}>
          {[...profilesByGroup(PERFILES)].map(([group, members]) => (
            <div key={group} className="border-b border-rule last:border-b-0">
              <div className="px-3 pt-2 pb-1 text-[11px] leading-4 tracking-wider text-ink-soft uppercase">
                {words.group(group)}
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
                    <span className="text-[13px] leading-4 font-medium">
                      {words.profile(profile).label}
                    </span>
                    <span className="tnum text-[11px] text-ink-soft">
                      {summaryOf(profile, formatters, copy)}
                    </span>
                  </span>
                  <span className="text-xs leading-4 text-pretty text-ink-soft">
                    {words.ourAdvice}
                    {words.profile(profile).note === undefined
                      ? ''
                      : `. ${words.profile(profile).note}`}
                  </span>
                </button>
              ))}
            </div>
          ))}

          <div className="grid gap-2 border-t border-rule px-3 pt-2 pb-3">
            <div className="text-[11px] leading-4 tracking-wider text-ink-soft uppercase">
              {words.budgetTitle}
            </div>

            <div className="flex flex-wrap gap-1">
              <button
                type="button"
                aria-pressed={budget.maxBytes === null}
                onClick={() => onBudget({ ...budget, maxBytes: null })}
                className={chip(budget.maxBytes === null, false)}
              >
                {words.noBudget}
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
                {words.otherBudget}
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
                {words.useBudget}
              </button>
            </form>
            {invalid ? (
              <p role="alert" className="text-xs leading-4 text-over">
                {words.invalidBudget(
                  formatters.count(MIN_KILOBYTES),
                  formatters.count(MAX_KILOBYTES),
                )}
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
                  {words.pngQuestion}
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
                    {words[choice.label]}
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
