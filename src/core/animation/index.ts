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
  AnimationError,
  AnimationFormat,
  DecodeErrorCode,
  EncodeError,
  EncodeErrorCode,
  EncodeReport,
  Frame,
  IndexedAnimation,
  IndexedFrame,
} from './types'
export { LIMITS } from './validate'
export {
  decodeAnimation,
  DECODE_LIMITS,
  DEFAULT_DELAY_MS,
  type DecodedAnimation,
  type DecodeOptions,
} from './decode'
export { fitImage, planFit, type FitMode, type FittedPixels, type Placement } from './fit'
export {
  fitAnimationToBudget,
  LADDER,
  mergeShortDelays,
  sampleAtRate,
  type BudgetOutcome,
  type BudgetPlan,
  type EncodeSettings,
  type LadderDeps,
  type Step,
} from './ladder'
export {
  processAnimation,
  type AnimationLayout,
  type AnimationOutcome,
  type AnimationPlan,
} from './process'
