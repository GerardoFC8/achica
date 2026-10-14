import { describe, expect, it } from 'vitest'
import { PERFILES, type Profile } from '../core/profiles'
import { NO_BUDGET, parseKilobytes, planFor, withBudget } from './budget'

const WEB = PERFILES[0] as Profile
const KEEPS_FORMAT = PERFILES.find((profile) => profile.format === 'keep') as Profile

describe('withBudget', () => {
  it('leaves the destination alone when there is no ceiling', () => {
    expect(withBudget(WEB, NO_BUDGET)).toBe(WEB)
  })

  it('folds the ceiling in and keeps everything the destination decided', () => {
    const budgeted = withBudget(KEEPS_FORMAT, { maxBytes: 200_000, png: 'webp' })

    expect(budgeted.maxBytes).toBe(200_000)
    expect(budgeted.format).toBe(KEEPS_FORMAT.format)
    expect(budgeted.maxWidth).toBe(KEEPS_FORMAT.maxWidth)
    expect(budgeted.quality).toBe(KEEPS_FORMAT.quality)
  })
})

describe('planFor', () => {
  it('asks for no ceiling and no conversion when none was set', () => {
    const plan = planFor(KEEPS_FORMAT, NO_BUDGET)

    expect(plan.maxBytes).toBeUndefined()
    expect(plan.losslessUnderBudget).toBeUndefined()
  })

  it('lets a PNG turn into WebP to meet the ceiling, by default', () => {
    const plan = planFor(KEEPS_FORMAT, { maxBytes: 100_000, png: 'webp' })

    expect(plan.maxBytes).toBe(100_000)
    expect(plan.format).toBe('keep')
    expect(plan.losslessUnderBudget).toBe('webp')
  })

  it('keeps the PNG when the user says so, which leaves shrinking as the lever', () => {
    const plan = planFor(KEEPS_FORMAT, { maxBytes: 100_000, png: 'keep' })

    expect(plan.maxBytes).toBe(100_000)
    expect(plan.losslessUnderBudget).toBeUndefined()
  })
})

describe('parseKilobytes', () => {
  it('reads kilobytes as thousands of bytes, like every weight on screen', () => {
    expect(parseKilobytes('150')).toBe(150_000)
    expect(parseKilobytes(' 80 ')).toBe(80_000)
  })

  it('takes a decimal comma as well as a point', () => {
    expect(parseKilobytes('7,5')).toBe(7_500)
    expect(parseKilobytes('7.5')).toBe(7_500)
  })

  it('refuses what is not a usable ceiling', () => {
    for (const text of ['', 'abc', '-50', '0', '2', '1e3', '100 KB', '200000']) {
      expect(parseKilobytes(text), text).toBeNull()
    }
  })
})
