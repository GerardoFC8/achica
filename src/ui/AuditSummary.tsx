import type { Profile } from '../core/profiles'
import type { AuditData } from '../state/audit-store'
import { useCopy } from './copy'
import type { Formatters } from './format'

/**
 * The audit's own line above the table (D60): what the HAR held, what could be
 * measured, which destination produced the figure, and, folded away, what could
 * not be measured and why.
 *
 * Every address here is text. It comes from the reader already stripped of its
 * query and credentials, and it is never given to an href, a src, a fetch or
 * anything else that would turn a line of the HAR into a request.
 */

type Props = {
  readonly audit: AuditData
  /** The destination the figures below were produced with. */
  readonly profile: Profile
  /** Finished images that did not come out lighter. */
  readonly alreadyFine: number
  readonly formatters: Formatters
}

export function AuditSummary({ audit, profile, alreadyFine, formatters }: Props) {
  const copy = useCopy()
  const words = copy.audit.summary
  const destination = copy.destination.profile(profile).label
  const count = (value: number): string => formatters.count(value)

  const line = words.line(
    audit.measurableCount,
    count(audit.measurableCount),
    count(audit.imageCount),
    formatters.bytes(audit.measurableBytes),
    destination,
  )
  const ignored =
    audit.duplicatesIgnored > 0
      ? words.duplicates(audit.duplicatesIgnored, count(audit.duplicatesIgnored))
      : null

  return (
    <section className="shrink-0 border-b border-rule px-4 py-2 text-[13px] leading-5">
      <p className="tnum">
        {line}
        {alreadyFine > 0 ? ` · ${words.alreadyFine(alreadyFine, count(alreadyFine))}` : ''}
      </p>

      {audit.skipped.length > 0 ? (
        <details className="mt-1">
          <summary className="w-fit cursor-pointer text-xs leading-4 text-ink-soft underline underline-offset-[3px] coarse:min-h-11">
            {words.skippedTitle(audit.skipped.length, count(audit.skipped.length))}
          </summary>
          <ul className="mt-1 max-h-56 overflow-auto border-t border-rule">
            {audit.skipped.map((item, index) => (
              <li key={index} className="grid gap-0.5 border-b border-rule py-1.5">
                <span className="text-xs leading-4 [overflow-wrap:anywhere]">
                  {item.displayUrl}
                </span>
                <span className="tnum text-xs leading-4 text-ink-soft">
                  {item.mimeType === '' ? words.unknownType : item.mimeType} ·{' '}
                  {formatters.bytes(item.bytes)} · {words.reasons[item.reason]}
                </span>
              </li>
            ))}
          </ul>
          {ignored === null ? null : (
            <p className="mt-1 text-xs leading-4 text-ink-soft">{ignored}</p>
          )}
        </details>
      ) : ignored === null ? null : (
        <p className="text-xs leading-4 text-ink-soft">{ignored}</p>
      )}
    </section>
  )
}
