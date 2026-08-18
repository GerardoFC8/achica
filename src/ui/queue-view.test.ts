import { describe, expect, it } from 'vitest'
import type { GenericProfile } from '../core/profiles'
import type { QueueItem } from '../state/queue'
import { buildRows, countsOf, visibleRows } from './queue-view'

/**
 * Filtering and sorting a queue of three hundred rows is where a table stops
 * being a list and starts being useful. It is also plain arithmetic over an
 * array, so it is decided here rather than inside a component.
 */

const PROFILE: GenericProfile = {
  id: 'correo-adjunto',
  label: 'Adjunto de correo',
  group: 'Correo',
  format: 'jpeg',
  maxBytes: 500_000,
  stripMetadata: true,
}

const source = (name: string): File => new File([new Uint8Array(4)], name)

function done(id: string, name: string, before: number, after: number, ms: number): QueueItem {
  return {
    id,
    file: source(name),
    name,
    bytesBefore: before,
    status: 'done',
    blob: new Blob([new Uint8Array(1)]),
    ms,
    outcome: {
      format: 'jpeg',
      bytesBefore: before,
      bytesAfter: after,
      width: 800,
      height: 600,
      quality: 70,
      withinBudget: true,
      shrunkForBudget: null,
      encodes: 2,
    },
  }
}

const ITEMS: readonly QueueItem[] = [
  done('1', 'zeta.jpg', 1_000_000, 100_000, 300), // fits
  done('2', 'alfa.jpg', 1_000_000, 470_000, 100), // tight
  done('3', 'beta.jpg', 1_000_000, 700_000, 200), // over
  {
    id: '4',
    file: source('roto.png'),
    name: 'roto.png',
    bytesBefore: 900,
    status: 'failed',
    error: { code: 'empty-file' },
  },
  { id: '5', file: source('corta.jpg'), name: 'corta.jpg', bytesBefore: 900, status: 'cancelled' },
  { id: '6', file: source('espera.jpg'), name: 'espera.jpg', bytesBefore: 900, status: 'pending' },
  { id: '7', file: source('corre.jpg'), name: 'corre.jpg', bytesBefore: 900, status: 'running' },
]

const rows = buildRows(ITEMS, PROFILE)
const namesOf = (list: ReturnType<typeof visibleRows>): string[] => list.map((row) => row.item.name)

describe('countsOf', () => {
  it('counts every outcome the filters offer', () => {
    expect(countsOf(rows)).toEqual({
      todos: 7,
      fits: 1,
      tight: 1,
      over: 1,
      failed: 1,
      cancelled: 1,
      pending: 2,
    })
  })

  it('counts a running file as still pending, because it has not landed', () => {
    expect(countsOf(rows).pending).toBe(2)
  })
})

describe('visibleRows', () => {
  it('keeps the drop order until asked otherwise', () => {
    const list = visibleRows(rows, { filter: 'todos', sortKey: 'orden', direction: 'asc' })

    expect(namesOf(list)).toEqual(ITEMS.map((item) => item.name))
  })

  it('narrows to one outcome', () => {
    const list = visibleRows(rows, { filter: 'over', sortKey: 'orden', direction: 'asc' })

    expect(namesOf(list)).toEqual(['beta.jpg'])
  })

  it('sorts by name without minding case', () => {
    const list = visibleRows(rows, { filter: 'todos', sortKey: 'name', direction: 'asc' })

    expect(namesOf(list)[0]).toBe('alfa.jpg')
  })

  it('sorts by weight, largest first when reversed', () => {
    const list = visibleRows(rows, { filter: 'todos', sortKey: 'before', direction: 'desc' })

    expect(list[0]?.item.bytesBefore).toBe(1_000_000)
  })

  it('sends rows with no result to the end, whichever way it is sorted', () => {
    // A file still in the queue has no saving to compare. Sorting it to the
    // top as if it saved nothing would bury the results the user is reading.
    const ascending = visibleRows(rows, { filter: 'todos', sortKey: 'saved', direction: 'asc' })
    const descending = visibleRows(rows, { filter: 'todos', sortKey: 'saved', direction: 'desc' })

    expect(namesOf(ascending).slice(-4)).toEqual([
      'roto.png',
      'corta.jpg',
      'espera.jpg',
      'corre.jpg',
    ])
    expect(namesOf(descending).slice(-4)).toEqual([
      'roto.png',
      'corta.jpg',
      'espera.jpg',
      'corre.jpg',
    ])
  })

  it('breaks ties by the order the files were dropped', () => {
    const list = visibleRows(rows, { filter: 'pending', sortKey: 'time', direction: 'asc' })

    expect(namesOf(list)).toEqual(['espera.jpg', 'corre.jpg'])
  })

  it('sorts the biggest saving first when reversed', () => {
    const list = visibleRows(rows, { filter: 'todos', sortKey: 'saved', direction: 'desc' })

    expect(namesOf(list)[0]).toBe('zeta.jpg')
  })
})
