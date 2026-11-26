import type { AnimationFormat } from './animation/types'
import { mimeTypeOf, type OutputFormat } from './codecs/encode'

/**
 * What a finished file can be: a still format or an animation.
 *
 * `OutputFormat` stays the four still formats on purpose. The still pipeline
 * falls back to PNG for anything it does not know, so widening that union
 * would turn a GIF into a PNG without a word. The result of a job is the one
 * place both families meet, and this type is how that place is written down:
 * everything that reads the format of a result is a total function over it,
 * so a new kind does not compile until each reader says what it means.
 */
export type OutputKind = OutputFormat | AnimationFormat

export function isAnimationKind(kind: OutputKind): kind is AnimationFormat {
  return kind === 'gif' || kind === 'apng'
}

/**
 * The type a Blob of this kind carries. An APNG is `image/png`: that is what
 * browsers and Discord expect for it, and `image/apng` is not a registered
 * name every consumer knows.
 */
export function mimeTypeOfKind(kind: OutputKind): string {
  switch (kind) {
    case 'gif':
      return 'image/gif'
    case 'apng':
      return 'image/png'
    case 'jpeg':
    case 'png':
    case 'webp':
    case 'avif':
      return mimeTypeOf(kind)
  }
}

/**
 * The file extension, without the dot. Everything outside the core writes
 * `.jpg` for jpeg, and an APNG is a `.png`: Discord marks `.apng` as an
 * invalid asset, and every viewer reads a `.png` and plays it.
 */
export function extensionOfKind(kind: OutputKind): string {
  switch (kind) {
    case 'jpeg':
      return 'jpg'
    case 'apng':
      return 'png'
    case 'png':
    case 'webp':
    case 'avif':
    case 'gif':
      return kind
  }
}

/** How the kind is written in a sentence. */
export function kindName(kind: OutputKind): string {
  switch (kind) {
    case 'jpeg':
      return 'JPEG'
    case 'png':
      return 'PNG'
    case 'webp':
      return 'WebP'
    case 'avif':
      return 'AVIF'
    case 'gif':
      return 'GIF'
    case 'apng':
      return 'APNG'
  }
}
