import { describe, expect, it } from 'vitest'
import { classifyRequest } from './network-audit'

const ORIGIN = 'https://achica.gfcode.dev'

describe('classifyRequest', () => {
  it('counts our own assets as ours', () => {
    expect(classifyRequest(`${ORIGIN}/`, ORIGIN)).toBe('own')
    expect(classifyRequest(`${ORIGIN}/assets/index-abc.js`, ORIGIN)).toBe('own')
    expect(classifyRequest(`${ORIGIN}/assets/squoosh_png_bg-abc.wasm`, ORIGIN)).toBe('own')
  })

  it('separates the edge scripts Cloudflare injects on our origin', () => {
    expect(
      classifyRequest(`${ORIGIN}/cdn-cgi/challenge-platform/scripts/jsd/main.js`, ORIGIN),
    ).toBe('edge')
    expect(classifyRequest(`${ORIGIN}/cdn-cgi/rum?`, ORIGIN)).toBe('edge')
  })

  it('flags anything off-origin as third party, which is the number that matters', () => {
    expect(classifyRequest('https://static.cloudflareinsights.com/beacon.min.js', ORIGIN)).toBe(
      'thirdParty',
    )
    expect(classifyRequest('https://fonts.googleapis.com/css2?family=Inter', ORIGIN)).toBe(
      'thirdParty',
    )
  })

  it('does not mistake a lookalike origin for ours', () => {
    expect(classifyRequest('https://achica.gfcode.dev.evil.com/x.js', ORIGIN)).toBe('thirdParty')
  })
})
