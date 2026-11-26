import '../styles.css'
import { page, userEvent } from 'vitest/browser'
import { beforeEach, describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { entry, har } from '../../test/helpers/har-builders'
import { auditStore } from '../state/audit-store'
import { queueStore } from '../state/queue-store'
import { CopyProvider, en } from './copy'
import { App } from './App'

/**
 * The audit against the real everything: a HAR dropped on the real screen,
 * read by the real worker, measured by the real codecs.
 *
 * The HAR here is hostile on purpose. Every secret a HAR can carry is planted
 * with a sentinel, and what the page must never do with a line of the export is
 * the second half of the promise: it shows an address as text, and nothing in
 * the DOM ever points at it.
 */

const FIXTURE_URLS = import.meta.glob('../../test/fixtures/**/*.{jpg,png}', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>

async function fixtureBytes(name: string): Promise<Uint8Array> {
  const key = Object.keys(FIXTURE_URLS).find((path) => path.endsWith(`/${name}`))
  const url = key === undefined ? undefined : FIXTURE_URLS[key]
  if (url === undefined) throw new Error(`fixture not found: ${name}`)
  return new Uint8Array(await (await fetch(url)).arrayBuffer())
}

const toBase64 = (bytes: Uint8Array): string => {
  let text = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(text)
}

const HOST = 'har-host.test'
const SENTINELS = {
  query: 'SENTINEL_QUERY_TOKEN_4F2',
  user: 'SENTINEL_USER_9A1',
  pass: 'SENTINEL_PASS_7C3',
  header: 'SENTINEL_AUTH_BEARER_2B8',
  cookie: 'SENTINEL_COOKIE_SID_6D5',
  skipped: 'SENTINEL_SKIPPED_QUERY_1E0',
}
const SECRETS = [SENTINELS.header, SENTINELS.cookie]

async function hostileHar(): Promise<string> {
  const jpeg = toBase64(await fixtureBytes('no-exif.jpg'))
  const png = toBase64(await fixtureBytes('basn6a08.png'))
  const image = (url: string, mimeType: string, text: string): Record<string, unknown> =>
    entry({ url, mimeType, text, encoding: 'base64', size: 1_000 }, SECRETS)

  const entries: unknown[] = [
    image(
      `https://${SENTINELS.user}:${SENTINELS.pass}@${HOST}/img/hero.jpg?token=${SENTINELS.query}#frag`,
      'image/jpeg',
      jpeg,
    ),
    image(`https://${HOST}/img/logo.png?v=${SENTINELS.query}`, 'image/png', png),
    // Ten different paths, one file name: the names must come out distinct.
    ...Array.from({ length: 10 }, (_, index) =>
      image(`https://${HOST}/cdn/${index}/thumb.jpg?sig=${SENTINELS.query}`, 'image/jpeg', jpeg),
    ),
    // What cannot be measured, each for its own reason.
    entry(
      {
        url: `https://${HOST}/img/icon.svg?x=${SENTINELS.skipped}`,
        status: 200,
        mimeType: 'image/svg+xml',
        text: '<svg xmlns="http://www.w3.org/2000/svg"/>',
        size: 40,
      },
      SECRETS,
    ),
    entry(
      {
        url: `https://${HOST}/img/gone.jpg?x=${SENTINELS.skipped}`,
        status: 404,
        mimeType: 'image/jpeg',
        size: 0,
      },
      SECRETS,
    ),
    entry(
      { url: `https://${HOST}/img/bare.webp`, status: 200, mimeType: 'image/webp', size: 5_000 },
      SECRETS,
    ),
  ]
  return har(entries)
}

function dropOn(files: File[]): void {
  const zone = page.getByRole('heading', { level: 1 }).element().parentElement
  if (zone === null) throw new Error('the drop zone is missing')

  const transfer = new DataTransfer()
  for (const file of files) transfer.items.add(file)
  zone.dispatchEvent(
    new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }),
  )
}

/** Drops the hostile HAR and waits until its images are in the queue. */
async function loadHostile(): Promise<void> {
  await render(<App tool="auditar" />)
  dropOn([new File([await hostileHar()], 'page.har')])
  await expect
    .element(page.getByRole('button', { name: /Medir el ahorro de 12 imágenes/ }), {
      timeout: 20_000,
    })
    .toBeVisible()
}

