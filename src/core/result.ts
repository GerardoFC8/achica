/**
 * The result type the whole of core/ reports failure with.
 *
 * The spec is explicit that a corrupt file must produce a typed error and not
 * an exception, and the reason is the batch: one bad photo among three hundred
 * must mark that row and let the queue continue. Exceptions unwind, and code
 * that unwinds by default ends up wrapped in try/catch at every call site
 * until someone forgets one and the whole batch dies.
 *
 * Failures here are values. They are checked by the type system, they cannot
 * be ignored without the compiler noticing, and they carry a code rather than
 * a sentence — the wording belongs to the interface, which is also what lets
 * the same failure be shown in Spanish or English later.
 */

export type Result<T, E> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E }

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value }
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error }
}
