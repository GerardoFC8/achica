import type { OutputFormat } from '../core/codecs/encode'
import type { OutputPlan } from '../core/pipeline'
import { toOutputPlan, type Profile } from '../core/profiles'
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
  }
}

/** The instructions the workers receive for the same choice. */
export function planForTool(tool: ToolId, choices: ToolChoices): OutputPlan {
  // The ceiling belongs to the compressor alone, and so does the PNG rule
  // that goes with it.
  return tool === 'comprimir'
    ? planFor(choices.destination, choices.budget)
    : toOutputPlan(profileForTool(tool, choices))
}