beforeEach(() => {
  queueStore.getState().clear()
  auditStore.getState().clear()
})

describe('the audit screen', () => {
  it('says what to drop, and what happens to the file', async () => {
    await render(<App tool="auditar" />)

    await expect
      .element(page.getByRole('heading', { level: 1, name: /archivo HAR de la página/ }))
      .toBeVisible()
    await expect
      .element(page.getByText(/pestaña Red de las herramientas de desarrollo/))
      .toBeVisible()
    await expect.element(page.getByText(/se lee en tu navegador/)).toBeVisible()
    await expect.element(page.getByText(/datos de tu sesión/)).toBeVisible()
    await expect.element(page.getByRole('button', { name: 'o elige un archivo' })).toBeVisible()

    const file = document.querySelector('input[type=file]')
    expect(file?.getAttribute('accept')).toBe('.har,.json,application/json')
    expect(file?.hasAttribute('multiple')).toBe(false)
  })
})

describe('a hostile HAR', () => {
  it(
    'lists what it can measure and what it cannot, with the reason',
    {
      timeout: 40_000,
    },
    async () => {
      await loadHostile()

      // The summary line: measurable of the total, the weight, the destination.
      await expect
        .element(
          page.getByText(
            /12 imágenes medibles de 15 en el HAR · pesan .* · destino «Mismo formato y tamaño»/,
          ),
        )
        .toBeVisible()

      // Ten thumbs of different paths, none overwriting another.
      const names = queueStore.getState().items.map((item) => item.name)
      expect(new Set(names).size).toBe(12)
      expect(names.filter((name) => name.includes('thumb'))).toHaveLength(10)

      // The list of what could not be measured is folded away, and opens.
      await userEvent.click(page.getByText('No medibles: 3'))
      await expect.element(page.getByText(/formato que achica no optimiza todavía/)).toBeVisible()
      await expect.element(page.getByText('petición fallida')).toBeVisible()
      await expect
        .element(page.getByText(/sin contenido en el HAR: vuelve a exportarlo/))
        .toBeVisible()
      await expect.element(page.getByText(`https://${HOST}/img/icon.svg`)).toBeVisible()
    },
  )

  it('puts no secret anywhere in the page, attributes included', { timeout: 60_000 }, async () => {
    await loadHostile()

    // Open everything that can be opened, so the check covers it all.
    await userEvent.click(page.getByText('No medibles: 3'))
    await userEvent.click(page.getByRole('button', { name: 'hero.jpg' }))
    await userEvent.click(page.getByRole('button', { name: /Medir el ahorro/ }))
    await expect.element(page.getByText(/12 imágenes medidas/), { timeout: 50_000 }).toBeVisible()

    // The address is shown (so this is not vacuous), without query or credentials.
    expect(document.body.textContent).toContain(`https://${HOST}/img/hero.jpg`)

    const html = document.documentElement.outerHTML
    for (const [name, sentinel] of Object.entries(SENTINELS)) {
      expect(html.includes(sentinel), `the ${name} sentinel is in the page`).toBe(false)
    }
    // And not in the app's own state either.
    const state = JSON.stringify([
      queueStore.getState().items.map((item) => item.name),
      [...(auditStore.getState().audit?.origins.entries() ?? [])],
      auditStore.getState().audit?.skipped,
    ])
    for (const sentinel of Object.values(SENTINELS)) expect(state).not.toContain(sentinel)
  })

  it(
    'never points a link or a picture at an address of the HAR',
    {
      timeout: 60_000,
    },
    async () => {
      await loadHostile()
      await userEvent.click(page.getByText('No medibles: 3'))
      await userEvent.click(page.getByRole('button', { name: /Medir el ahorro/ }))
      await expect.element(page.getByText(/12 imágenes medidas/), { timeout: 50_000 }).toBeVisible()
      await userEvent.click(page.getByRole('button', { name: 'Comparar' }).first())
      await expect.element(page.getByAltText(/original/)).toBeVisible()

      // The address is on the page as text, so the check below is not vacuous.
      expect(document.body.textContent).toContain(HOST)

      const attributes = ['href', 'src', 'srcset', 'action', 'data', 'poster', 'ping']
      for (const element of document.querySelectorAll('*')) {
        for (const attribute of attributes) {
          const value = element.getAttribute(attribute)
          if (value === null) continue
          expect(value, `${element.tagName} ${attribute}`).not.toContain(HOST)
          // A picture is the app's own blob, never an address.
          if (element.tagName === 'IMG') expect(value.startsWith('blob:'), value).toBe(true)
        }
      }
      expect(document.querySelectorAll('a[href]').length).toBeGreaterThan(0)
      expect(document.querySelectorAll('img[src]').length).toBeGreaterThan(0)
    },
  )

  it(
    'counts only the files that came out lighter, and names the destination used',
    {
      timeout: 60_000,
    },
    async () => {
      await loadHostile()
      await userEvent.click(page.getByRole('button', { name: /Medir el ahorro/ }))
      await expect.element(page.getByText(/12 imágenes medidas/), { timeout: 50_000 }).toBeVisible()

      const items = queueStore.getState().items
      expect(items.every((item) => item.status === 'done')).toBe(true)

      // What the footer announces is what replacing only the lighter files saves.
      let before = 0
      let after = 0
      for (const item of items) {
        if (item.status !== 'done') continue
        before += item.bytesBefore
        after += Math.min(item.bytesBefore, item.outcome.bytesAfter)
      }
      const footer = (page.getByRole('contentinfo').element().textContent ?? '').replace(
        /\s+/g,
        ' ',
      )
      expect(footer).toMatch(/% menos|0 ?% menos/)
      expect(footer).not.toMatch(/% más/)
      expect(after).toBeLessThanOrEqual(before)

      // Changing the destination afterwards does not rename a figure already produced.
      await userEvent.click(page.getByRole('button', { name: /^Destino/ }))
      await userEvent.click(page.getByRole('button', { name: /Imagen para artículo web/ }))
      await expect.element(page.getByText(/destino «Mismo formato y tamaño»/)).toBeVisible()
    },
  )

  it('clears the audit together with the queue', { timeout: 40_000 }, async () => {
    await loadHostile()
    expect(auditStore.getState().audit).not.toBeNull()

    await userEvent.click(page.getByRole('button', { name: 'Vaciar la cola' }))

    expect(auditStore.getState().audit).toBeNull()
    expect(queueStore.getState().items).toHaveLength(0)
    await expect.element(page.getByText(/imágenes medibles/)).not.toBeInTheDocument()
    await expect.element(page.getByRole('heading', { level: 1, name: /archivo HAR/ })).toBeVisible()
  })
})

