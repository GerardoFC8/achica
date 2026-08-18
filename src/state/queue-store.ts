import { useStore } from 'zustand'
import { createPool, poolConcurrency } from '../workers/pool'
import { createWorkerRunner } from '../workers/runner'
import { createQueueStore, type QueueState } from './queue'

/**
 * The application's one queue.
 *
 * Built at module load, but nothing starts here: the pool spawns a worker only
 * when it has a file for it, so importing this costs a few objects and no wasm.
 */
export const queueStore = createQueueStore({
  createPool: (onEvent) =>
    createPool({
      concurrency: poolConcurrency(navigator.hardwareConcurrency),
      createRunner: createWorkerRunner,
      onEvent,
    }),
  newId: () => crypto.randomUUID(),
})

/**
 * Selector-based on purpose. A queue of two hundred rows changes constantly,
 * and a component that subscribes to the whole state re-renders on every
 * event; one that subscribes to a slice re-renders when that slice moves.
 */
export function useQueue<T>(select: (state: QueueState) => T): T {
  return useStore(queueStore, select)
}

/** The actions never change identity, so they are read once and not subscribed. */
export const queueActions = {
  add: (...args: Parameters<QueueState['add']>) => queueStore.getState().add(...args),
  start: (...args: Parameters<QueueState['start']>) => queueStore.getState().start(...args),
  requeue: (...args: Parameters<QueueState['requeue']>) => queueStore.getState().requeue(...args),
  cancel: (...args: Parameters<QueueState['cancel']>) => queueStore.getState().cancel(...args),
  cancelAll: () => queueStore.getState().cancelAll(),
  remove: (...args: Parameters<QueueState['remove']>) => queueStore.getState().remove(...args),
  clear: () => queueStore.getState().clear(),
}
