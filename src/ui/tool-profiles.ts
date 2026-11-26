import type { VideoSegment } from '../core/animation/video-segment'
import type { OutputFormat } from '../core/codecs/encode'
import type { OutputPlan } from '../core/pipeline'
import { DISCORD_PERFILES, PERFILES, toOutputPlan, type Profile } from '../core/profiles'
import type { ToolId } from '../tools/registry'
import { planFor, withBudget, type BudgetChoice } from './budget'
import { profileForFormat } from './format-choice'
import { profileForResize, type ResizeChoice } from './resize-choice'

/**
 * What each tool does to a file, in one place.
 *
 * Each tool has its own choice and ignores the others': the compressor takes a
 * destination and a weight ceiling, the resizer a percentage or a box, the
 * converter a format. App keeps all of them, so switching tools on a page that
 * hosts one never loses a choice, and this file reads the one that applies.
 */

export type ToolChoices = {
  readonly destination: Profile
  readonly budget: BudgetChoice
  readonly resize: ResizeChoice
  readonly format: OutputFormat
  /** Discord stickers only: fall back to a 256 px canvas when nothing else fits. */
  readonly canvasReduction: boolean
  /** Discord only: which part of a video becomes the animation. A still-animation ignores it. */
  readonly video: VideoSegment
}

/**
 * Quitar EXIF has nothing to choose, so its profile is one constant. It never
 * recompresses: `stripOnly` makes the workers edit the container bytes.
 */
export const STRIP_PROFILE: Profile = {
  id: 'quitar-exif',
  label: 'Quitar metadatos',
  group: 'Metadatos',
  format: 'keep',
  stripOnly: true,
  stripMetadata: true,
  note: 'Quita EXIF, ubicación GPS, XMP, IPTC, comentarios y datos añadidos tras la imagen sin recodificar: los píxeles no cambian. Conserva el perfil de color y la orientación.',
}

/**
 * The auditor's own default destination (D60). The compressor's default mixes
 * recompressing, changing the format and shrinking, and an audit cannot assume
 * any of that: a `.webp` does not replace a `.jpg` without touching the HTML,
 * and a HAR does not say what size each image is painted at. So the default is
 * the one thing that can be applied blindly, the same format and the same
 * size, at the quality the catalogue's destinations use.
 */
export const AUDIT_PROFILE: Profile = {
  id: 'auditoria-mismo-formato',
  label: 'Mismo formato y tamaño',
  group: 'Auditoría',
  format: 'keep',
  quality: 78,
  stripMetadata: true,
  note: 'Recomprime cada imagen sin cambiar su formato ni sus dimensiones, así que el ahorro es el de sustituir el archivo por uno más ligero sin tocar la página. No supone ni el formato nuevo ni el tamaño al que se pinta.',
}

/** The destinations a tool offers, first one being its default. */
export function destinationsFor(tool: ToolId): readonly Profile[] {
  if (tool === 'discord') return DISCORD_PERFILES
  return tool === 'auditar' ? [AUDIT_PROFILE, ...PERFILES] : PERFILES
}

/** Only a sticker has a canvas to reduce; an emoji is shrunk to fit instead. */
export function isSticker(profile: Profile): boolean {
  return profile.animation?.layout.kind === 'sticker'
}

/**
 * The Discord destination with the user's canvas choice written into it, so
 * the plan and every row read the same profile. An emoji never carries it.
 */
function withCanvasReduction(profile: Profile, allowed: boolean): Profile {
  if (profile.animation === undefined || !allowed || !isSticker(profile)) return profile
  return { ...profile, animation: { ...profile.animation, allowCanvasReduction: true } }
}

/** The destination a tool starts on. */
export function defaultDestination(tool: ToolId): Profile {
  return destinationsFor(tool)[0] ?? AUDIT_PROFILE
}

/** The profile every row is measured against. */
export function profileForTool(tool: ToolId, choices: ToolChoices): Profile {
  switch (tool) {
    case 'comprimir':
      return withBudget(choices.destination, choices.budget)
    case 'redimensionar':
      return profileForResize(choices.resize)
    case 'convertir':
      return profileForFormat(choices.format)
    case 'quitar-exif':
      return STRIP_PROFILE
    case 'discord':
      return withCanvasReduction(choices.destination, choices.canvasReduction)
    case 'auditar':
      // No weight ceiling: it belongs to the compressor alone.
      return choices.destination
  }
}

/** The instructions the workers receive for the same choice. */
export function planForTool(tool: ToolId, choices: ToolChoices): OutputPlan {
  // The ceiling belongs to the compressor alone, and so does the PNG rule
  // that goes with it.
  if (tool === 'comprimir') return planFor(choices.destination, choices.budget)

  const plan = toOutputPlan(profileForTool(tool, choices))
  // Always set for Discord: the runner reads it only when the file turns out
  // to be a video by its bytes, so a GIF in the same batch is unaffected.
  return tool === 'discord' && plan.animation !== undefined
    ? { ...plan, animation: { ...plan.animation, video: choices.video } }
    : plan
}
