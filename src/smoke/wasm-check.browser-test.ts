import { describe, expect, it } from 'vitest'
import { runWasmSmoke } from './wasm-check'

/**
 * Covers the half of the smoke that does not depend on the host: the codec
 * loads and decodes correctly.
 *
 * The other half — the Content-Type the host attaches to .wasm and whether
 * the page ends up cross-origin isolated — can only be observed on the
 * deployed URL, which is why the smoke page reports it there too.
 */
describe('wasm smoke', () => {
  it('decodes a real PNG through the wasm codec', async () => {
    const report = await runWasmSmoke()

    expect(report.error).toBeNull()
    expect(report.decoded).toBe(true)
    expect(report.pixelsMatch).toBe(true)
  })
})
