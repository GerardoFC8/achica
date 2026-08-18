import { describe, expect, it } from 'vitest'
import type { GenericProfile } from '../core/profiles'
import type { QueueItem } from '../state/queue'
import { createFormatters, DEFAULT_LOCALE } from './format'
import { rowKind, rowNote, weightBar } from './row-model'

/**
 * The weight bar is the one distinctive element in the interface, so its
 * geometry is arithmetic that lives here and is tested here, not something
 * a component works out while rendering.
 */

const BUDGETED: GenericProfile = {
  id: 'correo-adjunto',
  label: 'Adjunto de correo',
  group: 'Correo',
  format: 'jpeg',
  maxBytes: 500_000,
  stripMetadata: true,
}

const UNBUDGETED: GenericProfile = {
  id: 'web-articulo',
  label: 'Imagen para artículo web',
  group: 'Web',
  format: 'webp',
  maxWidth: 1600,
  stripMetadata: true,
}

const SOURCE = new File([new Uint8Array(8)], 'foto.jpg')

function done(bytesBefore: number, bytesAfter: number, shrunk = false): QueueItem {
  return {
    id: 'a',
    file: SOURCE,
    name: 'foto.jpg',
    bytesBefore,
    status: 'done',
    blob: new Blob([new Uint8Array(bytesAfter)]),
    ms: 42,
    outcome: {
      format: 'jpeg',
      bytesBefore,
      bytesAfter,
      width: 1280,
      height: 853,
      quality: 70,
      withinBudget: true,
      shrunkForBudget: shrunk ? { width: 1280, height: 853 } : null,
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
    expect(rowKind(pending, BUDGETED)).toBe('pending')
    expect(rowKind({ ...pending, status: 'running' }, BUDGETED)).toBe('running')
    expect(rowKind({ ...pending, status: 'cancelled' }, BUDGETED)).toBe('cancelled')
  })

  it('is failed for a file that produced nothing', () => {
    const item: QueueItem = {
      ...pending,
      status: 'failed',
      error: { code: 'empty-file' },
    }

    expect(rowKind(item, BUDGETED)).toBe('failed')
  })

  it('says it fits when the result lands well short of the budget', () => {
    expect(rowKind(done(1_000_000, 200_000), BUDGETED)).toBe('fits')
  })

  it('says it is tight inside the last tenth before the budget', () => {
    // Budget mark sits at 0.5 of the original; 0.47 is inside the last 10%.
    expect(rowKind(done(1_000_000, 470_000), BUDGETED)).toBe('tight')
  })

  it('says it did not fit when the result passes the budget', () => {
    expect(rowKind(done(1_000_000, 620_000), BUDGETED)).toBe('over')
  })

  it('treats any real shrink as fitting when the profile sets no budget', () => {
    expect(rowKind(done(1_000_000, 300_000), UNBUDGETED)).toBe('fits')
  })

  it('says it did not fit when a budgetless result grew', () => {
    // No budget to miss, but the tool exists to make files smaller. A result
    // that grew failed at the only thing it was asked to do.
    expect(rowKind(done(1_000_000, 1_200_000), UNBUDGETED)).toBe('over')
  })
})

describe('weightBar', () => {
  it('puts the budget mark where the budget falls against the original', () => {
    const bar = weightBar(done(1_000_000, 200_000), BUDGETED)

    expect(bar?.mark).toBeCloseTo(0.5)
    expect(bar?.fill).toBeCloseTo(0.2)
    expect(bar?.overflow).toBeNull()
  })

  it('caps the mark at the original size, because a budget is a ceiling', () => {
    // D24: asked for 500 KB with a 300 KB photo, the effective budget is the
    // photo. The mark belongs at the right edge, not off the track.
    const bar = weightBar(done(300_000, 120_000), BUDGETED)

    expect(bar?.mark).toBe(1)
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
    expect(rowNote(pending, formatters)).toBe('En cola')
    expect(rowNote({ ...pending, status: 'running' }, formatters)).toBe('Comprimiendo')
    expect(rowNote({ ...pending, status: 'cancelled' }, formatters)).toBe('Cancelado')
  })

  it('shows the output dimensions once there is a result', () => {
    expect(rowNote(done(1_000_000, 200_000), formatters)).toBe('1,280 × 853')
  })

  it('says outright when the image was shrunk to fit', () => {
    // The user has to learn this here, not when they open the file.
    expect(rowNote(done(1_000_000, 200_000, true), formatters)).toBe(
      'Se redujo a 1,280 × 853 para entrar',
    )
  })

  it('explains the failure in words', () => {
    const item: QueueItem = { ...pending, status: 'failed', error: { code: 'empty-file' } }

    expect(rowNote(item, formatters)).toBe('Archivo vacío, no hay nada que comprimir')
  })
})
