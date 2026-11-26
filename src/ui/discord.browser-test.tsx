import '../styles.css'
import { page, userEvent } from 'vitest/browser'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { encodeGif } from '../core/animation'
import { loadFixture } from '../../test/helpers/animation-fixtures'
import { queueStore } from '../state/queue-store'
import { App } from './App'
import { CopyProvider, en, es } from './copy'
import { saveList } from './save-list'

/**
 * The Discord tool against the real everything: the real worker pool, the real
 * ImageDecoder and the real encoders, in a real Chromium.
 *
 * The arithmetic of the verdict, the bar and the note is covered in Node. What
 * only a browser can say is that an animation dropped on the page comes out as
 * the file Discord is asked for, that the row says what it did, and that the
 * preview does not leak the URL it makes.
 */

async function file(name: string): Promise<File> {
  return new File([await loadFixture(name)], name)
}

/** The logical screen of a GIF, read from its header and not from a decoder. */
const gifScreen = (bytes: Uint8Array): { width: number; height: number } => ({
  width: (bytes[6] ?? 0) | ((bytes[7] ?? 0) << 8),
  height: (bytes[8] ?? 0) | ((bytes[9] ?? 0) << 8),
})

/** An APNG is a PNG with an `acTL` chunk before its first `IDAT`. */
const hasChunk = (bytes: Uint8Array, name: string): boolean =>
  new TextDecoder('latin1').decode(bytes).includes(name)

const bytesOf = async (blob: Blob): Promise<Uint8Array> => new Uint8Array(await blob.arrayBuffer())

/**
 * Noise: every pixel random and every frame different, so nothing in it
 * compresses. Long enough that even the lowest frame rate and the smallest
 * palette cannot bring a sticker under its limit.
 */
function noiseFile(): File {
  const side = 320
  let state = 123_456_789
  const frames = Array.from({ length: 24 }, () => {
    const data = new Uint8ClampedArray(side * side * 4)
    for (let at = 0; at < data.length; at += 4) {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
      data[at] = state >>> 24
      data[at + 1] = (state >>> 16) & 255
      data[at + 2] = (state >>> 8) & 255
      data[at + 3] = 255
    }
    return { data, width: side, height: side, delayMs: 160 }
  })
  const encoded = encodeGif(frames, { maxColors: 256 })
  if (!encoded.ok) throw new Error(encoded.error.detail)
  return new File([encoded.value.bytes], 'ruido.gif')
}