describe('what is not a HAR', () => {
  it('says so and leaves the queue empty', async () => {
    await render(<App tool="auditar" />)
    const photo = await fixtureBytes('no-exif.jpg')
    dropOn([new File([photo.slice()], 'foto.jpg')])

    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent(/no es JSON, así que no es un HAR/)
    expect(queueStore.getState().items).toHaveLength(0)
    expect(auditStore.getState().audit).toBeNull()
    await expect.element(page.getByRole('heading', { level: 1 })).toBeVisible()
  })

  it('tells JSON that is not a HAR apart', async () => {
    await render(<App tool="auditar" />)
    dropOn([new File(['{"hola": 1}'], 'datos.json')])

    await expect.element(page.getByRole('alert')).toHaveTextContent(/no un HAR/)
    expect(queueStore.getState().items).toHaveLength(0)
  })

  it('refuses several files at once', async () => {
    await render(<App tool="auditar" />)
    dropOn([new File(['{}'], 'a.har'), new File(['{}'], 'b.har')])

    await expect.element(page.getByRole('alert')).toHaveTextContent(/un solo archivo HAR/)
    expect(queueStore.getState().items).toHaveLength(0)
  })

  it('explains a HAR with no bodies, and adds nothing', async () => {
    await render(<App tool="auditar" />)
    const bare = har([
      entry({ url: `https://${HOST}/a.jpg`, status: 200, mimeType: 'image/jpeg', size: 9_000 }),
    ])
    dropOn([new File([bare], 'sin-contenido.har')])

    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent(/vuelve a exportar el HAR con el contenido de las respuestas incluido/)
    expect(queueStore.getState().items).toHaveLength(0)
    expect(auditStore.getState().audit).toBeNull()
  })

  it('reads the English page in English', async () => {
    await render(
      <CopyProvider value={en}>
        <App tool="auditar" />
      </CopyProvider>,
    )
    dropOn([new File(['no es json'], 'x.har')])

    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent(/is not JSON, so it is not a HAR/)
  })
})
