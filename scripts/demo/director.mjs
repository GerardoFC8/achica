/**
 * The director: drives the real page for the script, and keeps the timeline.
 *
 * Frames come from Chromium's own screencast (the DevTools protocol), which
 * hands over a lossless frame each time the page repaints, stamped with when
 * it was painted. That is what makes the motion smooth without guessing a
 * frame rate: the encoder later holds each frame for exactly as long as it
 * was on screen.
 *
 * Everything drawn here that is not the app lives in one fixed layer above
 * it, added only for the recording: a cursor, the ring a click leaves, and the
 * preview of the files being dragged in. The clicks themselves are real mouse
 * events at the cursor's position, and the drop is a real drop event carrying
 * real files, so the app takes the same road it takes for a person.
 */

import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const now = () => Date.now() / 1000
const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2)

/** Runs in the page. Kept free of closures so Playwright can serialise it. */
function installOverlay(count) {
  const layer = document.createElement('div')
  layer.id = 'demo-overlay'
  layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647'

  // The drag preview: a small stack of photos and a count, the way a desktop
  // shows files in flight. Its own palette, so it is never mistaken for UI.
  const card = (rotate, shift) =>
    `<div style="position:absolute;left:${shift}px;top:${shift}px;width:58px;height:44px;` +
    'border:2px solid #fff;border-radius:3px;box-shadow:0 2px 6px rgba(0,0,0,.28);' +
    `transform:rotate(${rotate}deg);` +
    'background:linear-gradient(180deg,#7fa7cf 0 45%,#c9b98f 45% 58%,#4f6b3a 58%)"></div>'
  const ghost = document.createElement('div')
  ghost.style.cssText = 'position:absolute;left:0;top:0;opacity:0'
  ghost.innerHTML =
    card(-9, 0) +
    card(5, 4) +
    card(-2, 8) +
    '<div style="position:absolute;left:52px;top:-6px;min-width:24px;height:24px;padding:0 6px;' +
    'border-radius:12px;background:#d93a2b;color:#fff;font:600 13px/24px system-ui,sans-serif;' +
    `text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.3)">${count}</div>`

  const ring = document.createElement('div')
  ring.style.cssText =
    'position:absolute;left:0;top:0;width:34px;height:34px;margin:-17px 0 0 -17px;' +
    'border-radius:50%;border:2px solid rgba(22,24,26,.55);opacity:0'

  const cursor = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  cursor.setAttribute('width', '24')
  cursor.setAttribute('height', '32')
  cursor.setAttribute('viewBox', '0 0 24 32')
  cursor.style.cssText =
    'position:absolute;left:0;top:0;margin:-2px 0 0 -2px;' +
    'filter:drop-shadow(0 1px 2px rgba(0,0,0,.35))'
  cursor.innerHTML =
    '<path d="M2 2 L2 24 L7.6 18.6 L11.4 27.4 L15 25.9 L11.3 17.3 L19 17.3 Z" ' +
    'fill="#16181A" stroke="#fff" stroke-width="1.7" stroke-linejoin="round"/>'

  const files = document.createElement('input')
  files.type = 'file'
  files.multiple = true
  files.id = 'demo-files'
  files.style.display = 'none'

  layer.append(ghost, ring, cursor, files)
  document.documentElement.append(layer)

  const place = (x, y) => {
    cursor.style.transform = `translate(${x}px, ${y}px)`
    ghost.style.transform = `translate(${x + 10}px, ${y + 14}px)`
  }
  place(-40, -40)

  window.addEventListener('pointermove', (event) => place(event.clientX, event.clientY), true)
  window.addEventListener(
    'pointerdown',
    (event) => {
      ring.style.left = `${event.clientX}px`
      ring.style.top = `${event.clientY}px`
      ring.animate(
        [
          { opacity: 0.9, transform: 'scale(.35)' },
          { opacity: 0, transform: 'scale(1.25)' },
        ],
        { duration: 450, easing: 'ease-out' },
      )
    },
    true,
  )

  window.__demo = {
    place,
    // A drop ends the drag at once, as on a desktop: it fades in, never out.
    ghost: (visible) => {
      ghost.style.transition = visible ? 'opacity .18s' : 'none'
      ghost.style.opacity = visible ? '1' : '0'
    },
    zone: () => document.querySelector('main input[type=file]')?.parentElement ?? null,
    dragOver: () => {
      window.__demo.zone()?.dispatchEvent(
        new DragEvent('dragover', {
          bubbles: true,
          cancelable: true,
          dataTransfer: new DataTransfer(),
        }),
      )
    },
    drop: () => {
      const transfer = new DataTransfer()
      for (const file of files.files ?? []) transfer.items.add(file)
      window.__demo
        .zone()
        ?.dispatchEvent(
          new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }),
        )
    },
  }
}

