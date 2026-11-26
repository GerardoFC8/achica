import { describe, expect, it } from 'vitest'
import { DISCORD_PERFILES, type Profile } from '../core/profiles'
import type { QueueItem } from '../state/queue'
import { en, es } from './copy'
import { createFormatters, DEFAULT_LOCALE } from './format'
import { profileForFormat } from './format-choice'
import { profileForResize } from './resize-choice'
import type { RemovedMetadata } from '../core/metadata'
import { AUDIT_PROFILE, STRIP_PROFILE } from './tool-profiles'
import type { ItemOutcome } from '../state/queue'
import { animationNote, rowDetails, rowKind, rowNote, savedRatio, weightBar } from './row-model'

/**
 * The weight bar is the one distinctive element in the interface, so its
 * geometry is arithmetic that lives here and is tested here, not something
 * a component works out while rendering.
 */

const BUDGETED: Profile = {
  id: 'correo-adjunto',
  label: 'Adjunto de correo',
  group: 'Correo',
  format: 'jpeg',
  maxBytes: 500_000,
  stripMetadata: true,
}

const UNBUDGETED: Profile = {
  id: 'web-articulo',
  label: 'Imagen para artículo web',
  group: 'Web',
  format: 'webp',
  maxWidth: 1600,
  stripMetadata: true,
}

const SOURCE = new File([new Uint8Array(8)], 'foto.jpg')

function done(
  bytesBefore: number,
  bytesAfter: number,
  shrunk = false,
  converted = false,
): QueueItem {
  return {
    id: 'a',
    file: SOURCE,
    name: 'foto.jpg',
    bytesBefore,
    status: 'done',
    blob: new Blob([new Uint8Array(bytesAfter)]),
    ms: 42,
    outcome: {
      format: converted ? 'webp' : 'jpeg',
      bytesBefore,
      bytesAfter,
      width: 1280,
      height: 853,
      quality: 70,
      withinBudget: true,
      shrunkForBudget: shrunk ? { width: 1280, height: 853 } : null,
      convertedForBudget: converted,
      encodes: 3,
    },
  }
}

const pending: QueueItem = {
  id: 'a',
  file: SOURCE,
  name: 'foto.jpg',
  bytesBefore: 1000,
  status: 'pending',
}

describe('rowKind', () => {
  it('is the queue status while the file has not finished', () => {
    expect(rowKind(pending, BUDGETED, 'comprimir')).toBe('pending')
    expect(rowKind({ ...pending, status: 'running' }, BUDGETED, 'comprimir')).toBe('running')
    expect(rowKind({ ...pending, status: 'cancelled' }, BUDGETED, 'comprimir')).toBe('cancelled')
  })

  it('is failed for a file that produced nothing', () => {
    const item: QueueItem = {
      ...pending,
      status: 'failed',
      error: { code: 'empty-file' },
    }

    expect(rowKind(item, BUDGETED, 'comprimir')).toBe('failed')
  })

  it('says it fits when the result lands well short of the budget', () => {
    expect(rowKind(done(1_000_000, 200_000), BUDGETED, 'comprimir')).toBe('fits')
  })

  it('says it is tight inside the last tenth before the budget', () => {
    // Budget mark sits at 0.5 of the original; 0.47 is inside the last 10%.
    expect(rowKind(done(1_000_000, 470_000), BUDGETED, 'comprimir')).toBe('tight')
  })

  it('says it did not fit when the result passes the budget', () => {
    expect(rowKind(done(1_000_000, 620_000), BUDGETED, 'comprimir')).toBe('over')
  })

  it('treats any real shrink as fitting when the profile sets no budget', () => {
    expect(rowKind(done(1_000_000, 300_000), UNBUDGETED, 'comprimir')).toBe('fits')
  })

  it('says it did not fit when a result grew under a budget it never touched', () => {
    // 300 KB source, 500 KB budget, and a conversion to a heavier format that
    // came back at 900 KB. It satisfies the budget and still failed the point.
    expect(rowKind(done(300_000, 900_000), BUDGETED, 'comprimir')).toBe('over')
  })

  it('says it did not fit when a budgetless result grew', () => {
    // No budget to miss, but the tool exists to make files smaller. A result
    // that grew failed at the only thing it was asked to do.
    expect(rowKind(done(1_000_000, 1_200_000), UNBUDGETED, 'comprimir')).toBe('over')
  })
})

