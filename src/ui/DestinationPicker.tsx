import { useEffect, useId, useRef, useState } from 'react'
import { PERFILES, profilesByGroup, type Profile } from '../core/profiles'
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
 */

type Props = {
  readonly selected: Profile
  readonly formatters: Formatters
  readonly onSelect: (profile: Profile) => void
}

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

export function DestinationPicker({ selected, formatters, onSelect }: Props) {
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
        <span className="tnum text-[11px] text-ink-soft">{summaryOf(selected, formatters)}</span>
      </button>

      {open ? (
        <div
          id={panelId}
          className="absolute top-9 left-0 z-40 w-80 border border-rule bg-paper shadow-[0_8px_24px_rgba(22,24,26,0.12)]"
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
        </div>
      ) : null}
    </div>
  )
}