export class Director {
  /** @param {import('playwright').Page} page */
  constructor(page, { files, viewport, framesDir }) {
    this.page = page
    this.files = files
    this.viewport = viewport
    this.framesDir = framesDir
    this.position = { x: viewport.width * 0.18, y: viewport.height * 1.08 }

    this.frames = []
    this.pending = []
    this.captions = []
    this.fastForwards = []
    this.downloads = []
    this.start = 0
    this.end = 0
  }

  async prepare() {
    await this.page.evaluate(installOverlay, this.files.length)
    // Handed over before recording starts, so the drop is instant on film.
    await this.page.setInputFiles('#demo-files', this.files)
    await this.page.evaluate(({ x, y }) => window.__demo.place(x, y), this.position)
  }

  async record(script) {
    const cdp = await this.page.context().newCDPSession(this.page)

    cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
      const file = join(this.framesDir, `f${String(this.frames.length).padStart(5, '0')}.jpg`)
      this.frames.push({ file, t: metadata.timestamp ?? now() })
      this.pending.push(writeFile(file, Buffer.from(data, 'base64')))
      cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {})
    })

    const scale = await this.page.evaluate(() => window.devicePixelRatio)
    await cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 92,
      maxWidth: Math.round(this.viewport.width * scale),
      maxHeight: Math.round(this.viewport.height * scale),
      everyNthFrame: 1,
    })
    // Let the first frame land before the clock starts.
    await sleep(400)

    this.start = now()
    try {
      await script()
    } finally {
      this.end = now()
      await sleep(150)
      await cdp.send('Page.stopScreencast').catch(() => {})
      await Promise.all(this.pending)
    }
  }

  caption(text, tag = null) {
    this.captions.push({ t: now(), text, tag })
  }

  hold(ms) {
    return sleep(ms)
  }

  /**
   * Glides the cursor along a shallow arc, at a speed set by the distance, the
   * way a hand moves a mouse: quick across the screen, careful near the end.
   */
  async moveTo(x, y, ms) {
    const from = { ...this.position }
    const distance = Math.hypot(x - from.x, y - from.y)
    const duration = ms ?? Math.min(820, Math.max(320, 220 + distance * 0.62))
    // The arc bows perpendicular to the path by a fraction of its length.
    const bow = Math.min(60, distance * 0.12)
    const nx = distance === 0 ? 0 : -(y - from.y) / distance
    const ny = distance === 0 ? 0 : (x - from.x) / distance

    const begun = performance.now()
    for (;;) {
      const k = Math.min(1, (performance.now() - begun) / duration)
      const e = ease(k)
      const lift = Math.sin(Math.PI * e) * bow
      const px = from.x + (x - from.x) * e + nx * lift
      const py = from.y + (y - from.y) * e + ny * lift
      // Outside the viewport the browser sends the page no pointer events,
      // so the drawn cursor is placed by hand until it enters.
      const inside = px >= 0 && py >= 0 && px < this.viewport.width && py < this.viewport.height
      if (inside) await this.page.mouse.move(px, py)
      else await this.page.evaluate(([cx, cy]) => window.__demo.place(cx, cy), [px, py])
      if (k === 1) break
      await sleep(10)
    }
    this.position = { x, y }
  }

  async centerOf(locator) {
    await locator.waitFor({ state: 'visible', timeout: 30_000 })
    // A control below the fold of a scrolling panel has a box outside it, and
    // a click there lands on whatever is on top. Scrolled into view, the
    // scroll is also on film, which is what a person would see.
    await locator.scrollIntoViewIfNeeded()
    const box = await locator.boundingBox()
    if (box === null) throw new Error(`no box for ${locator}`)
    return { x: box.x + box.width / 2, y: box.y + box.height / 2, box }
  }

  async click(locator) {
    const { x, y } = await this.centerOf(locator)
    await this.moveTo(x, y)
    await sleep(110)
    await this.page.mouse.down()
    await sleep(80)
    await this.page.mouse.up()
    await sleep(90)
  }

  /** Rests the cursor just under and left of a piece of text, pointing at it. */
  async pointAt(locator) {
    const { box } = await this.centerOf(locator)
    await this.moveTo(box.x + box.width * 0.35, box.y + box.height + 4)
  }

  /** Out of the way of the rows, in the toolbar's empty middle. */
  async park() {
    await this.moveTo(this.viewport.width * 0.62, 30)
  }

  /** Drags the photo stack in from the bottom edge and drops it. */
  async dropFiles() {
    const zone = this.page.locator('main input[type=file]').locator('..')
    const { x, y, box } = await this.centerOf(zone)

    await this.page.evaluate(() => window.__demo.ghost(true))
    // In over the zone's lower edge first, which is when it lights up.
    await this.moveTo(x - 60, box.y + box.height * 0.72, 800)
    await this.page.evaluate(() => window.__demo.dragOver())
    await this.moveTo(x, y + 20, 450)
    await sleep(220)
    await this.page.evaluate(() => {
      window.__demo.ghost(false)
      window.__demo.drop()
    })
  }

  /** Waits until both pictures in the comparator have decoded. */
  async imagesReady() {
    await this.page.waitForFunction(() => {
      const images = [...document.querySelectorAll('[role=dialog] img')]
      return images.length === 2 && images.every((image) => image.complete && image.naturalWidth)
    })
  }

  /** Grabs the curtain and takes it to each stop, as fractions of the picture. */
  async dragCurtain(stops) {
    const handle = this.page.getByRole('slider')
    const { x, y } = await this.centerOf(handle)
    // The curtain moves across the picture's box, which is the slider's parent.
    const frame = await handle.locator('..').boundingBox()
    if (frame === null) throw new Error('no box for the comparison frame')

    await this.moveTo(x, y)
    await sleep(120)
    await this.page.mouse.down()
    for (const stop of stops) {
      await this.moveTo(frame.x + frame.width * stop, y, 820)
      await sleep(160)
    }
    await this.page.mouse.up()
  }

  async download(locator) {
    const [download] = await Promise.all([
      this.page.waitForEvent('download', { timeout: 60_000 }),
      this.click(locator),
    ])
    this.downloads.push(download)
  }

  /**
   * Runs `action` sped up so it lasts about `seconds` on film. The factor is a
   * whole number because the caption band prints it, and "3×" is a claim a
   * viewer can hold the video to.
   */
  async fastForward(seconds, label, action) {
    const previous = this.captions.at(-1)
    /*
     * The busy rows pulse on a 1.2 s cycle, and sped up several times over
     * that pulse turns into a strobe. The app's own reduced-motion mode holds
     * the busy signal still, so the fast stretch is filmed in that mode.
     */
    await this.page.emulateMedia({ reducedMotion: 'reduce' })
    const from = now()
    this.caption(previous?.text ?? '', label)
    await action()
    const to = now()
    await this.page.emulateMedia({ reducedMotion: 'no-preference' })

    const factor = Math.max(1, Math.round((to - from) / seconds))
    this.fastForwards.push({ from, to, factor })
    this.captions.at(-1).tag = factor > 1 ? { label, factor } : null
    this.caption(previous?.text ?? '')
    return factor
  }

  /** Real time to film time, with every fast-forward folded in. */
  filmTime(t) {
    let film = t - this.start
    for (const { from, to, factor } of this.fastForwards) {
      const overlap = Math.max(0, Math.min(t, to) - from)
      film -= overlap * (1 - 1 / factor)
    }
    return film
  }
}
