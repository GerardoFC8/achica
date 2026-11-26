import { useId, useState } from 'react'
import {
  MAX_CLIP_FRAMES,
  MAX_CLIP_SECONDS,
  MAX_VIDEO_FPS,
  MIN_VIDEO_FPS,
  type VideoSegment,
} from '../core/animation/video-segment'
import { useCopy } from './copy'
import type { Formatters } from './format'
import {
  readVideoTexts,
  textsOf,
  type VideoField,
  type VideoProblem,
  type VideoReading,
  type VideoTexts,
} from './video-choice'

/**
 * The Discord panel's section for cutting a video: where it starts, how long
 * it lasts and how many frames per second to take.
 *
 * Each field keeps what was typed and the segment above it keeps what is
 * valid. A number that is not one never reaches the plan (the field keeps the
 * last good value and says why); a number outside the tool's bounds is cut to
 * them and the field says so. Leaving a field writes the value in force back
 * into it, so what is shown is always what will be used.
 */

type Props = {
  readonly video: VideoSegment
  readonly formatters: Formatters
  readonly onChange: (video: VideoSegment) => void
}

const FIELDS: readonly {
  readonly field: VideoField
  readonly label: 'start' | 'length' | 'fps'
}[] = [
  { field: 'startSeconds', label: 'start' },
  { field: 'lengthSeconds', label: 'length' },
  { field: 'fps', label: 'fps' },
]

const PROBLEM_WORDS: Readonly<Record<VideoProblem, 'empty' | 'notNumber' | 'negative'>> = {
  empty: 'empty',
  'not-a-number': 'notNumber',
  negative: 'negative',
}

export function VideoFields({ video, formatters, onChange }: Props) {
  const { video: words, lang } = useCopy()
  const comma = lang === 'es'
  const base = useId()
  const [texts, setTexts] = useState<VideoTexts>(() => textsOf(video, comma))
  const [reading, setReading] = useState<VideoReading | null>(null)

  const type = (field: VideoField, text: string): void => {
    const next = { ...texts, [field]: text }
    setTexts(next)
    const result = readVideoTexts(next, video)
    setReading(result)
    onChange(result.segment)
  }

  const settle = (): void => {
    setTexts(textsOf(video, comma))
    setReading(null)
  }

  const unit = (field: VideoField, value: number): string =>
    field === 'fps' ? `${formatters.count(value)} fps` : `${formatters.seconds(value)} s`

  return (
    <fieldset className="grid gap-2 border-t border-rule px-3 pt-2 pb-3">
      <legend className="sr-only">{words.title}</legend>
      <div
        aria-hidden="true"
        className="text-[11px] leading-4 tracking-wider text-ink-soft uppercase"
      >
        {words.title}
      </div>
      <p className="text-xs leading-4 text-pretty text-ink-soft">{words.onlyVideos}</p>

      <div className="grid grid-cols-3 gap-2">
        {FIELDS.map(({ field, label }) => {
          const problem = reading?.problems[field]
          const adjusted = reading?.adjusted.includes(field) === true
          const noteId = `${base}-${field}`
          return (
            <div key={field} className="grid content-start gap-1">
              <label htmlFor={`${base}-in-${field}`} className="text-xs leading-4 text-ink-soft">
                {words[label]}
              </label>
              <input
                id={`${base}-in-${field}`}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={texts[field]}
                onChange={(event) => type(field, event.target.value)}
                onBlur={settle}
                aria-invalid={problem !== undefined}
                aria-describedby={problem !== undefined || adjusted ? noteId : undefined}
                className="tnum h-7 w-full min-w-0 rounded-sm border border-rule bg-paper px-2 text-right text-[11px] coarse:h-11"
              />
            </div>
          )
        })}
      </div>

      {/* The problems sit under the row, one sentence per field, so the three
          inputs keep their columns. A sentence is text, so colour is not the
          only thing that says something went wrong. */}
      <div role="status" className="grid gap-0.5 empty:hidden">
        {FIELDS.map(({ field, label }) => {
          const problem = reading?.problems[field]
          const adjusted = reading?.adjusted.includes(field) === true
          const text =
            problem !== undefined
              ? words.problems[PROBLEM_WORDS[problem]]
              : adjusted
                ? words.adjusted(unit(field, video[field]))
                : null
          return text === null ? null : (
            <p
              key={field}
              id={`${base}-${field}`}
              className={`text-xs leading-4 text-pretty ${problem !== undefined ? 'text-over' : 'text-ink-soft'}`}
            >
              {words[label]}: {text}
            </p>
          )
        })}
      </div>

      <p className="text-xs leading-4 text-pretty text-ink-soft">
        {words.capNote(formatters.count(MAX_CLIP_SECONDS), formatters.count(MAX_CLIP_FRAMES))}{' '}
        <span className="tnum">
          {MIN_VIDEO_FPS}–{MAX_VIDEO_FPS} fps
        </span>
      </p>
    </fieldset>
  )
}
