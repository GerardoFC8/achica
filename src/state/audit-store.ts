import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import type { HarSkipped } from '../core/har'

/**
 * What the audit knows besides the queue (D60): the entries that could not be
 * measured, the counters, and where each queued file came from.
 *
 * Only text and numbers live here. The images themselves are in the queue as
 * Files, and the parsed HAR is gone once these are extracted, so nothing from
 * the export survives except what is meant to be shown. In particular there is
 * no header, cookie or query string to keep: the reader never copied them.
 */
export type AuditData = {
  /** Every entry of the HAR, images or not. */
  readonly entryCount: number
  /** Unique image URLs: the ones measured plus the ones that could not be. */
  readonly imageCount: number
  readonly measurableCount: number
  /** Weight of the measurable images, as stored in the HAR. */
  readonly measurableBytes: number
  readonly duplicatesIgnored: number
  readonly skipped: readonly HarSkipped[]
  /** File name in the queue to its display URL (no query, no credentials). */
  readonly origins: ReadonlyMap<string, string>
}

type AuditState = {
  readonly audit: AuditData | null
  set(audit: AuditData): void
  clear(): void
}

export const auditStore = createStore<AuditState>()((set) => ({
  audit: null,
  set: (audit) => set({ audit }),
  clear: () => set({ audit: null }),
}))

export function useAudit<T>(select: (state: AuditState) => T): T {
  return useStore(auditStore, select)
}

export const auditActions = {
  set: (audit: AuditData) => auditStore.getState().set(audit),
  clear: () => auditStore.getState().clear(),
}
