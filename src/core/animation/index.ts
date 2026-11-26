export { encodeApng, encodeApngIndexed, type ApngOptions } from './apng'
export { encodeGif, encodeGifIndexed, type GifOptions } from './gif'
export {
  ALPHA_THRESHOLD,
  quantizeAnimation,
  type QuantizeOptions,
  type QuantizeReport,
  type Quantized,
} from './quantize'
export type {
  AnimationEncoding,
  AnimationFormat,
  EncodeError,
  EncodeErrorCode,
  EncodeReport,
  Frame,
  IndexedAnimation,
  IndexedFrame,
} from './types'
export { LIMITS } from './validate'
