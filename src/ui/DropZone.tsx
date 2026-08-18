import { useRef, useState } from 'react'
import { filesFromDrop } from './dropped-files'

/**
 * The first screen, which is the work surface and not a landing page.
 *
 * It accepts a dropped folder, not only files: that is what the spec asks for
 * and it is the difference between a tool someone uses on a real camera dump
 * and one they use on four hand-picked pictures.
 */

type Props = {
  readonly onFiles: (files: readonly File[]) => void
}

export function DropZone({ onFiles }: Props) {
  const [over, setOver] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  return (
    <div className="flex flex-1 p-4">
      <div
        onDragOver={(event) => {
          event.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault()
          setOver(false)
          void filesFromDrop(event.dataTransfer).then((files) => {
            if (files.length > 0) onFiles(files)
          })
        }}
        className={`grid flex-1 place-content-center justify-items-center gap-2 border border-dashed p-8 ${
          over ? 'border-ink bg-raised' : 'border-rule'
        }`}
      >
        <p className="text-[15px] leading-5 font-semibold">Arrastra tus imágenes aquí</p>
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="text-[13px] leading-4 underline underline-offset-[3px] coarse:min-h-11"
        >
          o elige archivos
        </button>
        {/* A quiet fact about the tool, not a claim about the tool. */}
        <p className="text-xs leading-4 text-ink-soft">Nada sale de tu dispositivo</p>

        <input
          ref={input}
          type="file"
          accept="image/*"
          multiple
          className="sr-only"
          onChange={(event) => {
            const picked = [...(event.target.files ?? [])]
            if (picked.length > 0) onFiles(picked)
            event.target.value = ''
          }}
        />
      </div>
    </div>
  )
}
