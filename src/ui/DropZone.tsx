import { useRef, useState } from 'react'
import { pathFor } from '../tools/links'
import { useCopy } from './copy'
import { useTool, useToolWords } from './tool-context'
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
  /** The audit reads a HAR: while it is read, and why the last one was refused. */
  readonly reading?: boolean
  readonly error?: string | null
}

export function DropZone({ onFiles, reading = false, error = null }: Props) {
  const copy = useCopy()
  const tool = useTool()
  const words = useToolWords()
  const [over, setOver] = useState(false)
  const audit = tool === 'auditar'
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
          // The audit takes one file, never a folder or a pile of images, and
          // the flat list is all it needs to say so.
          if (audit) {
            const dropped = [...event.dataTransfer.files]
            if (dropped.length > 0) onFiles(dropped)
            return
          }
          void filesFromDrop(event.dataTransfer).then((files) => {
            if (files.length > 0) onFiles(files)
          })
        }}
        className={`grid flex-1 place-content-center justify-items-center gap-2 border border-dashed p-8 ${
          over ? 'border-ink bg-raised' : 'border-rule'
        }`}
      >
        {/*
          The page's one heading. It names the task in the words people search
          with, and it is still the invitation the empty screen has to be.
        */}
        <h1 className="text-[15px] leading-5 font-semibold">{words.heading}</h1>
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="text-[13px] leading-4 underline underline-offset-[3px] coarse:min-h-11"
        >
          {audit ? copy.audit.pick : copy.drop.pick}
        </button>
        {/* A quiet fact about the tool, not a claim about the tool. */}
        <p className="text-xs leading-4 text-ink-soft">{copy.drop.promise}</p>

        {audit ? (
          <div className="grid max-w-prose gap-1 text-center text-xs leading-4 text-balance text-ink-soft">
            <p>{copy.audit.howTo}</p>
            <p>{copy.audit.privacy}</p>
            <p>{copy.audit.warning}</p>
          </div>
        ) : null}
        {reading ? (
          <p role="status" className="text-[13px] leading-4">
            {copy.audit.reading}
          </p>
        ) : null}
        {error === null ? null : (
          <p role="alert" className="max-w-prose text-center text-[13px] leading-4 text-over">
            {error}
          </p>
        )}

        {/*
          A plain link and not a switch: each language is its own page, so a
          crawler follows it and a visitor can share either one (D54). It leads to
          the same tool's twin page, not to the other language's front door.
        */}
        <a
          href={pathFor(tool, copy.otherLanguage.lang)}
          hrefLang={copy.otherLanguage.lang}
          lang={copy.otherLanguage.lang}
          className="mt-4 text-xs leading-4 text-ink-soft underline underline-offset-[3px] hover:text-ink coarse:min-h-11"
        >
          {copy.otherLanguage.label}
        </a>

        <input
          ref={input}
          type="file"
          accept={audit ? '.har,.json,application/json' : 'image/*'}
          multiple={!audit}
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
