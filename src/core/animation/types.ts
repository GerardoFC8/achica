/**
 * Types shared by the animation writers (GIF and APNG).
 *
 * The encoders are deliberately format-writers only: they take frames that
 * are already decoded and already the right size, and they return bytes. The
 * decoding, the reframing and the search for a byte budget belong to callers,
 * which is why none of this touches ImageDecoder, canvas or the DOM.
 */

/** One decoded frame: straight (non-premultiplied) RGBA, row-major. */
export type Frame = {
  readonly data: Uint8ClampedArray
  readonly width: number
  readonly height: number
  /** How long the frame stays on screen, in milliseconds. */
  readonly delayMs: number
}

/**
 * The formats this module writes. It is a type of its own on purpose and is
 * not a member of `OutputFormat`: the single-image pipeline falls back to PNG
 * for everything it does not know, and widening that union would route
 * animations through code that flattens them.
 */
export type AnimationFormat = 'gif' | 'apng'

/** A frame after quantisation: one palette index per pixel. */
export type IndexedFrame = {
  readonly indices: Uint8Array
  readonly delayMs: number
}

/**
 * An animation that shares one palette across every frame.
 *
 * `palette` is RGB triples. `transparentIndex` points into it (the entry's
 * colour is irrelevant) or is null when no pixel is transparent. Alpha is
 * binary in this representation: a pixel is either the transparent index or
 * fully opaque.
 */
export type IndexedAnimation = {
  readonly width: number
  readonly height: number
  readonly palette: Uint8Array
  readonly transparentIndex: number | null
  readonly frames: readonly IndexedFrame[]
}

export type EncodeErrorCode =
  | 'no-frames'
  | 'too-many-frames'
  | 'bad-dimensions'
  | 'too-large'
  | 'size-mismatch'
  | 'bad-frame-data'
  | 'bad-delay'
  | 'bad-option'
  | 'compression-unavailable'
  | 'compression-failed'

/** Failures are values, like everywhere in core/. The wording is the UI's job. */
export type EncodeError = { readonly code: EncodeErrorCode; readonly detail: string }

/** What the encoder did, so a caller can tell the user and tune its budget. */
export type EncodeReport = {
  /** Colours in the palette, the transparent entry not counted. Null for RGBA APNG. */
  readonly paletteColors: number | null
  /** True when no colours were merged to fit the palette. Null for RGBA APNG. */
  readonly exactPalette: boolean | null
  readonly transparent: boolean
  readonly dithered: boolean
  /** True when frames were cropped to what changed. */
  readonly optimized: boolean
  /** Frames whose change rectangle was empty (written as a 1x1 no-op). */
  readonly emptyFrames: number
  /** Frames whose written delay differs from the requested one. */
  readonly delaysAdjusted: number
  /** Frames whose delay had to be raised to the 20 ms floor (GIF only). */
  readonly delaysRaisedToMinimum: number
  /** The delays as written, in milliseconds. */
  readonly writtenDelaysMs: readonly number[]
  readonly requestedDurationMs: number
  readonly writtenDurationMs: number
}

export type AnimationEncoding = {
  readonly format: AnimationFormat
  readonly bytes: Uint8Array<ArrayBuffer>
  readonly frameCount: number
  readonly width: number
  readonly height: number
  readonly report: EncodeReport
}
