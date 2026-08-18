import { useEffect, useId, useRef, useState } from 'react'
import {
  isTramite,
  PERFILES,
  provenanceOf,
  type Profile,
  type ProfileGroup,
} from '../core/profiles'
import type { Formatters } from './format'

/**
 * The product's differentiator, as a control.
 *
 * It is called "Destino" and not "Perfil" or "Calidad" because that is the
 * whole idea: the user says where the image is going and the app works out the
 * format, the weight and the dimensions.
 */

/**
 * Listed in full, including the group with nothing in it.
 *
 * "Trámites" ships empty in the v1 and that is shown rather than hidden. A
 * requirement only enters with an official source and a date it was checked,
 * because a profile with the wrong limit is worse than no profile — the user
 * finds out when the submission is rejected, and by then they trusted us. Said
 * out loud, an empty list is a reason to trust the tool rather than a hole.
 */
const GROUPS: readonly ProfileGroup[] = ['Trámites', 'Web', 'Correo', 'Mensajería', 'Miniatura']

const EMPTY_NOTE =
  'Vacío por ahora. Un requisito de trámite solo entra con fuente oficial y fecha de verificación: un límite equivocado se descubre cuando rechazan el trámite.'

type Props = {
  readonly selected: Profile
  readonly formatters: Formatters
  readonly onSelect: (profile: Profile) => void
}

const limitOf = (profile: Profile, formatters: Formatters): string =>
  profile.maxBytes === undefined ? 'sin tope' : `máx. ${formatters.bytes(profile.maxBytes)}`

function provenanceLine(profile: Profile): string {
  const source = provenanceOf(profile)
  if (source === null) return 'Recomendación nuestra'
  return `Requisito de ${source.source}, verificado el ${source.verifiedAt}`
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
        <span className="tnum text-[11px] text-ink-soft">{limitOf(selected, formatters)}</span>
      </button>

      {open ? (
        <div
          id={panelId}
          className="absolute top-9 left-0 z-40 w-80 border border-rule bg-paper shadow-[0_8px_24px_rgba(22,24,26,0.12)]"
        >
          {GROUPS.map((group) => {
            const members = PERFILES.filter((profile) => profile.group === group)

            return (
              <div key={group} className="border-b border-rule last:border-b-0">
                <div className="px-3 pt-2 pb-1 text-[11px] leading-4 tracking-wider text-ink-soft uppercase">
                  {group}
                </div>

                {members.length === 0 ? (
                  <p className="max-w-[38ch] px-3 pb-2.5 text-xs leading-4 text-pretty text-ink-soft">
                    {EMPTY_NOTE}
                  </p>
                ) : (
                  members.map((profile) => (
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
                          {limitOf(profile, formatters)}
                        </span>
                      </span>
                      <span className="text-xs leading-4 text-pretty text-ink-soft">
                        {provenanceLine(profile)}
                        {isTramite(profile)
                          ? ''
                          : profile.note === undefined
                            ? ''
                            : `. ${profile.note}`}
                      </span>
                    </button>
                  ))
                )}
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
