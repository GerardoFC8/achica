import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

/**
 * The project's hard rules are that core/ stays pure — no React, no store, no
 * DOM, no imports from the layers above it — and that nothing under src/
 * reaches for a Node builtin, because src/ ships to a browser.
 *
 * eslint.config.js enforces both. This test guards the enforcement itself, so
 * that loosening the config fails here instead of silently allowing the
 * architecture to rot.
 */

const FRAMEWORK_AND_DOM = `import { useState } from 'react'
import { useQueueStore } from '../state/queue'

export function bad(): number {
  void useState
  void useQueueStore
  return window.innerWidth + navigator.hardwareConcurrency
}
`

const NODE_BUILTIN = `import { readFile } from 'node:fs/promises'

export function alsoBad(): Promise<unknown> {
  return readFile('somewhere')
}
`

async function ruleIdsFor(source: string, filePath: string): Promise<string[]> {
  const results = await new ESLint().lintText(source, { filePath })
  return results.flatMap((result) => result.messages.map((message) => message.ruleId ?? ''))
}

describe('core/ architectural boundary', () => {
  it('rejects React, sideways imports and DOM globals inside core/', async () => {
    const ruleIds = await ruleIdsFor(FRAMEWORK_AND_DOM, 'src/core/probe.ts')

    expect(ruleIds).toContain('no-restricted-imports')
    expect(ruleIds).toContain('no-restricted-globals')
  })

  it('allows the same code outside core/, where the DOM is legitimate', async () => {
    const ruleIds = await ruleIdsFor(FRAMEWORK_AND_DOM, 'src/ui/probe.ts')

    expect(ruleIds).not.toContain('no-restricted-imports')
    expect(ruleIds).not.toContain('no-restricted-globals')
  })
})

describe('browser boundary', () => {
  it.each(['src/core/probe.ts', 'src/ui/probe.ts', 'src/output/probe.ts'])(
    'rejects Node builtins in %s',
    async (filePath) => {
      expect(await ruleIdsFor(NODE_BUILTIN, filePath)).toContain('no-restricted-imports')
    },
  )

  it('still rejects React inside core/ once the Node rule is added', async () => {
    // Flat config overrides rules rather than merging them, so the core/ block
    // has to carry every restricted-import pattern, not just its own. This is
    // the assertion that catches someone re-adding the rule in a way that
    // silently drops the framework ban.
    const ruleIds = await ruleIdsFor(FRAMEWORK_AND_DOM, 'src/core/probe.ts')
    const messages = await new ESLint().lintText(FRAMEWORK_AND_DOM, {
      filePath: 'src/core/probe.ts',
    })
    const text = messages.flatMap((r) => r.messages.map((m) => m.message)).join('\n')

    expect(ruleIds).toContain('no-restricted-imports')
    expect(text).toContain('framework-free')
  })

  it('allows Node builtins in test/ and scripts/, which run in Node', async () => {
    expect(await ruleIdsFor(NODE_BUILTIN, 'test/probe.ts')).not.toContain('no-restricted-imports')
  })
})
