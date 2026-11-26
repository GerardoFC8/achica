import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { QueueItem } from '../state/queue'
import type { ToolId } from '../tools/registry'
import { CopyProvider, es } from './copy'
import { createFormatters, DEFAULT_LOCALE } from './format'
import { QueueRow } from './QueueRow'
import { ToolProvider } from './tool-context'
import { planForTool, profileForTool, type ToolChoices } from './tool-profiles'
import { PERFILES, type Profile } from '../core/profiles'
import { NO_BUDGET } from './budget'
import { DEFAULT_RESIZE } from './resize-choice'
import { DEFAULT_FORMAT } from './format-choice'

const choices: ToolChoices = {
  destination: PERFILES[0] as Profile,
  budget: NO_BUDGET,
  resize: DEFAULT_RESIZE,
  format: DEFAULT_FORMAT,
  canvasReduction: false,
}

const item: QueueItem = {
  id: 'a',
  file: new File([new Uint8Array(4)], 'foto.jpg'),
  name: 'foto.jpg',
  bytesBefore: 1000,
  status: 'done',
  blob: new Blob([new Uint8Array(900)]),
  ms: 5,
  outcome: {
    format: 'jpeg',
    bytesBefore: 1000,
    bytesAfter: 900,
    width: 64,
    height: 32,
    quality: null,
    withinBudget: true,
    shrunkForBudget: null,
    convertedForBudget: false,
    encodes: 0,
  },
}

const html = (tool: ToolId): string =>
  renderToStaticMarkup(
    <CopyProvider value={es}>
      <ToolProvider value={tool}>
        <QueueRow
          item={item}
          kind="done"
          profile={profileForTool(tool, choices)}
          formatters={createFormatters(DEFAULT_LOCALE)}
          selected={false}
          expanded={false}
          onToggleSelect={() => undefined}
          onToggleDetail={() => undefined}
          onCancel={() => undefined}
          onCompare={() => undefined}
          onSave={() => undefined}
        />
      </ToolProvider>
    </CopyProvider>,
  )

describe('the Compare button', () => {
  it('is offered by the tools that change pixels', () => {
    for (const tool of ['comprimir', 'redimensionar', 'convertir'] as const) {
      expect(html(tool), tool).toContain('>Comparar<')
    }
  })

  it('is not offered when the pixels are the same', () => {
    const markup = html('quitar-exif')
    expect(markup).not.toContain('Comparar')
    expect(markup).toContain('>Descargar<')
    expect(planForTool('quitar-exif', choices)).toMatchObject({ format: 'keep', stripOnly: true })
  })
})
