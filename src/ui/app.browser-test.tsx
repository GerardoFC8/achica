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
    await expect.element(page.getByRole('button', { name: /Guardar|ZIP/ })).not.toBeInTheDocument()

    await userEvent.click(page.getByRole('button', { name: /Comprimir 1 imagen/ }))
    await expect.element(page.getByText(/imagen comprimida/), { timeout: 30_000 }).toBeVisible()

    // The label says which road this browser takes. It is not clicked here:
    // the folder picker needs a user gesture and a real dialog, which is why
    // both paths are tested against fakes in src/output.
    await expect.element(page.getByRole('button', { name: /Guardar 1 imagen|ZIP/ })).toBeVisible()
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

describe('the destination picker', () => {
  it('shows where each limit comes from, and admits when nothing is verified', async () => {
    render(<App />)

    await userEvent.click(page.getByRole('button', { name: /Destino/ }))

    await expect.element(page.getByText('Adjunto de correo')).toBeVisible()
    // An empty paperwork list is the honest answer, and it says why.
    await expect.element(page.getByText(/Un requisito de trámite solo entra/)).toBeVisible()
  })

  it('closes with the keyboard', async () => {
    render(<App />)
    await userEvent.click(page.getByRole('button', { name: /Destino/ }))
    await expect.element(page.getByText('Adjunto de correo')).toBeVisible()

    await userEvent.keyboard('{Escape}')

    await expect.element(page.getByText('Adjunto de correo')).not.toBeInTheDocument()
  })
})
