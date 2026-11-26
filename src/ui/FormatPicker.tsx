import type { OutputFormat } from '../core/codecs/encode'
import { useCopy } from './copy'
import type { Formatters } from './format'
import { FORMAT_CHOICES, qualityOf } from './format-choice'
import { PICKER_BUTTON, PICKER_PANEL, usePicker } from './usePicker'

/**
 * The convert tool's one decision: the format every file comes out as.
 *
 * Each option carries a line that says something true and no more. The
 * quality is not offered, only shown: it is our recommendation for the
 * format, and the same for every file.
 */

type Props = {
  readonly selected: OutputFormat
  readonly formatters: Formatters
  readonly onSelect: (format: OutputFormat) => void
}

export function FormatPicker({ selected, formatters, onSelect }: Props) {
  const copy = useCopy()
  const words = copy.format
  const { open, setOpen, toggle, panelId, container } = usePicker()

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
        <span className="font-medium">{words.names[selected]}</span>
      </button>

      {open ? (
        <div id={panelId} className={PICKER_PANEL}>
          <div className="px-3 pt-2 pb-1 text-[11px] leading-4 tracking-wider text-ink-soft uppercase">
            {words.title}
          </div>

          {FORMAT_CHOICES.map((format) => {
            const quality = qualityOf(format)
            return (
              <button
                key={format}
                type="button"
                onClick={() => {
                  onSelect(format)
                  setOpen(false)
                }}
                aria-current={format === selected}
                className={`grid w-full gap-0.5 px-3 py-2 text-left hover:bg-raised ${
                  format === selected ? 'bg-raised' : ''
                }`}
              >
                <span className="flex items-baseline justify-between gap-3">
                  <span className="text-[13px] leading-4 font-medium">{words.names[format]}</span>
                  <span className="tnum text-[11px] text-ink-soft">
                    {quality === null
                      ? words.lossless
                      : copy.details.quality(formatters.count(quality))}
                  </span>
                </span>
                <span className="text-xs leading-4 text-pretty text-ink-soft">
                  {words.notes[format]}
                </span>
              </button>
            )
          })}

          <p className="border-t border-rule px-3 pt-2 pb-3 text-xs leading-4 text-pretty text-ink-soft">
            {words.fixed}
          </p>
        </div>
      ) : null}
    </div>
  )
}