describe('rowKind by tool', () => {
  it('judges weight only in the compressor', () => {
    expect(rowKind(done(1_000_000, 1_200_000), UNBUDGETED, 'comprimir')).toBe('over')
    expect(rowKind(done(1_000_000, 620_000), BUDGETED, 'comprimir')).toBe('over')
  })

  it.each(['redimensionar', 'convertir'] as const)(
    'reads every finished file as done in %s, even one that grew',
    (tool) => {
      expect(rowKind(done(1_000_000, 300_000), UNBUDGETED, tool)).toBe('done')
      expect(rowKind(done(1_000_000, 1_200_000), UNBUDGETED, tool)).toBe('done')
      // Not even a ceiling that somehow reached the profile turns it into a verdict.
      expect(rowKind(done(1_000_000, 620_000), BUDGETED, tool)).toBe('done')
    },
  )

  it.each(['redimensionar', 'convertir'] as const)(
    'keeps the unfinished states and failures in %s',
    (tool) => {
      expect(rowKind(pending, UNBUDGETED, tool)).toBe('pending')
      expect(rowKind({ ...pending, status: 'cancelled' }, UNBUDGETED, tool)).toBe('cancelled')
      const failed: QueueItem = { ...pending, status: 'failed', error: { code: 'empty-file' } }
      expect(rowKind(failed, UNBUDGETED, tool)).toBe('failed')
    },
  )

  it('still reports the real sign of a file that grew', () => {
    expect(savedRatio(done(1_000_000, 1_200_000))).toBeCloseTo(-0.2)
  })
})

describe('weightBar', () => {
  it('puts the budget mark where the budget falls against the original', () => {
    const bar = weightBar(done(1_000_000, 200_000), BUDGETED)

    expect(bar?.mark).toBeCloseTo(0.5)
    expect(bar?.fill).toBeCloseTo(0.2)
    expect(bar?.overflow).toBeNull()
  })

  it('draws no mark when the budget never constrained the file', () => {
    // A 300 KB photo against a 500 KB budget. Pinning the mark to the right
    // edge would read as "only just made it" on a row where the limit was
    // never in play.
    const bar = weightBar(done(300_000, 120_000), BUDGETED)

    expect(bar?.mark).toBeNull()
  })

  it('has no mark at all when the profile sets no budget', () => {
    expect(weightBar(done(1_000_000, 300_000), UNBUDGETED)?.mark).toBeNull()
  })

  it('measures the overflow from the mark, so it can be drawn apart', () => {
    const bar = weightBar(done(1_000_000, 700_000), BUDGETED)

    expect(bar?.overflow?.start).toBeCloseTo(0.5)
    expect(bar?.overflow?.width).toBeCloseTo(0.2)
  })

  it('clamps a result that outgrew its original to the full track', () => {
    const bar = weightBar(done(1_000_000, 1_400_000), UNBUDGETED)

    expect(bar?.fill).toBe(1)
  })

  it('gives an empty track to a file that has not finished', () => {
    const bar = weightBar(pending, BUDGETED)

    expect(bar?.fill).toBe(0)
    expect(bar?.overflow).toBeNull()
  })

  it('gives no bar to a file that failed or was cancelled', () => {
    // A corrupt file has no final weight to plot, and an empty track would
    // read as a file that compressed to nothing.
    expect(weightBar({ ...pending, status: 'cancelled' }, BUDGETED)).toBeNull()
    expect(
      weightBar({ ...pending, status: 'failed', error: { code: 'empty-file' } }, BUDGETED),
    ).toBeNull()
  })

  it('survives a file that reports no size', () => {
    expect(weightBar({ ...pending, bytesBefore: 0 }, BUDGETED)?.fill).toBe(0)
  })
})