beforeEach(() => {
  queueStore.getState().clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

const SOURCES = ['anim-opaque.gif', 'anim.apng', 'anim.webp'] as const

async function choose(label: RegExp): Promise<void> {
  await userEvent.click(page.getByRole('button', { name: /^Destino/ }))
  await userEvent.click(page.getByRole('button', { name: label }))
}

describe('the empty screen', () => {
  it('asks for an animation, says which kinds, and offers no weight ceiling', async () => {
    render(<App tool="discord" />)

    await expect
      .element(page.getByRole('heading', { level: 1, name: /sticker o emoji de Discord/ }))
      .toBeVisible()
    await expect
      .element(page.getByText('GIF, APNG, WebP animado o video (MP4, WebM)'))
      .toBeVisible()
    await expect.element(page.getByText('Nada sale de tu dispositivo')).toBeVisible()
    // The honest sentence about video: it plays in this tab.
    await expect.element(page.getByText(/se reproduce en esta pestaña.*visible/)).toBeVisible()

    const input = document.querySelector('input[type=file]')
    expect(input?.getAttribute('accept')).toBe(
      'image/gif,image/png,image/webp,video/mp4,video/webm,.gif,.png,.apng,.webp,.mp4,.m4v,.mov,.webm',
    )
    expect(input?.hasAttribute('multiple')).toBe(true)

    await userEvent.click(page.getByRole('button', { name: /^Destino/ }))
    await expect.element(page.getByText('Tope por archivo')).not.toBeInTheDocument()
  })

  it('speaks English on the English page', async () => {
    render(
      <CopyProvider value={en}>
        <App tool="discord" />
      </CopyProvider>,
    )

    await expect
      .element(page.getByRole('heading', { level: 1, name: /Discord sticker or emoji/ }))
      .toBeVisible()
    await expect
      .element(page.getByText('GIF, APNG, animated WebP or video (MP4, WebM)'))
      .toBeVisible()
  })
})

describe('the destination picker', () => {
  it('lists the three destinations, the lightest sticker first, each with its source', async () => {
    render(<App tool="discord" />)

    const toolbarButton = page.getByRole('button', { name: /^Destino/ })
    await expect.element(toolbarButton).toHaveTextContent('Sticker animado de Discord (GIF)')
    await expect.element(toolbarButton).toHaveTextContent('512 KB')

    await userEvent.click(toolbarButton)
    for (const label of [
      'Sticker animado de Discord (GIF)',
      'Sticker animado de Discord (APNG)',
      'Emoji animado de Discord (GIF)',
    ]) {
      await expect
        .element(
          page.getByRole('button', { name: new RegExp(label.replace(/[()]/g, '\\$&')) }).first(),
        )
        .toBeVisible()
    }

    const links = [...document.querySelectorAll('a[target=_blank]')]
    expect(links).toHaveLength(3)
    for (const link of links) {
      expect(link.getAttribute('rel')).toBe('noopener noreferrer')
      expect(link.getAttribute('href')).toMatch(/^https:\/\/support\.discord\.com\//)
    }
    await expect.element(page.getByText(/verificado el 2026-11-26/).first()).toBeVisible()
    await expect.element(page.getByText(/no se garantiza que lo acepte/)).toBeVisible()
  })

  it('offers the 256 px canvas for a sticker only, off until ticked', async () => {
    render(<App tool="discord" />)
    await userEvent.click(page.getByRole('button', { name: /^Destino/ }))

    const box = page.getByRole('checkbox', { name: /reducir el lienzo a 256 px/ })
    await expect.element(box).toBeVisible()
    await expect.element(box).not.toBeChecked()
    await expect
      .element(
        page.getByText('Discord lo aceptó en nuestras pruebas, pero su pantalla pide 320 × 320'),
      )
      .toBeVisible()

    await userEvent.click(box)
    await expect.element(box).toBeChecked()

    // The emoji has no canvas to reduce, and the choice stays for the sticker.
    await userEvent.click(page.getByRole('button', { name: /Emoji animado de Discord/ }))
    await userEvent.click(page.getByRole('button', { name: /^Destino/ }))
    await expect
      .element(page.getByRole('checkbox', { name: /reducir el lienzo a 256 px/ }))
      .not.toBeInTheDocument()
  })
})

describe('a sticker as GIF', () => {
  it(
    'turns a GIF, an APNG and an animated WebP into 320 x 320 GIFs under the limit',
    { timeout: 120_000 },
    async () => {
      render(<App tool="discord" />)
      queueStore.getState().add(await Promise.all(SOURCES.map(file)))

      await userEvent.click(page.getByRole('button', { name: /Preparar 3 animaciones/ }))
      await expect
        .element(page.getByText(/3 animaciones listas/), { timeout: 100_000 })
        .toBeVisible()

      const items = queueStore.getState().items
      expect(items).toHaveLength(3)
      for (const item of items) {
        expect(item.status, item.name).toBe('done')
        if (item.status !== 'done') continue

        expect(item.outcome.format).toBe('gif')
        expect(item.blob.type).toBe('image/gif')
        expect(item.blob.size).toBeLessThanOrEqual(512_000)
        expect(item.outcome.withinBudget).toBe(true)

        const bytes = await bytesOf(item.blob)
        expect(new TextDecoder().decode(bytes.subarray(0, 6))).toBe('GIF89a')
        expect(gifScreen(bytes)).toEqual({ width: 320, height: 320 })
      }

      // The name Discord is given: GIF stays .gif.
      expect(saveList(items).map((saved) => saved.name.split('.').pop())).toEqual([
        'gif',
        'gif',
        'gif',
      ])

      // The row says what it is in numbers, and the verdict is the limit's.
      await expect.element(page.getByText(/fps · .* · lienzo 320 × 320/).first()).toBeVisible()
      await expect.element(page.getByText('Entraron con margen')).toBeVisible()
      await expect.element(page.getByText(/^con margen/)).toBeVisible()

      // One animation against another is not a comparison.
      await expect.element(page.getByRole('button', { name: 'Comparar' })).not.toBeInTheDocument()
      // The column header is hidden on a phone-width page, so it is read from the table.
      await expect
        .element(page.getByRole('table', { name: 'Cola de animaciones' }))
        .toHaveTextContent('Peso contra el límite de Discord')
    },
  )

  it(
    'shows the output playing when a row is unfolded, and revokes its URL when folded',
    { timeout: 60_000 },
    async () => {
      const created: string[] = []
      const revoked: string[] = []
      const make = URL.createObjectURL.bind(URL)
      const revoke = URL.revokeObjectURL.bind(URL)
      vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
        const url = make(blob)
        created.push(url)
        return url
      })
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url) => {
        revoked.push(url)
        revoke(url)
      })

      render(<App tool="discord" />)
      queueStore.getState().add([await file('anim-opaque.gif')])
      await userEvent.click(page.getByRole('button', { name: /Preparar 1 animación/ }))
      await expect.element(page.getByText(/1 animación lista/), { timeout: 50_000 }).toBeVisible()

      // Nothing is made for a row nobody opened.
      expect(created).toHaveLength(0)
      await expect
        .element(page.getByRole('img', { name: /ajustada para Discord/ }))
        .not.toBeInTheDocument()

      const name = page.getByRole('button', { name: 'anim-opaque.gif', exact: true })
      await userEvent.click(name)

      const preview = page.getByRole('img', { name: 'anim-opaque.gif, ajustada para Discord' })
      await expect.element(preview).toBeVisible()
      const source = preview.element().getAttribute('src') ?? ''
      expect(source).toMatch(/^blob:/)
      expect(created).toContain(source)
      expect(revoked).not.toContain(source)

      // The detail carries what the animation is.
      await expect.element(page.getByText('Fotogramas', { exact: true })).toBeVisible()
      await expect.element(page.getByText('Duración')).toBeVisible()
      await expect.element(page.getByText('Colores', { exact: true })).toBeVisible()
      await expect.element(page.getByText('Se ajustó')).toBeVisible()

      await userEvent.click(name)
      await expect
        .element(page.getByRole('img', { name: 'anim-opaque.gif, ajustada para Discord' }))
        .not.toBeInTheDocument()
      expect(revoked).toContain(source)
    },
  )
})

