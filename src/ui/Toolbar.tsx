import type { OutputFormat } from '../core/codecs/encode'
import type { Profile } from '../core/profiles'
import type { BudgetChoice } from './budget'
import { useCopy } from './copy'
import { DestinationPicker } from './DestinationPicker'
import { destinationsFor } from './tool-profiles'
import type { Formatters } from './format'
import { FormatPicker } from './FormatPicker'
import type { ResizeChoice } from './resize-choice'
import { ResizePicker } from './ResizePicker'
import { useTool, useToolWords } from './tool-context'
import { ToolNav } from './ToolNav'

/**
 * A toolbar, not a header: the app's name, the one decision the user makes,
 * and the one button that acts on it. No hero, no tagline, nothing centred.
 */

type Props = {
  /** The compressor's destination; the other tools ignore it. */
  readonly destination: Profile
  readonly budget: BudgetChoice
  readonly resize: ResizeChoice
  readonly format: OutputFormat
  readonly canvasReduction: boolean
  readonly formatters: Formatters
  readonly pending: number
  readonly done: number
  readonly running: boolean
  /** Whether to offer the folder road at all; only Chromium has it. */
  readonly canUseFolder: boolean
  readonly onSelectProfile: (profile: Profile) => void
  readonly onBudget: (budget: BudgetChoice) => void
  readonly onResize: (choice: ResizeChoice) => void
  readonly onFormat: (format: OutputFormat) => void
  readonly onCanvasReduction: (allowed: boolean) => void
  readonly onStart: () => void
  readonly onCancelAll: () => void
  readonly onDownload: () => void
  readonly onSaveToFolder: () => void
}

export function Toolbar({
  destination,
  budget,
  resize,
  format,
  canvasReduction,
  formatters,
  pending,
  done,
  running,
  canUseFolder,
  onSelectProfile,
  onBudget,
  onResize,
  onFormat,
  onCanvasReduction,
  onStart,
  onCancelAll,
  onDownload,
  onSaveToFolder,
}: Props) {
  const copy = useCopy()
  const { toolbar } = copy
  const tool = useTool()
  const words = useToolWords()

  return (
    // Wraps instead of overflowing: below md the navigation drops to a second
    // thin line (order-last, full width); from md up it sits beside the name.
    <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-x-4 border-b border-rule px-4">
      <p className="flex h-14 items-center text-[15px] leading-5 font-semibold tracking-tight">
        achica
      </p>

      <div className="order-last basis-full md:order-none md:basis-auto">
        <ToolNav />
      </div>

      {tool === 'comprimir' || tool === 'auditar' || tool === 'discord' ? (
        <DestinationPicker
          selected={destination}
          budget={budget}
          formatters={formatters}
          onSelect={onSelectProfile}
          onBudget={onBudget}
          profiles={destinationsFor(tool)}
          showBudget={tool === 'comprimir'}
          canvasReduction={canvasReduction}
          {...(tool === 'discord' ? { onCanvasReduction } : {})}
        />
      ) : tool === 'redimensionar' ? (
        <ResizePicker choice={resize} formatters={formatters} onChange={onResize} />
      ) : tool === 'quitar-exif' ? (
        // Nothing to choose, so a label and not a button: it only says what
        // the tool does, and it must not look like something to press.
        <p
          title={toolbar.stripTitle}
          className="flex h-8 items-center gap-2 text-[13px] leading-4 text-ink-soft coarse:h-11"
        >
          {toolbar.stripLabel}
        </p>
      ) : (
        <FormatPicker selected={format} formatters={formatters} onSelect={onFormat} />
      )}

      <div className="flex-1" />

      {/* The button says what happens, and the result uses the same word. */}
      {done > 0 && !running ? (
        <>
          {/*
            The folder road first in the markup but second in weight: it is
            the better one for a large batch and the wrong one to force on
            somebody with five photos, who would rather not answer a dialog.
          */}
          {canUseFolder ? (
            <button
              type="button"
              onClick={onSaveToFolder}
              className="h-8 rounded-sm border border-rule px-3 text-[13px] leading-4 hover:border-ink-soft coarse:h-11"
            >
              {toolbar.saveToFolder}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onDownload}
            className="h-8 rounded-sm bg-fits px-3.5 text-[13px] leading-4 font-medium text-paper hover:brightness-110 coarse:h-11"
          >
            {toolbar.download(done, formatters.count(done))}
          </button>
        </>
      ) : null}

      {running ? (
        <button
          type="button"
          onClick={onCancelAll}
          className="h-8 rounded-sm bg-ink px-3.5 text-[13px] leading-4 font-medium text-paper hover:bg-ink-soft coarse:h-11"
        >
          {toolbar.cancel}
        </button>
      ) : pending > 0 ? (
        <button
          type="button"
          onClick={onStart}
          className="h-8 rounded-sm bg-ink px-3.5 text-[13px] leading-4 font-medium text-paper hover:bg-ink-soft coarse:h-11"
        >
          {words.start(pending, formatters.count(pending))}
        </button>
      ) : null}
    </header>
  )
}
