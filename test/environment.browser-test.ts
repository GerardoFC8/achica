import { describe, expect, it } from 'vitest'

/**
 * The browser project exists because of exactly these globals.
 *
 * Node 24 reports ImageData, ImageBitmap, OffscreenCanvas and
 * createImageBitmap as undefined, and @jsquash decodes to ImageData. This
 * test is the counterpart to that fact: it proves the browser project really
 * runs in a browser, so phase 1 codec tests have somewhere to live.
 */
describe('browser test project', () => {
  it('provides the image primitives Node lacks', () => {
    expect(typeof ImageData).toBe('function')
    expect(typeof ImageBitmap).toBe('function')
    expect(typeof OffscreenCanvas).toBe('function')
    expect(typeof createImageBitmap).toBe('function')
  })

  it('can instantiate WebAssembly by streaming', () => {
    expect(typeof WebAssembly.instantiateStreaming).toBe('function')
  })
})