describe('rowNote', () => {
  const formatters = createFormatters(DEFAULT_LOCALE)

  it('names the state while the file waits or runs', () => {
    expect(rowNote(pending, formatters, es, 'comprimir')).toBe('En cola')
    expect(rowNote({ ...pending, status: 'running' }, formatters, es, 'comprimir')).toBe(
      'Comprimiendo',
    )
    expect(rowNote({ ...pending, status: 'cancelled' }, formatters, es, 'comprimir')).toBe(
      'Cancelado',
    )
  })

  it('shows the output dimensions once there is a result', () => {
    expect(rowNote(done(1_000_000, 200_000), formatters, es, 'comprimir')).toBe('1,280 × 853')
  })

  it('says outright when the image was shrunk to fit', () => {
    // The user has to learn this here, not when they open the file.
    expect(rowNote(done(1_000_000, 200_000, true), formatters, es, 'comprimir')).toBe(
      'Se redujo a 1,280 × 853 para entrar',
    )
  })

  it('says outright when the format changed to fit', () => {
    // A .png that comes back .webp is the other surprise to name in the row.
    expect(rowNote(done(1_000_000, 200_000, false, true), formatters, es, 'comprimir')).toBe(
      '1,280 × 853 · pasó a WebP para entrar',
    )
    expect(rowNote(done(1_000_000, 200_000, true, true), formatters, es, 'comprimir')).toBe(
      'Pasó a WebP y se redujo a 1,280 × 853 para entrar',
    )
  })

  it('says the verb of the tool while it works', () => {
    const running: QueueItem = { ...pending, status: 'running' }

    expect(rowNote(running, formatters, es, 'redimensionar')).toBe('Redimensionando')
    expect(rowNote(running, formatters, es, 'convertir')).toBe('Convirtiendo')
  })

  it('names the tool in the empty-file error', () => {
    const item: QueueItem = { ...pending, status: 'failed', error: { code: 'empty-file' } }

    expect(rowNote(item, formatters, es, 'convertir')).toBe(
      'Archivo vacío, no hay nada que convertir',
    )
  })

  it('explains the failure in words', () => {
    const item: QueueItem = { ...pending, status: 'failed', error: { code: 'empty-file' } }

    expect(rowNote(item, formatters, es, 'comprimir')).toBe(
      'Archivo vacío, no hay nada que comprimir',
    )
  })
})

describe('what a row says the destination asked for', () => {
  const formatters = createFormatters(DEFAULT_LOCALE)
  const queued: QueueItem = {
    id: 'p',
    file: SOURCE,
    name: 'foto.jpg',
    bytesBefore: 1000,
    status: 'pending',
  }
  const targetOf = (
    profile: Profile,
    tool: 'comprimir' | 'redimensionar' | 'convertir',
    copy = es,
  ): string | undefined =>
    rowDetails(queued, profile, formatters, copy, tool).find(
      (detail) => detail.label === copy.details.target,
    )?.value

  it('says a percentage is a percentage, not "any size"', () => {
    const profile = profileForResize({ mode: 'percent', percent: 50 })

    expect(targetOf(profile, 'redimensionar')).toBe('50 % del ancho y del alto, formato original')
    expect(targetOf(profile, 'redimensionar', en)).toBe(
      '50% of the width and height, original format',
    )
  })

  it('says a box with both sides as a box', () => {
    const profile = profileForResize({ mode: 'box', width: 1920, height: 1080 })

    expect(targetOf(profile, 'redimensionar')).toBe('máx. 1920 × 1080 px, formato original')
  })

  it('says a format change keeps the dimensions', () => {
    expect(targetOf(profileForFormat('webp'), 'convertir')).toBe('mismas dimensiones, WebP')
    expect(targetOf(profileForFormat('jpeg'), 'convertir', en)).toBe('same dimensions, JPEG')
  })
})

