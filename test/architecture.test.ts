import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

/**
 * The project's hard rule is that core/ stays pure: no React, no store, no
 * DOM, no imports from the layers above it.
 *
 * eslint.config.js enforces that. This test guards the enforcement itself,
 * so that loosening the config fails here instead of silently allowing the
 * architecture to rot.
 */

const VIOLATION = `import { useState } from 'react'
import { useQueueStore } from '../state/queue'

export function bad(): number {
  void useState
  void useQueueStore
  return window.innerWidth + navigator.hardwareConcurrency
}
`

async function ruleIdsFor(filePath: string): Promise<string[]> {
  const eslint = new ESLint()
  const results = await eslint.lintText(VIOLATION, { filePath })
  return results.flatMap((result) => result.messages.map((message) => message.ruleId ?? ''))
}

describe('core/ architectural boundary', () => {
  it('rejects React, sideways imports and DOM globals inside core/', async () => {
    const ruleIds = await ruleIdsFor('src/core/probe.ts')

    expect(ruleIds).toContain('no-restricted-imports')
    expect(ruleIds).toContain('no-restricted-globals')
  })

  it('allows the same code outside core/, where the DOM is legitimate', async () => {
    const ruleIds = await ruleIdsFor('src/ui/probe.ts')

    expect(ruleIds).not.toContain('no-restricted-imports')
    expect(ruleIds).not.toContain('no-restricted-globals')
  })
})
