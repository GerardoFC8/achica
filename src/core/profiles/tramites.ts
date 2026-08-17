import type { TramiteProfile } from './types'

/**
 * Paperwork profiles. Deliberately empty.
 *
 * This is the product's differentiator and also the place where it can do the
 * most damage. A profile with a wrong limit is worse than no profile at all:
 * the user finds out it was wrong when their submission is rejected, and by
 * then they trusted us.
 *
 * ------------------------------------------------------------------
 * To add one, all four must be true. No exceptions, no "it's probably
 * still 500 KB", no reading it off a forum post.
 *
 *   1. The limits come from the portal's own form, its official
 *      instructions, or a published regulation. Not from a screenshot,
 *      not from memory, not from another tool's preset.
 *   2. `source` links to that document.
 *   3. `verifiedAt` is the ISO date somebody actually opened it.
 *   4. A comment below records who checked it and what it said, so the
 *      next person can re-check without starting over.
 *
 * These requirements change without notice. Every profile here should be
 * assumed stale until re-verified, which is exactly why the date is
 * mandatory and why the interface shows it.
 * ------------------------------------------------------------------
 *
 * The v1 ships with this list empty and the structure ready. That is a
 * feature: an empty list is honest, and profiles arrive one at a time as each
 * one is confirmed.
 */
export const PERFILES_TRAMITES: readonly TramiteProfile[] = []