describe('Quitar EXIF', () => {
  const formatters = createFormatters(DEFAULT_LOCALE)
  const profile = STRIP_PROFILE

  const report = (changes: Partial<RemovedMetadata>): RemovedMetadata => ({
    kinds: [],
    bytesRemoved: 0,
    trailingBytes: 0,
    orientation: null,
    exifUnreadable: false,
    hadGps: false,
    hadCameraInfo: false,
    ...changes,
  })

  const cleaned = (metadata: RemovedMetadata, bytesAfter = 900_000): QueueItem => {
    const item = done(1_000_000, bytesAfter)
    if (item.status !== 'done') throw new Error('unreachable')
    return { ...item, outcome: { ...item.outcome, metadata } }
  }

  const note = (metadata: RemovedMetadata, copy = es): string =>
    rowNote(cleaned(metadata), formatters, copy, 'quitar-exif')

  it('names the location only when the core says there was one', () => {
    const withGps = report({
      kinds: ['exif'],
      hadGps: true,
      hadCameraInfo: true,
      orientation: 6,
      bytesRemoved: 5_000,
    })
    expect(note(withGps)).toBe('Quitó ubicación GPS y datos de la cámara; conservó la orientación')
    expect(note(withGps, en)).toBe('Removed GPS location and camera details; kept the orientation')

    const noGps = report({ kinds: ['exif'], hadCameraInfo: true })
    expect(note(noGps)).toBe('Quitó datos de la cámara')
    expect(note(noGps)).not.toMatch(/GPS|ubicación/)
    expect(note(report({ kinds: ['exif'] }))).toBe('Quitó datos EXIF')
  })

  it('says what sat after the image, with its weight', () => {
    const facts = report({ kinds: ['xmp', 'trailing-data'], trailingBytes: 12_000 })
    expect(note(facts)).toMatch(/^Quitó XMP y .+ tras el fin de imagen$/)
    expect(note(facts, en)).toMatch(/^Removed XMP and .+ after the end of the image$/)
    expect(note(report({ kinds: ['xmp', 'iptc'] }))).toBe('Quitó XMP e IPTC')
  })

  it('says so when there was nothing to remove', () => {
    expect(note(report({}))).toBe('No tenía metadatos: quedó igual')
    expect(note(report({}), en)).toBe('It had no metadata: left as it was')
    expect(note(report({ orientation: 6 }))).toBe(
      'Solo tenía la orientación, que se conserva: quedó igual',
    )
  })

  it('is honest about an EXIF that could not be read', () => {
    const unreadable = report({ kinds: ['exif'], exifUnreadable: true, bytesRemoved: 80 })
    expect(note(unreadable)).toBe('Se quitó un EXIF ilegible; no se pudo conservar la orientación')
    expect(note(unreadable, en)).toBe(
      'Removed an unreadable EXIF block; the orientation could not be kept',
    )
    expect(note(report({ kinds: ['exif', 'comment'], exifUnreadable: true }))).toBe(
      'Se quitó un EXIF ilegible y comentarios; no se pudo conservar la orientación',
    )
  })

  it('reads every finished file as done, even one that did not shrink', () => {
    expect(rowKind(cleaned(report({}), 1_000_000), profile, 'quitar-exif')).toBe('done')
    expect(rowKind(cleaned(report({ kinds: ['exif'] })), profile, 'quitar-exif')).toBe('done')
    expect(savedRatio(cleaned(report({}), 1_000_000))).toBe(0)
  })

  it('details what was removed, how much, and that nothing was re-encoded', () => {
    const item = cleaned(
      report({ kinds: ['exif', 'comment'], hadGps: true, bytesRemoved: 4_096, orientation: 3 }),
    )
    const rows = rowDetails(item, profile, formatters, es, 'quitar-exif')
    const value = (label: string): string | undefined =>
      rows.find((row) => row.label === label)?.value

    expect(value('Se quitó')).toBe('ubicación GPS y comentarios')
    expect(value('Bytes quitados')).toBe(formatters.bytes(4_096))
    expect(value('Recodificación')).toBe('ninguna, los píxeles no cambiaron')
    expect(value('Se conserva')).toBe('píxeles, perfil de color y orientación')
    expect(value('Destino pide')).toBe('quitar metadatos, sin recodificar')
    // The compressor's own rows have no place here.
    expect(rows.map((row) => row.label)).not.toContain('Pasadas de codificación')

    const empty = rowDetails(cleaned(report({})), profile, formatters, en, 'quitar-exif')
    expect(empty.find((row) => row.label === 'Removed')?.value).toBe('nothing')
  })
})

