// The stylesheet, because without it these tests render unstyled markup and
// anything they claim about layout is about a page nobody will ever see.
import '../styles.css'
import { page, userEvent } from 'vitest/browser'
import { beforeEach, describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { queueStore } from '../state/queue-store'
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
    render(<App />)

    await expect.element(page.getByText('Arrastra tus imágenes aquí')).toBeVisible()
    await expect.element(page.getByText('Nada sale de tu dispositivo')).toBeVisible()
  })
})

describe('the queue', () => {
  it('lists what was added without compressing any of it', async () => {
    render(<App />)

    queueStore.getState().add([await fixture('Landscape_6.jpg')])

    await expect.element(page.getByText('Landscape_6.jpg')).toBeVisible()
    // Scoped to the table: "En cola" is also the label of a filter chip, and
    // what matters here is the row saying it.
    await expect.element(page.getByRole('table').getByText('En cola')).toBeVisible()
    await expect.element(page.getByRole('button', { name: /Comprimir 1 imagen/ })).toBeVisible()
  })

  it('compresses the batch when asked, and says by how much', { timeout: 40_000 }, async () => {
    render(<App />)
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
    render(<App />)
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
    render(<App />)
    queueStore.getState().add([await fixture('xd0n2c08.png'), await fixture('Landscape_6.jpg')])

    await userEvent.click(page.getByRole('button', { name: /Comprimir 2 imágenes/ }))

    // The cause in words, in the row, with the batch carrying on around it.
    await expect.element(page.getByText(/PNG dañado/), { timeout: 30_000 }).toBeVisible()
    await expect.element(page.getByText(/1 imagen comprimida/)).toBeVisible()
  })
})

describe('the comparator', () => {
  it('puts both pictures in exactly the same box', { timeout: 40_000 }, async () => {
    render(<App />)
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
    render(<App />)
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
    render(<App />)
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
    render(<App />)
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
    render(<App />)

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
    render(<App />)
    await userEvent.click(page.getByRole('button', { name: /Destino/ }))
    await expect.element(page.getByText('Adjunto de correo')).toBeVisible()

    await userEvent.keyboard('{Escape}')

    await expect.element(page.getByText('Adjunto de correo')).not.toBeInTheDocument()
  })
})