describe('a sticker as APNG', () => {
  it(
    'keeps the animation in a .png at 320 x 320 under the limit',
    { timeout: 120_000 },
    async () => {
      render(<App tool="discord" />)
      await choose(/Sticker animado de Discord \(APNG\)/)
      queueStore.getState().add(await Promise.all(SOURCES.map(file)))

      await userEvent.click(page.getByRole('button', { name: /Preparar 3 animaciones/ }))
      await expect
        .element(page.getByText(/3 animaciones listas/), { timeout: 100_000 })
        .toBeVisible()

      const items = queueStore.getState().items
      for (const item of items) {
        expect(item.status, item.name).toBe('done')
        if (item.status !== 'done') continue

        expect(item.outcome.format).toBe('apng')
        expect(item.blob.type).toBe('image/png')
        expect(item.blob.size).toBeLessThanOrEqual(512_000)

        const bytes = await bytesOf(item.blob)
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
        expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
        expect(hasChunk(bytes, 'acTL')).toBe(true)
        expect({ width: view.getUint32(16), height: view.getUint32(20) }).toEqual({
          width: 320,
          height: 320,
        })
      }

      // The extension is .png, never .apng, which Discord rejects.
      for (const saved of saveList(items)) expect(saved.name).toMatch(/\.png$/)
    },
  )
})

