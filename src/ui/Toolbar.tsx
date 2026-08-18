import type { Profile } from '../core/profiles'
import { DestinationPicker } from './DestinationPicker'
import type { Formatters } from './format'

/**
 * A toolbar, not a header: the app's name, the one decision the user makes,
 * and the one button that acts on it. No hero, no tagline, nothing centred.
 */

type Props = {
  readonly profile: Profile
  readonly formatters: Formatters
  readonly pending: number
  readonly running: boolean
  readonly onSelectProfile: (profile: Profile) => void
  readonly onStart: () => void
  readonly onCancelAll: () => void
}

export function Toolbar({
  profile,
  formatters,
  pending,
  running,
  onSelectProfile,
  onStart,
  onCancelAll,
}: Props) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-rule px-4">
      <p className="text-[15px] leading-5 font-semibold tracking-tight">achica</p>

      <DestinationPicker selected={profile} formatters={formatters} onSelect={onSelectProfile} />

      <div className="flex-1" />

      {/* The button says what happens, and the result uses the same word. */}
      {running ? (
        <button
          type="button"
          onClick={onCancelAll}
          className="h-8 rounded-sm bg-ink px-3.5 text-[13px] leading-4 font-medium text-paper hover:bg-ink-soft coarse:h-11"
        >
          Cancelar
        </button>
      ) : pending > 0 ? (
        <button
          type="button"
          onClick={onStart}
          className="h-8 rounded-sm bg-ink px-3.5 text-[13px] leading-4 font-medium text-paper hover:bg-ink-soft coarse:h-11"
        >
          Comprimir {formatters.count(pending)} {pending === 1 ? 'imagen' : 'imágenes'}
        </button>
      ) : null}
    </header>
  )
}
