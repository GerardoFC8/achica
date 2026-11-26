import { useId } from 'react'
import type { Profile } from '../core/profiles'
import { useCopy } from './copy'

/**
 * The two pieces of the Discord destinations that are not a plain choice: where
 * a requirement comes from, and the one option a sticker adds. Kept out of the
 * picker so they can be rendered, and tested, without opening its panel.
 */

/**
 * Where the destination's limit comes from, and when it was checked (D48).
 *
 * The one external URL the interface may show, and only as a plain link: a
 * static anchor asks for nothing until somebody clicks it. `noopener
 * noreferrer` keeps the other site from learning where the visitor came from.
 * The date is printed as the string the catalogue holds, because parsing it as
 * a Date would put it a day early anywhere west of Greenwich.
 */
export function RequirementLine({ profile }: { readonly profile: Profile }) {
  const { destination } = useCopy()
  const { requirement } = profile
  if (requirement === undefined) return null

  return (
    <p className="px-3 pb-2 text-xs leading-4 text-ink-soft">
      {destination.source}:{' '}
      <a
        href={requirement.source}
        target="_blank"
        rel="noopener noreferrer"
        className="underline underline-offset-[3px] hover:text-ink coarse:inline-block coarse:min-h-11 coarse:leading-11"
      >
        {new URL(requirement.source).hostname}
      </a>
      {' · '}
      <span className="tnum">{destination.verifiedAt(requirement.verifiedAt)}</span>
    </p>
  )
}

type CanvasProps = {
  readonly checked: boolean
  readonly onChange: (checked: boolean) => void
}

/**
 * Off by default: Discord's own screen asks for 320 × 320, so shrinking the
 * canvas is something the user opts into, with the honest sentence beside it.
 */
export function CanvasChoice({ checked, onChange }: CanvasProps) {
  const { destination } = useCopy()
  const noteId = useId()

  return (
    <label className="flex items-start gap-2 px-3 py-2 text-xs leading-4 coarse:min-h-11">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        aria-describedby={noteId}
        className="mt-0.5 accent-ink"
      />
      <span className="grid gap-0.5">
        <span>{destination.canvasReduction}</span>
        <span id={noteId} className="text-ink-soft">
          {destination.canvasReductionNote}
        </span>
      </span>
    </label>
  )
}
