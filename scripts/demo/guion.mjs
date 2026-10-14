/**
 * The demo's script: what happens, in what order, and what the captions say.
 *
 * This is the file to edit when the product changes. The machinery that moves
 * the cursor, records the page and encodes the result lives in director.mjs
 * and make-gif.mjs, and none of it needs touching to add a scene, reword a
 * caption or record another language.
 *
 * Every number on screen is the app's own: the batch is real files, the queue
 * really compresses them, and the comparator opens the real result. The only
 * things drawn on top are the cursor, the drag preview and the caption band
 * under the app, which is dark on purpose so it never reads as part of it.
 */

/**
 * One entry per language. `path` is where that interface is served; `ui` is
 * the visible text the script finds controls by, so a renamed button fails
 * loudly instead of recording a demo that clicks nothing.
 */
export const IDIOMAS = {
  es: {
    path: '/',
    output: 'demo',
    ui: {
      destination: /^Destino/,
      profile: /^Imagen para artículo web/,
      budget: '200 KB',
      compress: /^Comprimir \d+ imágenes$/,
      compare: 'Comparar',
      close: 'Cerrar',
      zip: /^Descargar \d+ en un ZIP$/,
    },
    captions: {
      drop: 'Suelta una carpeta entera. No se sube nada: todo pasa en tu navegador.',
      destination: 'Eliges a dónde va la imagen, no un número de calidad.',
      budget: 'Y si hace falta, un tope: todas bajo 200 KB.',
      queue: 'La cola comprime el lote en paralelo, sin tope de archivos.',
      total: 'El ahorro de cada archivo y el del lote completo.',
      compare: 'Antes y después, con una cortina que se arrastra.',
      zip: 'Y todo sale en un ZIP.',
      fastForward: 'acelerado',
      site: 'achica.gfcode.dev',
    },
  },

  en: {
    path: '/en/',
    output: 'demo-en',
    ui: {
      destination: /^Destination/,
      profile: /^Image for a web article/,
      budget: '200 KB',
      compress: /^Compress \d+ images$/,
      compare: 'Compare',
      close: 'Close',
      zip: /^Download \d+ as a ZIP$/,
    },
    captions: {
      drop: 'Drop a whole folder. Nothing is uploaded: it all happens in your browser.',
      destination: 'Pick where the image is going, not a quality number.',
      budget: 'And a limit when you need one: all of them under 200 KB.',
      queue: 'The queue compresses the batch in parallel, with no file limit.',
      total: 'What each file saved, and what the whole batch did.',
      compare: 'Before and after, with a curtain you drag.',
      zip: 'And it all comes out in a ZIP.',
      fastForward: 'sped up',
      site: 'achica.gfcode.dev',
    },
  },
}

/** Name of the file whose row opens the comparator: the real photograph. */
export const COMPARED = 'IMG_2041.jpg'

/**
 * The scenes. `d` is the director (director.mjs): it moves a visible cursor,
 * clicks for real, and keeps the timeline the encoder cuts from. `t` is the
 * language entry above. Holds are in milliseconds of the finished video.
 */
export async function guion(d, t) {
  const { page } = d
  const { ui, captions } = t

  // 1. The empty work surface, and a folder's worth of photos dropped on it.
  d.caption(captions.drop)
  await d.hold(500)
  await d.dropFiles()
  await d.hold(800)

  // 2. The destination, which is the decision the product is built around.
  d.caption(captions.destination)
  await d.click(page.getByRole('button', { name: ui.destination }))
  await d.hold(850)
  await d.click(page.getByRole('button', { name: ui.profile }))
  await d.hold(200)

  // 2b. The weight ceiling (D53), which is what puts the budget mark on every
  //     weight bar, the interface's one distinctive element.
  d.caption(captions.budget)
  await d.click(page.getByRole('button', { name: ui.destination }))
  await d.hold(500)
  await d.click(page.getByRole('button', { name: ui.budget, exact: true }))
  await d.hold(500)
  await d.click(page.getByRole('button', { name: ui.destination }))
  // Fail the take, not the viewer: a ceiling that did not land would record
  // a demo promising one thing and showing another.
  await page
    .getByRole('button', { name: new RegExp(`${ui.destination.source}.*${ui.budget}`) })
    .waitFor({ timeout: 2_000 })
  await d.hold(200)

  // 3. The queue resolving live. Real time on this machine is longer than a
  //    post can hold, so it is sped up and the caption band says by how much.
  d.caption(captions.queue)
  await d.click(page.getByRole('button', { name: ui.compress }))
  await d.fastForward(2.4, captions.fastForward, async () => {
    await d.park()
    await page.getByRole('button', { name: ui.zip }).waitFor({ timeout: 180_000 })
  })

  // 4. The figure the user came for.
  d.caption(captions.total)
  await d.hold(200)
  await d.pointAt(page.locator('footer p', { hasText: '%' }))
  await d.hold(1200)

  // 5. One result opened against its original, and the curtain dragged.
  d.caption(captions.compare)
  const row = page.getByRole('row').filter({ hasText: COMPARED })
  await d.click(row.getByRole('button', { name: ui.compare, exact: true }))
  await d.imagesReady()
  await d.hold(350)
  await d.dragCurtain([0.86, 0.22])
  await d.hold(300)
  await d.click(page.getByRole('button', { name: ui.close, exact: true }))
  await d.hold(150)

  // 6. Everything out in one archive.
  d.caption(captions.zip)
  await d.download(page.getByRole('button', { name: ui.zip }))
  await d.pointAt(page.getByRole('status'))
  await d.hold(1100)
}