describe('an emoji', () => {
  it('fits inside 128 px and under 256 000 bytes', { timeout: 120_000 }, async () => {
    render(<App tool="discord" />)
    await choose(/Emoji animado de Discord/)
    queueStore.getState().add(await Promise.all(SOURCES.map(file)))

    await userEvent.click(page.getByRole('button', { name: /Preparar 3 animaciones/ }))
    await expect.element(page.getByText(/3 animaciones listas/), { timeout: 100_000 }).toBeVisible()

    for (const item of queueStore.getState().items) {
      expect(item.status, item.name).toBe('done')
      if (item.status !== 'done') continue

      expect(item.outcome.width).toBeLessThanOrEqual(128)
      expect(item.outcome.height).toBeLessThanOrEqual(128)
      expect(item.blob.size).toBeLessThanOrEqual(256_000)
      expect(item.outcome.format).toBe('gif')
    }
  })
})

describe('what cannot be made', () => {
  it(
    'fails a still image with the way out, and finishes the rest of the batch',
    { timeout: 60_000 },
    async () => {
      render(<App tool="discord" />)
      queueStore.getState().add([await file('static.png'), await file('anim-opaque.gif')])

      await userEvent.click(page.getByRole('button', { name: /Preparar 2 animaciones/ }))

      await expect
        .element(
          page.getByText(/Esta imagen no está animada.*usa Comprimir o Redimensionar/).first(),
          {
            timeout: 50_000,
          },
        )
        .toBeVisible()
      await expect.element(page.getByText(/1 animación lista/)).toBeVisible()

      const [still, animation] = queueStore.getState().items
      expect(still?.status).toBe('failed')
      expect(animation?.status).toBe('done')
    },
  )

  it(
    'marks an animation that cannot be made to fit as over, with the weight and the limit, and still lets it be saved',
    { timeout: 170_000 },
    async () => {
      render(<App tool="discord" />)
      queueStore.getState().add([noiseFile()])

      await userEvent.click(page.getByRole('button', { name: /Preparar 1 animación/ }))
      await expect.element(page.getByText(/1 animación lista/), { timeout: 160_000 }).toBeVisible()

      const [item] = queueStore.getState().items
      expect(item?.status).toBe('done')
      if (item?.status !== 'done') return

      expect(item.outcome.withinBudget).toBe(false)
      expect(item.blob.size).toBeGreaterThan(512_000)

      // The row says it plainly, with the final weight and the limit.
      await expect.element(page.getByText(/^No entra en el límite de 512 KB/)).toBeVisible()
      // The filter and the totals reuse the verdict.
      await expect.element(page.getByRole('button', { name: /No entraron/ })).toBeVisible()
      await expect.element(page.getByRole('button', { name: /Justos/ })).not.toBeInTheDocument()

      // It is still a file the user can take.
      await expect
        .element(page.getByRole('button', { name: 'Descargar 1 animación' }))
        .toBeVisible()
      await expect
        .element(page.getByRole('button', { name: 'Descargar', exact: true }))
        .toBeVisible()
      expect(saveList(queueStore.getState().items)).toHaveLength(1)
    },
  )
})

describe('the English page', () => {
  it('prepares an animation and says so in English', { timeout: 60_000 }, async () => {
    render(
      <CopyProvider value={en}>
        <App tool="discord" />
      </CopyProvider>,
    )
    queueStore.getState().add([await file('anim-opaque.gif')])

    await userEvent.click(page.getByRole('button', { name: /Prepare 1 animation/ }))
    await expect.element(page.getByText(/1 animation ready/), { timeout: 50_000 }).toBeVisible()
    await expect
      .element(page.getByRole('table', { name: 'Animation queue' }))
      .toHaveTextContent('Weight against the Discord limit')
  })

  it('has the Spanish catalogue as the default', () => {
    expect(es.tools.discord.running).toBe('Preparando')
  })
})
