import { useId, useState } from 'react'
import type { VideoSegment } from '../core/animation/video-segment'
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
import { CanvasChoice, RequirementLine } from './DiscordNotes'
import { isSticker } from './tool-profiles'
import { VideoFields } from './VideoFields'
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
  /** The destinations on offer, the default first. The catalogue when omitted. */
  readonly profiles?: readonly Profile[]
  /** The weight ceiling belongs to the compressor alone (D53). */
  readonly showBudget?: boolean
  /** Discord: the sticker's last-resort canvas. Offered only when a handler is given. */
  readonly canvasReduction?: boolean
  readonly onCanvasReduction?: (allowed: boolean) => void
  /** Discord: which part of a video is used. Offered only when a handler is given. */
  readonly video?: VideoSegment
  readonly onVideo?: (video: VideoSegment) => void
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

/**
 * A Discord option's numbers: its canvas or its longest side, then the weight,
 * since the option's name says only "Sticker GIF" or "Emoji GIF". The toolbar
 * button keeps the bare weight, where the long label already says the rest.
 */
function optionSummaryOf(profile: Profile, formatters: Formatters, copy: Copy): string {
  const summary = summaryOf(profile, formatters, copy)
  const layout = profile.animation?.layout
  if (layout === undefined) return summary
  const words = copy.destination
  const size =
    layout.kind === 'sticker' ? words.canvasSize(layout.size) : words.upToSide(layout.maxSide)
  return `${size} · ${summary}`
}

export function DestinationPicker({
  selected,
  budget,
  formatters,
  onSelect,
  onBudget,
  profiles = PERFILES,
  showBudget = true,
  canvasReduction = false,
  onCanvasReduction,
  video,
  onVideo,
}: Props) {
  const copy = useCopy()
  const words = copy.destination
  const { open, setOpen, toggle, panelId, container } = usePicker()
  const [typed, setTyped] = useState('')
  const [invalid, setInvalid] = useState(false)
  const customId = useId()
  const summary = summaryOf(showBudget ? withBudget(selected, budget) : selected, formatters, copy)
  const selectedNote = words.profile(selected).note

  return (
    <div className="relative" ref={container}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={panelId}
        title={summary}
        className={PICKER_BUTTON}
      >
        <span className="text-ink-soft">{copy.toolbar.destination}</span>
        <span className="font-medium">{words.profile(selected).label}</span>
        {/*
          A destination with somebody else's limit (Discord) names its limit in the
          panel, in the weight column and in the button's title; on the button
          itself it only fits where the toolbar has room (the folder and
          download buttons need it at 1280 px).
        */}
        <span
          className={`tnum text-[11px] text-ink-soft ${
            selected.requirement === undefined ? '' : 'hidden min-[1400px]:inline'
          }`}
        >
          {summary}
        </span>
      </button>

      {/*
        Pinned to the screen's edges on a phone, where a panel hung from the
        button would run off the right side.
      */}
      {open ? (
        <div id={panelId} className={PICKER_PANEL}>
          {[...profilesByGroup(profiles)].map(([group, members]) => (
            <div key={group} className="border-b border-rule last:border-b-0">
              <div className="px-3 pt-2 pb-1 text-[11px] leading-4 tracking-wider text-ink-soft uppercase">
                {words.group(group)}
              </div>

              {members.map((profile) => {
                // A destination with somebody else's limit (Discord) is one
                // line, its short name and its numbers. What it means, and
                // where the limit comes from, is said once under the list,
                // for the selected one.
                const theirs = profile.requirement !== undefined
                const { label, note } = words.profile(profile)
                return (
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
                        {theirs ? words.shortLabel(profile) : label}
                      </span>
                      <span className="tnum text-[11px] text-ink-soft">
                        {optionSummaryOf(profile, formatters, copy)}
                      </span>
                    </span>
                    {theirs ? null : (
                      <span className="text-xs leading-4 text-pretty text-ink-soft">
                        {words.ourAdvice}
                        {note === undefined ? '' : `. ${note}`}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          ))}

          {selected.requirement !== undefined ? (
            <div className="grid gap-1 border-t border-rule pt-2">
              {selectedNote === undefined ? null : (
                <p className="px-3 text-xs leading-4 text-pretty text-ink-soft">
                  {words.detail(words.shortLabel(selected), selectedNote)}
                </p>
              )}
              <p className="px-3 text-xs leading-4 text-pretty text-ink-soft">
                {words.notAGuarantee}
              </p>
              {/* The source is a link, and a link cannot live inside an option's button. */}
              <RequirementLine profile={selected} />
              {onCanvasReduction !== undefined && isSticker(selected) ? (
                <CanvasChoice checked={canvasReduction} onChange={onCanvasReduction} />
              ) : null}
            </div>
          ) : null}

          {video !== undefined && onVideo !== undefined ? (
            <VideoFields video={video} formatters={formatters} onChange={onVideo} />
          ) : null}

          {showBudget ? (
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
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
