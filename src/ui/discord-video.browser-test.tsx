import '../styles.css'
import { page, userEvent } from 'vitest/browser'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { loadFixture } from '../../test/helpers/animation-fixtures'
import { queueStore } from '../state/queue-store'
import { App } from './App'
import { CopyProvider, en } from './copy'
import { saveList } from './save-list'

/**
 * A video on the Discord page, through the real everything: the page, the
 * queue, the extractor playing a real <video> on the main thread, the worker
 * and the encoders.
 *
 * The parsing of the three numbers and the arithmetic of the row are covered in
 * Node. Not covered anywhere: that Discord accepts the output, HEVC, Safari.
 */

async function file(name: string): Promise<File> {
  return new File([await loadFixture(name)], name)
}

const bytesOf = async (blob: Blob): Promise<Uint8Array> => new Uint8Array(await blob.arrayBuffer())

const gifScreen = (bytes: Uint8Array): { width: number; height: number } => ({
  width: (bytes[6] ?? 0) | ((bytes[7] ?? 0) << 8),
  height: (bytes[8] ?? 0) | ((bytes[9] ?? 0) << 8),
})

beforeEach(() => {
  queueStore.getState().clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

/** Opens the destination panel, sets the three fields, and closes it again. */
async function setSegment(start: string, length: string, fps: string): Promise<void> {
  await userEvent.click(page.getByRole('button', { name: /^Destino/ }))
  await userEvent.fill(page.getByLabelText('Inicio (s)'), start)
  await userEvent.fill(page.getByLabelText('Duración (s)'), length)
  await userEvent.fill(page.getByLabelText('Fotogramas por segundo'), fps)
  await userEvent.keyboard('{Escape}')
}

describe('the Video section of the destination panel', () => {
  it('starts on 0 / 5 / 15, says whose the cap is, and is reachable by label', async () => {
    render(<App tool="discord" />)
    await userEvent.click(page.getByRole('button', { name: /^Destino/ }))

    await expect.element(page.getByLabelText('Inicio (s)')).toHaveValue('0')
    await expect.element(page.getByLabelText('Duración (s)')).toHaveValue('5')
    await expect.element(page.getByLabelText('Fotogramas por segundo')).toHaveValue('15')
    await expect.element(page.getByText(/es de achica, no de Discord/)).toBeVisible()
  })

  it('accepts a decimal comma, refuses what is not a number and cuts what is too big', async () => {
    render(<App tool="discord" />)
    await userEvent.click(page.getByRole('button', { name: /^Destino/ }))

    const length = page.getByLabelText('Duración (s)')
    await userEvent.fill(length, '2,5')
    await expect.element(page.getByText(/Se ajustó/)).not.toBeInTheDocument()
    await expect.element(length).toHaveValue('2,5')

    await userEvent.fill(length, 'mucho')
    await expect.element(page.getByText(/Eso no es un número/)).toBeVisible()
    await expect.element(length).toHaveAttribute('aria-invalid', 'true')

    await userEvent.fill(length, '99')
    await expect.element(page.getByText(/Duración \(s\): Se ajustó a 15 s/)).toBeVisible()

    // Leaving the field writes back the value that will be used.
    await userEvent.click(page.getByLabelText('Inicio (s)'))
    await expect.element(length).toHaveValue('15')

    await userEvent.fill(page.getByLabelText('Inicio (s)'), '-1')
    await expect.element(page.getByText(/No puede ser negativo/)).toBeVisible()
  })

  it('speaks English on the English page', async () => {
    render(
      <CopyProvider value={en}>
        <App tool="discord" />
      </CopyProvider>,
    )
    await userEvent.click(page.getByRole('button', { name: /^Destination/ }))
    await expect.element(page.getByLabelText('Start (s)')).toHaveValue('0')
    await expect.element(page.getByText(/not Discord/)).toBeVisible()
  })
})

describe('a WebM video', () => {
  it(
    'becomes a 320 x 320 .gif of the chosen segment, and the row says which one',
    { timeout: 120_000 },
    async () => {
      render(<App tool="discord" />)
      queueStore.getState().add([await file('video-gray-steps.webm')])
      await setSegment('0', '1', '8')

      await userEvent.click(page.getByRole('button', { name: /Preparar 1 animación/ }))
      await expect.element(page.getByText(/1 animación lista/), { timeout: 100_000 }).toBeVisible()

      const [item] = queueStore.getState().items
      expect(item?.status).toBe('done')
      if (item?.status !== 'done') return

      expect(item.outcome.format).toBe('gif')
      expect(item.outcome.withinBudget).toBe(true)
      expect(item.blob.size).toBeLessThanOrEqual(512_000)
      const bytes = await bytesOf(item.blob)
      expect(new TextDecoder().decode(bytes.subarray(0, 6))).toBe('GIF89a')
      expect(gifScreen(bytes)).toEqual({ width: 320, height: 320 })
      expect(saveList(queueStore.getState().items).map((saved) => saved.name)).toEqual([
        'video-gray-steps.gif',
      ])
      expect(item.outcome.animation?.clip).toMatchObject({ startSeconds: 0 })
      expect(item.outcome.animation?.clip?.lengthSeconds).toBeCloseTo(1, 1)

      // The row says what was kept, as a fact.
      await expect.element(page.getByText(/Tramo de 0 a 1 s de 2 s/).first()).toBeVisible()

      // The unfolded detail carries the segment: start, length used, original.
      await userEvent.click(
        page.getByRole('button', { name: 'video-gray-steps.webm', exact: true }),
      )
      await expect.element(page.getByText('Tramo del video')).toBeVisible()
      await expect.element(page.getByText('desde 0 s, 1 s de 2 s')).toBeVisible()
    },
  )

  it(
    'keeps its verdict, bar and margin when another destination is selected afterwards',
    { timeout: 120_000 },
    async () => {
      render(<App tool="discord" />)
      queueStore.getState().add([await file('video-gray-steps.webm')])
      await setSegment('0', '1', '8')
      await userEvent.click(page.getByRole('button', { name: /Preparar 1 animación/ }))
      await expect.element(page.getByText(/1 animación lista/), { timeout: 100_000 }).toBeVisible()
      await userEvent.click(
        page.getByRole('button', { name: 'video-gray-steps.webm', exact: true }),
      )

      // Made for the sticker (512 KB): the bar names that limit.
      await expect.element(page.getByRole('img', { name: /con un límite de 512 KB/ })).toBeVisible()
      await expect.element(page.getByText(/otro destino/)).not.toBeInTheDocument()

      // Now the emoji (256 KB) is selected. Nothing about the row may change
      // its verdict or its measure, and it says it was made for another one.
      await userEvent.click(page.getByRole('button', { name: /^Destino/ }))
      await userEvent.click(page.getByRole('button', { name: /Emoji animado de Discord/ }))

      await expect.element(page.getByRole('img', { name: /con un límite de 512 KB/ })).toBeVisible()
      await expect.element(page.getByText(/^con margen/)).toBeVisible()
      await expect.element(page.getByText(/procesada con otro destino/).first()).toBeVisible()
      await expect.element(page.getByText('Margen', { exact: true })).toBeVisible()
      await expect.element(page.getByText('Exceso', { exact: true })).not.toBeInTheDocument()
    },
  )
})

describe('an MP4 video', () => {
  const canPlay = document.createElement('video').canPlayType('video/mp4; codecs="avc1.42E01E"')
  if (canPlay === '') {
    console.warn(
      'SKIPPED: this browser cannot play H.264 in MP4, so the MP4 page test does not run.',
    )
  }

  it.skipIf(canPlay === '')(
    'goes through the same page and comes out as a .gif',
    { timeout: 120_000 },
    async () => {
      render(<App tool="discord" />)
      queueStore.getState().add([await file('video-gray-steps.mp4')])
      await setSegment('0', '1', '8')
      await userEvent.click(page.getByRole('button', { name: /Preparar 1 animación/ }))
      await expect.element(page.getByText(/1 animación lista/), { timeout: 100_000 }).toBeVisible()
      await expect.element(page.getByText(/Tramo de 0 a 1 s de 2 s/).first()).toBeVisible()
    },
  )
})

describe('what cannot be made from a video', () => {
  it(
    'fails an audio-only file with the way out, and finishes the rest of the batch',
    { timeout: 100_000 },
    async () => {
      render(<App tool="discord" />)
      queueStore.getState().add([await file('audio-only.m4a'), await file('anim-opaque.gif')])

      await userEvent.click(page.getByRole('button', { name: /Preparar 2 animaciones/ }))
      await expect
        .element(page.getByText(/no tiene imagen, solo audio.*MP4 o WebM/).first(), {
          timeout: 80_000,
        })
        .toBeVisible()
      await expect.element(page.getByText(/1 animación lista/), { timeout: 80_000 }).toBeVisible()

      const [audio, gif] = queueStore.getState().items
      expect(audio?.status).toBe('failed')
      expect(gif?.status).toBe('done')
      if (audio?.status === 'failed') expect(audio.error.code).toBe('video-failed')
    },
  )
})
