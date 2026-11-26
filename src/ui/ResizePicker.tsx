import { useId, useState } from 'react'
import { useCopy } from './copy'
import type { Formatters } from './format'
import {
  BOX_PRESETS,
  MAX_PERCENT,
  MAX_PIXELS,
  MIN_PERCENT,
  MIN_PIXELS,
  PERCENT_PRESETS,
  RESIZE_QUALITY,
  parseBox,
  parsePercent,
  resizeSummary,
  sameResize,
  type ResizeChoice,
} from './resize-choice'
import { chip, PICKER_BUTTON, PICKER_PANEL, usePicker } from './usePicker'

/**
 * The resize tool's one decision, as the same kind of control as the
 * compressor's destination: a button that says what is chosen and opens a
 * panel. Two ways to ask, a percentage or a box; both only ever shrink.
 *
 * Nothing here names a platform or quotes a size as somebody's requirement:
 * the presets are plain numbers, and the project does not ship a requirement
 * it cannot source.
 */

type Props = {
  readonly choice: ResizeChoice
  readonly formatters: Formatters
  readonly onChange: (choice: ResizeChoice) => void
}

const INPUT =
  'tnum h-7 w-16 rounded-sm border border-rule bg-paper px-2 text-right text-[11px] coarse:h-11'
const SUBMIT =
  'h-7 rounded-sm border border-rule px-2 text-xs leading-4 hover:border-ink-soft coarse:h-11'

export function ResizePicker({ choice, formatters, onChange }: Props) {
  const copy = useCopy()
  const words = copy.resize
  const { open, toggle, panelId, container } = usePicker()
  const percentId = useId()
  const widthId = useId()
  const heightId = useId()
  const modeId = useId()

  // The mode being looked at is its own state: opening the box tab does not
  // change what is applied until a size is picked or typed.
  const [mode, setMode] = useState<ResizeChoice['mode']>(choice.mode)
  const [percent, setPercent] = useState('')
  const [width, setWidth] = useState('')
  const [height, setHeight] = useState('')
  const [invalid, setInvalid] = useState(false)

  const apply = (next: ResizeChoice): void => {
    onChange(next)
    setInvalid(false)
  }

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
        <span className="tnum font-medium">{resizeSummary(choice, words)}</span>
      </button>

      {open ? (
        <div id={panelId} className={PICKER_PANEL}>
          <div className="grid gap-2 px-3 pt-2 pb-3">
            <div role="group" aria-labelledby={modeId} className="grid gap-1">
              <div
                id={modeId}
                className="text-[11px] leading-4 tracking-wider text-ink-soft uppercase"
              >
                {words.modeLabel}
              </div>
              <div className="flex gap-1">
                {(['percent', 'box'] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={mode === value}
                    onClick={() => {
                      setMode(value)
                      setInvalid(false)
                    }}
                    className={chip(mode === value, false)}
                  >
                    {value === 'percent' ? words.percent : words.box}
                  </button>
                ))}
              </div>
            </div>

            {mode === 'percent' ? (
              <>
                <div className="flex flex-wrap gap-1">
                  {PERCENT_PRESETS.map((value) => {
                    const next: ResizeChoice = { mode: 'percent', percent: value }
                    return (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={sameResize(choice, next)}
                        onClick={() => apply(next)}
                        className={chip(sameResize(choice, next), true)}
                      >
                        {words.summaryPercent(value)}
                      </button>
                    )
                  })}
                </div>

                <form
                  className="flex items-center gap-2"
                  onSubmit={(event) => {
                    event.preventDefault()
                    const value = parsePercent(percent)
                    setInvalid(value === null)
                    if (value !== null) {
                      apply({ mode: 'percent', percent: value })
                      setPercent('')
                    }
                  }}
                >
                  <label htmlFor={percentId} className="text-xs leading-4 text-ink-soft">
                    {words.otherPercent}
                  </label>
                  <input
                    id={percentId}
                    type="text"
                    inputMode="numeric"
                    value={percent}
                    onChange={(event) => {
                      setPercent(event.target.value)
                      setInvalid(false)
                    }}
                    aria-invalid={invalid}
                    className={INPUT}
                  />
                  <span className="tnum text-[11px] text-ink-soft">{words.percentUnit}</span>
                  <button type="submit" className={SUBMIT}>
                    {words.use}
                  </button>
                </form>
                {invalid ? (
                  <p role="alert" className="text-xs leading-4 text-over">
                    {words.invalidPercent(
                      formatters.count(MIN_PERCENT),
                      formatters.count(MAX_PERCENT),
                    )}
                  </p>
                ) : null}
              </>
            ) : (
              <>
                <div className="flex flex-wrap gap-1">
                  {BOX_PRESETS.map((preset) => {
                    const next: ResizeChoice = { mode: 'box', ...preset }
                    const label =
                      preset.height === null
                        ? words.presetWidth(preset.width ?? 0)
                        : `${preset.width} × ${preset.height}`
                    return (
                      <button
                        key={label}
                        type="button"
                        aria-pressed={sameResize(choice, next)}
                        onClick={() => apply(next)}
                        className={chip(sameResize(choice, next), true)}
                      >
                        {label}
                      </button>
                    )
                  })}
                </div>

                <form
                  className="grid gap-2"
                  onSubmit={(event) => {
                    event.preventDefault()
                    const next = parseBox(width, height)
                    setInvalid(next === null)
                    if (next !== null) {
                      apply(next)
                      setWidth('')
                      setHeight('')
                    }
                  }}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <label htmlFor={widthId} className="text-xs leading-4 text-ink-soft">
                      {words.width}
                    </label>
                    <input
                      id={widthId}
                      type="text"
                      inputMode="numeric"
                      value={width}
                      onChange={(event) => {
                        setWidth(event.target.value)
                        setInvalid(false)
                      }}
                      aria-invalid={invalid}
                      className={INPUT}
                    />
                    <label htmlFor={heightId} className="text-xs leading-4 text-ink-soft">
                      {words.height}
                    </label>
                    <input
                      id={heightId}
                      type="text"
                      inputMode="numeric"
                      value={height}
                      onChange={(event) => {
                        setHeight(event.target.value)
                        setInvalid(false)
                      }}
                      aria-invalid={invalid}
                      className={INPUT}
                    />
                    <span className="tnum text-[11px] text-ink-soft">{words.pixelsUnit}</span>
                    <button type="submit" className={SUBMIT}>
                      {words.use}
                    </button>
                  </div>
                  <p className="text-xs leading-4 text-ink-soft">{words.boxHint}</p>
                </form>
                {invalid ? (
                  <p role="alert" className="text-xs leading-4 text-over">
                    {words.invalidBox(formatters.count(MIN_PIXELS), formatters.count(MAX_PIXELS))}
                  </p>
                ) : null}
              </>
            )}

            <p className="text-xs leading-4 text-pretty text-ink-soft">{words.rules}</p>
            <p className="text-xs leading-4 text-pretty text-ink-soft">
              {words.fixed(formatters.count(RESIZE_QUALITY))}
            </p>
          </div>
        </div>
      ) : null}
    </div>
  )
}
