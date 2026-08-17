import { describe, expect, it } from 'vitest'
import { classifyRequest, countRequests } from './network-audit'

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

describe('countRequests', () => {
  it('splits a real page load the way DevTools would', () => {
    const urls = [
      `${ORIGIN}/`,
      `${ORIGIN}/assets/index-abc.js`,
      `${ORIGIN}/assets/index-abc.css`,
      `${ORIGIN}/assets/squoosh_png_bg-abc.wasm`,
      `${ORIGIN}/cdn-cgi/challenge-platform/scripts/jsd/main.js`,
      `${ORIGIN}/cdn-cgi/challenge-platform/h/g/jsd/oneshot/abc`,
    ]

    expect(countRequests(urls, ORIGIN, 0)).toEqual({
      own: 4,
      edge: 2,
      thirdParty: 0,
      blindFrames: 0,
    })
  })

  it('counts edge requests that arrived from inside an injected frame', () => {
    // The regression this guards: the edge loads its scripts in a hidden
    // iframe, whose resources never appear in our own performance timeline.
    // Counting only our timeline reported zero while DevTools showed three.
    const ourTimeline = [`${ORIGIN}/`, `${ORIGIN}/assets/index-abc.js`]
    const frameTimeline = [
      `${ORIGIN}/cdn-cgi/challenge-platform/scripts/jsd/main.js`,
      `${ORIGIN}/cdn-cgi/challenge-platform/h/g/scripts/jsd/abc/main.js`,
    ]

    const audit = countRequests([...ourTimeline, ...frameTimeline], ORIGIN, 0)

    expect(audit.edge).toBe(2)
    expect(audit.own).toBe(2)
  })

  it('reports frames it could not inspect instead of pretending they are clean', () => {
    expect(countRequests([`${ORIGIN}/`], ORIGIN, 2).blindFrames).toBe(2)
  })

  it('keeps thirdParty at zero only when nothing left the origin', () => {
    const clean = countRequests([`${ORIGIN}/`, `${ORIGIN}/cdn-cgi/x.js`], ORIGIN, 0)
    const dirty = countRequests(
      [`${ORIGIN}/`, 'https://static.cloudflareinsights.com/b.js'],
      ORIGIN,
      0,
    )

    expect(clean.thirdParty).toBe(0)
    expect(dirty.thirdParty).toBe(1)
  })
})