describe('the audit reads an image that did not improve as already fine', () => {
  const formatters = createFormatters(DEFAULT_LOCALE)
  const note = (item: QueueItem, tool: 'auditar' | 'convertir', copy = es): string =>
    rowNote(item, formatters, copy, tool)

  it('says so when the output is heavier', () => {
    expect(note(done(1_000, 1_200), 'auditar')).toBe('Ya estaba bien: no se reduce')
    expect(note(done(1_000, 1_200), 'auditar', en)).toBe('Already fine: not reduced')
  })

  it('says so when the output weighs exactly the same', () => {
    expect(note(done(1_000, 1_000), 'auditar')).toBe('Ya estaba bien: no se reduce')
  })

  it('says nothing of the kind about an image that got lighter', () => {
    expect(note(done(1_000, 400), 'auditar')).not.toContain('Ya estaba bien')
  })

  it('is neutral, not a failure, in the verdict', () => {
    expect(rowKind(done(1_000, 1_200), AUDIT_PROFILE, 'auditar')).toBe('done')
    expect(rowKind(done(1_000, 400), AUDIT_PROFILE, 'auditar')).toBe('done')
  })

  it('is the audit alone: another tool describes a grown file by its size', () => {
    expect(note(done(1_000, 1_200), 'convertir')).not.toContain('Ya estaba bien')
  })

  it('shows where the file came from, as text, when the audit knows', () => {
    const rows = rowDetails(
      done(1_000, 400),
      AUDIT_PROFILE,
      formatters,
      es,
      'auditar',
      'https://example.com/img/a.jpg',
    )

    expect(rows[0]).toEqual({
      label: 'Dirección en el HAR',
      value: 'https://example.com/img/a.jpg',
    })
    expect(
      rowDetails(done(1_000, 400), AUDIT_PROFILE, formatters, es, 'auditar')[0]?.label,
    ).not.toBe('Dirección en el HAR')
  })
})

describe('animationNote', () => {
  const formatters = createFormatters(DEFAULT_LOCALE)
  const base = {
    withinBudget: true,
    width: 320,
    height: 320,
    bytesAfter: 480_000,
  }
  const animation = (
    over: Partial<NonNullable<ItemOutcome['animation']>> = {},
  ): NonNullable<ItemOutcome['animation']> => ({
    frames: 30,
    durationMs: 2000,
    fps: 15,
    colors: 32,
    steps: [],
    ...over,
  })
  const say = (outcome: Parameters<typeof animationNote>[0], copy = es) =>
    animationNote(outcome, formatters, copy, 512_000)

  it('is null for a file that is not an animation', () => {
    expect(say({ ...base })).toBeNull()
  })

  it('states the fps, the colours and the canvas', () => {
    const note = say({ ...base, animation: animation() })

    expect(note?.headline).toBe('15 fps · 32 colores · lienzo 320 × 320')
    expect(note?.steps).toEqual([])
    expect(note?.fits).toBe(true)
    expect(note?.verdict).toBe('Entra en el límite')
  })

  it('says full colour for a lossless APNG', () => {
    expect(say({ ...base, animation: animation({ colors: null }) })?.headline).toContain(
      'color completo',
    )
  })

  it('puts what was given up in words, in the order it was given up', () => {
    const note = say({
      ...base,
      animation: animation({
        fps: 4,
        colors: 32,
        steps: [
          { kind: 'palette', colors: 32 },
          { kind: 'fps', from: 15, to: 4 },
          { kind: 'scale', to: 0.7 },
          { kind: 'canvas', to: 256 },
          { kind: 'optimise', on: false },
        ],
      }),
    })

    expect(note?.steps).toEqual([
      'paleta de 32 colores',
      'se bajó a 4 fps',
      'tamaño reducido al 70 %',
      'lienzo reducido a 256 px',
      'recorte por diferencias desactivado',
    ])
  })

  it('does not report the default cropping as something given up', () => {
    const note = say({ ...base, animation: animation({ steps: [{ kind: 'optimise', on: true }] }) })

    expect(note?.steps).toEqual([])
  })

  it('flags a result that did not fit, with the size it ended at', () => {
    const note = say({ ...base, withinBudget: false, bytesAfter: 600_000, animation: animation() })

    expect(note?.fits).toBe(false)
    expect(note?.verdict).toContain('No entra en el límite')
    expect(note?.verdict).toContain('600')
    // The limit is named too, so the row says by how much it missed.
    expect(note?.verdict).toContain('512')
  })

  describe('a clip cut out of a video', () => {
    const clip = { startSeconds: 0, lengthSeconds: 5, sourceDurationSeconds: 42 }

    it('says which part was kept, in both languages', () => {
      const outcome = { ...base, animation: animation({ clip }) }

      expect(say(outcome)?.clip).toBe('Tramo de 0 a 5 s de 42 s')
      expect(say(outcome, en)?.clip).toBe('Segment from 0 to 5 s of 42 s')
    })

    it('formats the numbers like the rest of the row, with a decimal only when there is one', () => {
      const outcome = {
        ...base,
        animation: animation({
          clip: { startSeconds: 1.5, lengthSeconds: 2.25, sourceDurationSeconds: 1234.5 },
        }),
      }

      expect(say(outcome)?.clip).toBe('Tramo de 1.5 a 3.8 s de 1,234.5 s')
    })

    it('is null for an animation that did not come from a video', () => {
      expect(say({ ...base, animation: animation() })?.clip).toBeNull()
    })

    it('is a fact of the segment, never a verdict: it is not in the verdict, and nothing names Discord', () => {
      const over = say({ ...base, withinBudget: false, animation: animation({ clip }) })

      expect(over?.verdict).not.toContain('Tramo')
      for (const copy of [es, en]) {
        const text = say({ ...base, animation: animation({ clip }) }, copy)?.clip ?? ''
        expect(text).not.toMatch(/discord/i)
        expect(text).not.toMatch(/error|fall|fail|límite|limit/i)
      }
    })
  })

  it('reads in English too, with nothing left undefined', () => {
    const note = say(
      {
        ...base,
        withinBudget: false,
        animation: animation({ steps: [{ kind: 'fps', from: 15, to: 6 }] }),
      },
      en,
    )

    expect(note?.headline).toBe('15 fps · 32 colours · canvas 320 × 320')
    expect(note?.steps).toEqual(['lowered to 6 fps'])
    expect(note?.verdict).toContain('Does not fit')
    expect(JSON.stringify(note)).not.toContain('undefined')
  })
})

