import { useEffect, useState } from 'react'
import { useCopy } from './copy'

/**
 * The output, playing: an `<img>` over a Blob URL the application makes for
 * itself. It is not a request and not a URL from a HAR: the bytes are the ones
 * the worker just produced, and the address names nothing outside this tab.
 *
 * The URL exists only while the row is open. The component is mounted when the
 * row unfolds and unmounted when it folds, which is also when the URL is
 * revoked, so a long batch does not keep one decoded animation alive per row.
 */

type Props = {
  readonly blob: Blob
  readonly alt: string
}

export function AnimationPreview({ blob, alt }: Props) {
  const { details } = useCopy()
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    const made = URL.createObjectURL(blob)
    setUrl(made)
    return () => {
      URL.revokeObjectURL(made)
    }
  }, [blob])

  if (url === null) return null

  return (
    <figure className="mb-2 flex items-start gap-3">
      <img
        src={url}
        alt={alt}
        // Pixel art and flat stickers stay crisp when they are enlarged to the box.
        className="size-32 shrink-0 border border-rule bg-paper object-contain"
      />
      <figcaption className="text-xs leading-4 text-ink-soft">{details.preview}</figcaption>
    </figure>
  )
}
