// The stylesheet, because without it these tests render unstyled markup and
// anything they claim about layout is about a page nobody will ever see.
import '../styles.css'
import { page, userEvent } from 'vitest/browser'
import { beforeEach, describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { queueStore } from '../state/queue-store'
import { saveList } from './save-list'
import { CopyProvider, en } from './copy'
import { App } from './App'

/**
 * The interface against the real everything: real React, the real store, the
 * real worker pool and the real codecs, in a real Chromium.
 *
 * What is worth asserting here is the wiring, not the arithmetic — the row
 * model, the formatting and the queue view are all covered in Node, in
 * milliseconds. This is the layer where a prop passed to the wrong component
 * or a plan that never reaches a worker shows up.
 */

const FIXTURE_URLS = import.meta.glob('../../test/fixtures/**/*.{jpg,png}', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>

async function fixture(name: string): Promise<File> {
  const key = Object.keys(FIXTURE_URLS).find((path) => path.endsWith(`/${name}`))
  if (key === undefined) throw new Error(`fixture not found: ${name}`)

  const url = FIXTURE_URLS[key]
  if (url === undefined) throw new Error(`fixture url missing: ${name}`)

  return new File([await (await fetch(url)).arrayBuffer()], name)
}

/** The store is a module singleton, so each test starts from an empty queue. */
beforeEach(() => {
  queueStore.getState().clear()
})

describe('the empty screen', () => {
  it('is the work surface, not a landing page', async () => {
    render(<App tool="comprimir" />)

    await expect
      .element(
        page.getByRole('heading', {
          level: 1,
          name: 'Arrastra aquí las imágenes que quieres comprimir',
        }),
      )
      .toBeVisible()
    await expect.element(page.getByText('Nada sale de tu dispositivo')).toBeVisible()
  })
})

describe('the queue', () => {
  it('lists what was added without compressing any of it', async () => {
    render(<App tool="comprimir" />)

    queueStore.getState().add([await fixture('Landscape_6.jpg')])

    await expect.element(page.getByText('Landscape_6.jpg')).toBeVisible()
    // Scoped to the table: "En cola" is also the label of a filter chip, and
    // what matters here is the row saying it.
    await expect.element(page.getByRole('table').getByText('En cola')).toBeVisible()
    await expect.element(page.getByRole('button', { name: /Comprimir 1 imagen/ })).toBeVisible()
  })

  it('compresses the batch when asked, and says by how much', { timeout: 40_000 }, async () => {
    render(<App tool="comprimir" />)
    queueStore.getState().add([await fixture('Landscape_6.jpg')])

    await userEvent.click(page.getByRole('button', { name: /Comprimir 1 imagen/ }))

    await expect.element(page.getByText(/imagen comprimida/), { timeout: 30_000 }).toBeVisible()
    const item = queueStore.getState().items[0]
    expect(item?.status).toBe('done')
    if (item?.status === 'done') {
      expect(item.outcome.bytesAfter).toBeLessThan(item.bytesBefore)
    }
  })

  it('offers to save only once there is something to save', { timeout: 40_000 }, async () => {
    render(<App tool="comprimir" />)
    queueStore.getState().add([await fixture('Landscape_6.jpg')])

    // Nothing to save yet: a save button on an empty result is a dead end.
    await expect
      .element(page.getByRole('button', { name: /Descargar|Guardar en/ }))
      .not.toBeInTheDocument()

    await userEvent.click(page.getByRole('button', { name: /Comprimir 1 imagen/ }))
    await expect.element(page.getByText(/imagen comprimida/), { timeout: 30_000 }).toBeVisible()

    /*
     * The default road asks nothing and says what it will do: one image is
     * handed over as one image, not wrapped in an archive nobody asked for.
     * Neither button is clicked here — the folder picker needs a user gesture
     * and a real dialog, which is why both paths are tested against fakes in
     * src/output.
     */
    await expect.element(page.getByRole('button', { name: 'Descargar 1 imagen' })).toBeVisible()
  })

  it('blames the file that failed and finishes the rest', { timeout: 40_000 }, async () => {
    render(<App tool="comprimir" />)
    queueStore.getState().add([await fixture('xd0n2c08.png'), await fixture('Landscape_6.jpg')])

    await userEvent.click(page.getByRole('button', { name: /Comprimir 2 imágenes/ }))

    // The cause in words, in the row, with the batch carrying on around it.
    await expect.element(page.getByText(/PNG dañado/), { timeout: 30_000 }).toBeVisible()
    await expect.element(page.getByText(/1 imagen comprimida/)).toBeVisible()
  })
})

describe('the English page', () => {
  it('speaks English from the heading to the totals', { timeout: 40_000 }, async () => {
    const { container } = await render(
      <CopyProvider value={en}>
        <App tool="comprimir" />
      </CopyProvider>,
    )

    await expect
      .element(page.getByRole('heading', { level: 1, name: /images you want to compress/ }))
      .toBeVisible()
    await expect.element(page.getByRole('link', { name: 'Español' })).toHaveAttribute('href', '/')

    queueStore.getState().add([await fixture('Landscape_6.jpg')])
    await userEvent.click(page.getByRole('button', { name: /Compress 1 image/ }))
    await expect.element(page.getByText(/1 image compressed/), { timeout: 30_000 }).toBeVisible()
    await expect.element(page.getByRole('button', { name: 'Download 1 image' })).toBeVisible()

    // Every text node, not only what was asserted above, and not only what is
    // visible at this width: a sentence left written inside a component shows
    // up here, in Spanish (D54). The table header that slipped through was
    // hidden on narrow screens, which is why this is textContent.
    const visible = (container.textContent ?? '').replace(/Español/g, '')
    expect(visible).not.toMatch(
      /[áéíóúñ]|\b(de|del|la|las|el|los|que|con|sin|contra|para|por|una|en|y)\b/i,
    )
  })
})

describe('the weight ceiling', () => {
  it('reaches the worker and holds every file under it', { timeout: 60_000 }, async () => {
    render(<App tool="comprimir" />)
    queueStore.getState().add([await fixture('Landscape_6.jpg')])

    await userEvent.click(page.getByRole('button', { name: /^Destino/ }))
    await userEvent.click(page.getByRole('button', { name: '100 KB' }))
    await userEvent.click(page.getByRole('button', { name: /^Destino/ }))

    // The ceiling shows on the control that holds it, panel closed.
    await expect.element(page.getByRole('button', { name: /^Destino.*máx\. 100 KB/ })).toBeVisible()

    await userEvent.click(page.getByRole('button', { name: /Comprimir 1 imagen/ }))
    await expect.element(page.getByText(/imagen comprimida/), { timeout: 50_000 }).toBeVisible()

    const item = queueStore.getState().items[0]
    expect(item?.status).toBe('done')
    if (item?.status === 'done') expect(item.outcome.bytesAfter).toBeLessThanOrEqual(100_000)
  })

  it('takes a ceiling typed by hand, and says when it is not one', async () => {
    render(<App tool="comprimir" />)

    await userEvent.click(page.getByRole('button', { name: /^Destino/ }))
    await userEvent.fill(page.getByLabelText('Otro'), 'mucho')
    await userEvent.click(page.getByRole('button', { name: 'Usar' }))
    await expect.element(page.getByRole('alert')).toHaveTextContent(/entre 5 y/)

    await userEvent.fill(page.getByLabelText('Otro'), '250')
    await userEvent.click(page.getByRole('button', { name: 'Usar' }))
    await expect.element(page.getByRole('alert')).not.toBeInTheDocument()
    await expect.element(page.getByRole('button', { name: /^Destino.*máx\. 250 KB/ })).toBeVisible()
  })

  it('asks what to do with a PNG only where the answer can matter', async () => {
    render(<App tool="comprimir" />)
    await userEvent.click(page.getByRole('button', { name: /^Destino/ }))

    // No ceiling yet: nothing to decide.
    await expect.element(page.getByText('Si un PNG no entra en el tope')).not.toBeInTheDocument()

    await userEvent.click(page.getByRole('button', { name: '200 KB' }))
    // The web destination converts every PNG to WebP anyway.
    await expect.element(page.getByText('Si un PNG no entra en el tope')).not.toBeInTheDocument()

    await userEvent.click(page.getByRole('button', { name: /Adjunto de correo/ }))
    await userEvent.click(page.getByRole('button', { name: /^Destino/ }))
    await expect.element(page.getByText('Si un PNG no entra en el tope')).toBeVisible()
    await expect.element(page.getByRole('radio', { name: /Pasarlo a WebP/ })).toBeChecked()
  })
})

describe('the comparator', () => {
  it('puts both pictures in exactly the same box', { timeout: 40_000 }, async () => {
    render(<App tool="comprimir" />)
    queueStore.getState().add([await fixture('Landscape_6.jpg')])
    await userEvent.click(page.getByRole('button', { name: /Comprimir 1 imagen/ }))
    await expect.element(page.getByText(/imagen comprimida/), { timeout: 30_000 }).toBeVisible()

    await userEvent.click(page.getByRole('button', { name: 'Comparar' }))

    /*
     * The bug this guards was found by using the thing: the original sat in
     * the layout at its own size while the result was positioned at another,
     * so the curtain crossed two pictures at different scales. It looked
     * like a comparison and compared nothing.
     *
     * The result is usually smaller in pixels than the original, so equal
     * boxes is the whole point rather than a coincidence.
     */
    const before = page.getByAltText(/original/).element()
    const after = page.getByAltText(/comprimida/).element()

    const one = before.getBoundingClientRect()
    const two = after.getBoundingClientRect()

    expect(one.width).toBeGreaterThan(0)
    expect(two.width).toBeCloseTo(one.width, 1)
    expect(two.height).toBeCloseTo(one.height, 1)
    expect(two.left).toBeCloseTo(one.left, 1)
    expect(two.top).toBeCloseTo(one.top, 1)
  })

  it('moves the curtain only when the curtain is grabbed', { timeout: 40_000 }, async () => {
    render(<App tool="comprimir" />)
    queueStore.getState().add([await fixture('Landscape_6.jpg')])
    await userEvent.click(page.getByRole('button', { name: /Comprimir 1 imagen/ }))
    await expect.element(page.getByText(/imagen comprimida/), { timeout: 30_000 }).toBeVisible()
    await userEvent.click(page.getByRole('button', { name: 'Comparar' }))

    const curtain = page.getByRole('slider')
    await expect.element(curtain).toBeVisible()
    const before = curtain.element().getAttribute('aria-valuenow')

    /*
     * Dispatched rather than clicked: the pictures are stacked, so a real
     * click lands on whichever is on top and Playwright refuses to aim at the
     * one underneath. What is being checked is the listener that used to sit
     * on the whole surface — a pointerdown on the picture would teleport the
     * divider there, which reads as a glitch and not as a control.
     */
    page
      .getByAltText(/comprimida/)
      .element()
      .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 40, clientY: 200 }))

    expect(curtain.element().getAttribute('aria-valuenow')).toBe(before)
  })

  it('lets the keyboard move the curtain', { timeout: 40_000 }, async () => {
    render(<App tool="comprimir" />)
    queueStore.getState().add([await fixture('Landscape_6.jpg')])
    await userEvent.click(page.getByRole('button', { name: /Comprimir 1 imagen/ }))
    await expect.element(page.getByText(/imagen comprimida/), { timeout: 30_000 }).toBeVisible()
    await userEvent.click(page.getByRole('button', { name: 'Comparar' }))

    const curtain = page.getByRole('slider')
    curtain.element().focus()
    await userEvent.keyboard('{ArrowRight}{ArrowRight}')

    // Without this the comparison is mouse-only, which the design's quality
    // floor rules out.
    expect(Number(curtain.element().getAttribute('aria-valuenow'))).toBe(52)
  })

  it('closes with the keyboard and gives focus back', { timeout: 40_000 }, async () => {
    render(<App tool="comprimir" />)
    queueStore.getState().add([await fixture('Landscape_6.jpg')])
    await userEvent.click(page.getByRole('button', { name: /Comprimir 1 imagen/ }))
    await expect.element(page.getByText(/imagen comprimida/), { timeout: 30_000 }).toBeVisible()
    await userEvent.click(page.getByRole('button', { name: 'Comparar' }))
    await expect.element(page.getByRole('dialog')).toBeVisible()

    await userEvent.keyboard('{Escape}')

    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('the destination picker', () => {
  it('offers only our own advice, and names the one profile that converts', async () => {
    render(<App tool="comprimir" />)

    await userEvent.click(page.getByRole('button', { name: /Destino/ }))

    await expect.element(page.getByText('Adjunto de correo')).toBeVisible()
    // The paperwork group is gone, not hidden: nothing in this panel quotes an
    // outside authority any more (D48).
    await expect.element(page.getByText('Trámites')).not.toBeInTheDocument()
    // Exactly one profile changes the extension, and it is the one that says so
    // in its own note (D49).
    await expect.element(page.getByText(/Es el único perfil que cambia el formato/)).toBeVisible()
  })

  it('closes with the keyboard', async () => {
    render(<App tool="comprimir" />)
    await userEvent.click(page.getByRole('button', { name: /Destino/ }))
    await expect.element(page.getByText('Adjunto de correo')).toBeVisible()

    await userEvent.keyboard('{Escape}')

    await expect.element(page.getByText('Adjunto de correo')).not.toBeInTheDocument()
  })
})

describe('the other tools', () => {
  it('resize halves the picture and says so in its own words', { timeout: 60_000 }, async () => {
    render(<App tool="redimensionar" />)

    await expect
      .element(page.getByRole('heading', { level: 1, name: /quieres redimensionar/ }))
      .toBeVisible()
    // Its own picker, starting at 50 %, and none of the compressor's weight ceiling.
    await expect.element(page.getByRole('button', { name: /^Destino.*50 %/ })).toBeVisible()
    await userEvent.click(page.getByRole('button', { name: /^Destino/ }))
    await expect.element(page.getByText('Tope por archivo')).not.toBeInTheDocument()
    await userEvent.keyboard('{Escape}')

    const file = await fixture('Landscape_6.jpg')
    const original = await createImageBitmap(file)
    queueStore.getState().add([file])

    await userEvent.click(page.getByRole('button', { name: /Redimensionar 1 imagen/ }))
    await expect
      .element(page.getByText(/1 imagen redimensionada/), { timeout: 50_000 })
      .toBeVisible()

    const item = queueStore.getState().items[0]
    expect(item?.status).toBe('done')
    if (item?.status !== 'done') return

    expect(Math.abs(item.outcome.width - original.width / 2)).toBeLessThanOrEqual(1)
    expect(Math.abs(item.outcome.height - original.height / 2)).toBeLessThanOrEqual(1)
    expect(item.outcome.format).toBe('jpeg')

    // The row states the new size, not the old one. Thousands separators vary
    // by locale, so compare the digits.
    const rowText = (page.getByRole('table').element().textContent ?? '').replace(
      /(?<=\d)[.,\s\u00a0\u202f](?=\d{3}\b)/g,
      '',
    )
    expect(rowText).toContain(`${item.outcome.width} × ${item.outcome.height}`)
    // Nothing here judges weight: no verdict chip of the compressor.
    await expect.element(page.getByText('No entraron')).not.toBeInTheDocument()
    await expect.element(page.getByRole('button', { name: /^Terminados/ })).toBeVisible()
  })

  it(
    'convert writes WebP files, and a file that grew is not a failure',
    { timeout: 60_000 },
    async () => {
      render(<App tool="convertir" />)

      await expect
        .element(page.getByRole('heading', { level: 1, name: /quieres convertir/ }))
        .toBeVisible()

      queueStore.getState().add([await fixture('Landscape_6.jpg')])
      await userEvent.click(page.getByRole('button', { name: /Convertir 1 imagen/ }))
      await expect.element(page.getByText(/1 imagen convertida/), { timeout: 50_000 }).toBeVisible()

      const items = queueStore.getState().items
      const [first] = saveList(items)
      expect(first?.name).toBe('Landscape_6.webp')
      const item = items[0]
      if (item?.status === 'done') expect(item.outcome.format).toBe('webp')

      await expect.element(page.getByText('No entraron')).not.toBeInTheDocument()
    },
  )

  it(
    'resize by a maximum width keeps the proportions and never passes the limit',
    { timeout: 60_000 },
    async () => {
      render(<App tool="redimensionar" />)

      const file = await fixture('Landscape_6.jpg')
      const original = await createImageBitmap(file)
      // The check means nothing if the picture already fits.
      expect(original.width).toBeGreaterThan(400)
      queueStore.getState().add([file])

      await userEvent.click(page.getByRole('button', { name: /^Destino/ }))
      await userEvent.click(page.getByRole('button', { name: 'Tamaño máximo' }))
      await userEvent.fill(page.getByLabelText('Ancho'), '400')
      await userEvent.click(page.getByRole('button', { name: 'Usar' }))
      await userEvent.keyboard('{Escape}')
      await expect
        .element(page.getByRole('button', { name: /^Destino.*máx\. 400 px de ancho/ }))
        .toBeVisible()

      await userEvent.click(page.getByRole('button', { name: /Redimensionar 1 imagen/ }))
      await expect
        .element(page.getByText(/1 imagen redimensionada/), { timeout: 50_000 })
        .toBeVisible()

      const item = queueStore.getState().items[0]
      expect(item?.status).toBe('done')
      if (item?.status !== 'done') return

      expect(item.outcome.width).toBeLessThanOrEqual(400)
      expect(item.outcome.width).toBe(400)
      // Same shape as the original, to within a pixel of rounding.
      const expectedHeight = (original.height * item.outcome.width) / original.width
      expect(Math.abs(item.outcome.height - expectedHeight)).toBeLessThanOrEqual(1)
      expect(item.outcome.format).toBe('jpeg')

      // The row says the new size, in digits only so locale separators do not matter.
      const rowText = (page.getByRole('table').element().textContent ?? '').replace(
        /(?<=\d)[.,\s\u00a0\u202f](?=\d{3}\b)/g,
        '',
      )
      expect(rowText).toContain(`${item.outcome.width} × ${item.outcome.height}`)
    },
  )

  it(
    'convert to JPEG turns a transparent PNG into a .jpg composed over white',
    { timeout: 60_000 },
    async () => {
      render(<App tool="convertir" />)

      // The default is WebP; the picker says so before anything is chosen.
      await expect.element(page.getByRole('button', { name: /^Destino.*WebP/ })).toBeVisible()

      queueStore.getState().add([await fixture('basn6a08.png')])

      await userEvent.click(page.getByRole('button', { name: /^Destino/ }))
      await userEvent.click(page.getByRole('button', { name: /^JPEG/ }))
      await expect.element(page.getByRole('button', { name: /^Destino.*JPEG/ })).toBeVisible()

      await userEvent.click(page.getByRole('button', { name: /Convertir 1 imagen/ }))
      await expect.element(page.getByText(/1 imagen convertida/), { timeout: 50_000 }).toBeVisible()

      const items = queueStore.getState().items
      const [first] = saveList(items)
      expect(first?.name).toBe('basn6a08.jpg')

      const item = items[0]
      expect(item?.status).toBe('done')
      if (item?.status !== 'done') return
      expect(item.outcome.format).toBe('jpeg')
      // JPEG signature: the bytes really are a JPEG, not a renamed PNG.
      const head = new Uint8Array(await item.blob.slice(0, 3).arrayBuffer())
      expect([...head]).toEqual([0xff, 0xd8, 0xff])
      // The row says what the destination asked for, not "any size".
      await userEvent.click(page.getByRole('button', { name: 'basn6a08.png' }))
      await expect.element(page.getByText('mismas dimensiones, JPEG')).toBeVisible()
    },
  )

  it('shows the tool navigation, with the current one marked and not a link', async () => {
    render(<App tool="convertir" />)

    const nav = page.getByRole('navigation', { name: 'Herramientas' })
    await expect.element(nav).toBeVisible()
    await expect.element(nav.getByRole('link', { name: 'Comprimir' })).toHaveAttribute('href', '/')
    await expect
      .element(nav.getByRole('link', { name: 'Redimensionar' }))
      .toHaveAttribute('href', '/redimensionar-imagenes/')
    await expect.element(nav.getByRole('link', { name: 'Convertir' })).not.toBeInTheDocument()
    await expect.element(nav.getByText('Convertir')).toHaveAttribute('aria-current', 'page')
  })

  it('points the language link at the twin page of the same tool', async () => {
    render(
      <CopyProvider value={en}>
        <App tool="redimensionar" />
      </CopyProvider>,
    )

    await expect
      .element(page.getByRole('link', { name: 'Español' }))
      .toHaveAttribute('href', '/redimensionar-imagenes/')
  })

  it('keeps the navigation inside a phone-width toolbar', async () => {
    await page.viewport(375, 812)
    try {
      render(<App tool="comprimir" />)
      await expect.element(page.getByRole('navigation', { name: 'Herramientas' })).toBeVisible()

      const header = page.getByRole('banner').element()
      expect(header.scrollWidth).toBeLessThanOrEqual(header.clientWidth)
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
    } finally {
      await page.viewport(414, 896)
    }
  })
})