/*
 * Discord (S6a): the limit is an absolute one, so the verdict, the bar and the
 * note are read against it and not against the original's weight.
 */
describe('a Discord result', () => {
  const profileOf = (id: string): Profile => {
    const found = DISCORD_PERFILES.find((candidate) => candidate.id === id)
    if (found === undefined) throw new Error(`no profile ${id}`)
    return found
  }
  const sticker = profileOf('discord-sticker-gif')
  const emoji = profileOf('discord-emoji-gif')
  const formatters = createFormatters(DEFAULT_LOCALE)

  /** A finished animation whose original weighed `before` and whose result weighs `after`. */
  function animated(
    before: number,
    after: number,
    over: Partial<ItemOutcome> = {},
    steps: NonNullable<ItemOutcome['animation']>['steps'] = [],
  ): QueueItem {
    const base = done(before, after)
    if (base.status !== 'done') throw new Error('the helper builds finished rows')
    return {
      ...base,
      outcome: {
        format: 'gif',
        bytesBefore: before,
        bytesAfter: after,
        width: 320,
        height: 320,
        quality: null,
        withinBudget: true,
        shrunkForBudget: null,
        convertedForBudget: false,
        encodes: 4,
        animation: { frames: 20, durationMs: 2000, fps: 10, colors: 64, steps },
        ...over,
      },
    }
  }

  describe('the verdict', () => {
    it('fits with margin, however small or big the original was', () => {
      expect(rowKind(animated(30_000, 200_000), sticker, 'discord')).toBe('fits')
      expect(rowKind(animated(5_000_000, 200_000), sticker, 'discord')).toBe('fits')
    })

    it('is tight above 90 % of the limit and not at it', () => {
      expect(rowKind(animated(900_000, 460_800), sticker, 'discord')).toBe('fits')
      expect(rowKind(animated(900_000, 460_801), sticker, 'discord')).toBe('tight')
      expect(rowKind(animated(900_000, 512_000), sticker, 'discord')).toBe('tight')
    })

    it('is over when the pipeline says it did not fit, whatever the original weighed', () => {
      expect(rowKind(animated(900_000, 600_000, { withinBudget: false }), sticker, 'discord')).toBe(
        'over',
      )
      expect(rowKind(animated(100, 600_000, { withinBudget: false }), sticker, 'discord')).toBe(
        'over',
      )
    })

    it('reads the limit of the destination: the emoji one is half the sticker one', () => {
      expect(rowKind(animated(900_000, 300_000), sticker, 'discord')).toBe('fits')
      expect(rowKind(animated(900_000, 240_000), emoji, 'discord')).toBe('tight')
      expect(rowKind(animated(900_000, 230_400), emoji, 'discord')).toBe('fits')
    })

    it('still follows the queue while there is no result', () => {
      expect(rowKind(pending, sticker, 'discord')).toBe('pending')
      expect(rowKind({ ...pending, status: 'cancelled' }, sticker, 'discord')).toBe('cancelled')
    })
  })

  describe('the weight bar', () => {
    it('is scaled to the limit, not to the original', () => {
      const bar = weightBar(animated(5_000_000, 256_000), sticker)

      expect(bar?.fill).toBeCloseTo(0.5)
      // The limit is the end of the track.
      expect(bar?.mark).toBe(1)
      expect(bar?.overflow).toBeNull()
    })

    it('reads the same for a small original as for a big one', () => {
      expect(weightBar(animated(1_000, 256_000), sticker)).toEqual(
        weightBar(animated(9_000_000, 256_000), sticker),
      )
    })

    it('stretches the track past the limit and hatches the stretch', () => {
      const bar = weightBar(animated(900_000, 768_000), sticker)

      // 768 000 against 512 000: the limit falls two thirds along.
      expect(bar?.fill).toBe(1)
      expect(bar?.mark).toBeCloseTo(2 / 3)
      expect(bar?.overflow?.start).toBeCloseTo(2 / 3)
      expect((bar?.overflow?.start ?? 0) + (bar?.overflow?.width ?? 0)).toBeCloseTo(1)
    })

    it('is full but not over when the file weighs exactly the limit', () => {
      const bar = weightBar(animated(900_000, 512_000), sticker)

      expect(bar?.fill).toBe(1)
      expect(bar?.overflow).toBeNull()
    })

    it('has an empty track at the limit while it waits, and none once it failed', () => {
      expect(weightBar(pending, sticker)).toEqual({ fill: 0, mark: 1, overflow: null })
      expect(
        weightBar({ ...pending, status: 'failed', error: { code: 'empty-file' } }, sticker),
      ).toBeNull()
    })
  })

  describe('the row note', () => {
    it('lists the numbers and what was given up, in words', () => {
      const item = animated(900_000, 400_000, {}, [
        { kind: 'palette', colors: 64 },
        { kind: 'fps', from: 15, to: 10 },
      ])

      expect(rowNote(item, formatters, es, 'discord', sticker.maxBytes)).toBe(
        '10 fps · 64 colores · lienzo 320 × 320 · paleta de 64 colores · se bajó a 10 fps',
      )
    })

    it('leads with the verdict, the final weight and the limit when it does not fit', () => {
      const item = animated(900_000, 600_000, { withinBudget: false })
      const note = rowNote(item, formatters, es, 'discord', sticker.maxBytes)

      expect(note.startsWith('No entra en el límite de 512 KB')).toBe(true)
      expect(note).toContain('600 KB')
      expect(note).toContain('10 fps')
    })

    it('names the emoji limit, not the sticker one', () => {
      const item = animated(900_000, 300_000, { withinBudget: false })

      expect(rowNote(item, formatters, es, 'discord', emoji.maxBytes)).toContain('256 KB')
      expect(rowNote(item, formatters, en, 'discord', emoji.maxBytes)).toContain(
        'Does not fit the limit of 256 KB',
      )
    })
  })

  describe('the details', () => {
    const labelled = (item: QueueItem, profile: Profile) =>
      Object.fromEntries(
        rowDetails(item, profile, formatters, es, 'discord').map((row) => [row.label, row]),
      )

    it('adds what the animation is: frames, duration, rate, colours and steps', () => {
      const rows = labelled(
        animated(900_000, 400_000, {}, [{ kind: 'fps', from: 15, to: 10 }]),
        sticker,
      )

      expect(rows['Fotogramas']?.value).toBe('20')
      expect(rows['Duración']?.value).toMatch(/^2.?000 ms$/)
      expect(rows['Fotogramas por segundo']?.value).toBe('10')
      expect(rows['Colores']?.value).toBe('64')
      expect(rows['Se ajustó']?.value).toBe('se bajó a 10 fps')
    })

    it('measures the margin against the limit and not against the original', () => {
      // A 30 KB original: measured against it, this would have read as an excess.
      const rows = labelled(animated(30_000, 200_000), sticker)

      expect(rows['Margen']?.value).toBe('312 KB')
      expect(rows['Exceso']).toBeUndefined()
    })

    it('reports the excess of a file that did not fit, in the failing tone', () => {
      const rows = labelled(animated(900_000, 600_000, { withinBudget: false }), sticker)

      expect(rows['Exceso']).toMatchObject({ value: '88 KB', kind: 'over' })
    })

    it('keeps the saving column honest: a result that grew shows the sign', () => {
      const rows = labelled(animated(30_000, 200_000), sticker)

      expect(rows['Ahorro']?.value).toMatch(/[-−]/)
    })
  })
})
