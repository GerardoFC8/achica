import { extensionOfKind, type OutputKind } from '../core/output-kind'

/**
 * What each saved file is called.
 *
 * No browser in here, which is the point: writing into a folder and streaming
 * a ZIP are two different APIs and they must not disagree about names. A
 * collision costs a file either way — silently overwritten in a folder, and
 * inside a ZIP an entry that some tools refuse and others quietly drop.
 */

/** The dot that starts a dotfile is part of the name, not an extension. */
function splitExtension(name: string): { readonly stem: string; readonly extension: string } {
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return { stem: name, extension: '' }
  return { stem: name.slice(0, dot), extension: name.slice(dot + 1) }
}

/**
 * The name of a result. The extension comes from `extensionOfKind`: jpeg is
 * written .jpg, and an APNG is a .png, because Discord marks .apng as an
 * invalid asset.
 */
export function outputName(sourceName: string, kind: OutputKind): string {
  return `${splitExtension(sourceName).stem}.${extensionOfKind(kind)}`
}

/**
 * Makes a list of names safe to write side by side.
 *
 * Two folders of holiday photos both holding IMG_0001.jpg is the normal case,
 * not the exotic one. The comparison ignores case because Windows and macOS
 * do: writing Foto.webp next to foto.webp loses one of them.
 */
export function uniqueNames(names: readonly string[]): string[] {
  const taken = new Set<string>()
  const claim = (name: string): string => {
    taken.add(name.toLowerCase())
    return name
  }

  return names.map((name) => {
    if (!taken.has(name.toLowerCase())) return claim(name)

    const { stem, extension } = splitExtension(name)
    const suffix = extension === '' ? '' : `.${extension}`

    // Keeps counting past a name the user already spelled with a suffix, so
    // foto-2.webp arriving on its own does not collide with a generated one.
    for (let index = 2; ; index += 1) {
      const candidate = `${stem}-${index}${suffix}`
      if (!taken.has(candidate.toLowerCase())) return claim(candidate)
    }
  })
}
