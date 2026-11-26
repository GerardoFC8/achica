import { describe, expect, it } from 'vitest'
import type { Profile } from '../core/profiles'
import type { QueueItem } from '../state/queue'
import { en, es } from './copy'
import { createFormatters, DEFAULT_LOCALE } from './format'
import { profileForFormat } from './format-choice'
import { profileForResize } from './resize-choice'
import { rowDetails, rowKind, rowNote, savedRatio, weightBar } from './row-model'

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
