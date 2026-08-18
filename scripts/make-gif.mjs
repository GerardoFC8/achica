/**
 * The README's animation: the flow in motion, which a still cannot show.
 *
 * Frames come from the real app on the production build, so what moves here is
 * what ships. They are decoded back to pixels inside the browser that took
 * them — Node has no PNG decoder and adding one to read our own screenshots
 * would be a dependency for nothing.
 *
 * Small on purpose: 640 wide keeps the file inside what a README should carry,
 * and this interface is a table of numbers that stays legible at that size.
 *
 * Run: npm run build && npm run gif
 */

import { writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
// gifenc ships CommonJS, so the named exports come off the default.
import gifenc from 'gifenc'
import { chromium } from 'playwright'
import { preview } from 'vite'

const { applyPalette, GIFEncoder, quantize } = gifenc

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const fixture = (path) => join(ROOT, 'test', 'fixtures', path)

const FILES = [
  fixture('vendor/exif-orientation/Landscape_6.jpg'),
  fixture('vendor/exif-orientation/Portrait_6.jpg'),
  fixture('generated/no-exif.jpg'),
  fixture('generated/orientation-6.jpg'),
  fixture('generated/sample.webp'),
  fixture('vendor/pngsuite/xd0n2c08.png'),
]

const VIEWPORT = { width: 640, height: 360 }

const server = await preview({ logLevel: 'error', preview: { port: 0 } })
const base = server.resolvedUrls?.local?.[0]
if (base === undefined) throw new Error('vite preview did not report a local url')

const browser = await chromium.launch()

try {
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 })
  const frames = []

  /**
   * Screenshot, then hand it back to the page to be turned into pixels. The
   * round trip is the cheapest decoder available: the browser already has one.
   */
  const capture = async (delay) => {
    const png = await page.screenshot({ type: 'png' })

    const frame = await page.evaluate(
      async (dataUrl) => {
        const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob())
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
        const context = canvas.getContext('2d')
        if (context === null) throw new Error('no 2d context')

        context.drawImage(bitmap, 0, 0)
        const { data, width, height } = context.getImageData(0, 0, bitmap.width, bitmap.height)

        // Chunked, because spreading a million arguments into fromCharCode
        // overflows the stack.
        let binary = ''
        for (let at = 0; at < data.length; at += 0x8000) {
          binary += String.fromCharCode(...data.subarray(at, at + 0x8000))
        }

        return { width, height, base64: btoa(binary) }
      },
      `data:image/png;base64,${png.toString('base64')}`,
    )

    frames.push({
      width: frame.width,
      height: frame.height,
      rgba: new Uint8ClampedArray(Buffer.from(frame.base64, 'base64')),
      delay,
    })
  }

  await page.goto(base)
  await page.waitForTimeout(500)
  await capture(1_400)

  await page.setInputFiles('input[type=file]', FILES)
  await page.waitForTimeout(400)
  await capture(1_200)

  await page.getByRole('button', { name: /Comprimir/ }).click()

  // Three glimpses of the queue working, then the result held long enough to
  // read. A loop that stops on the answer is the whole story.
  for (let shot = 0; shot < 3; shot += 1) {
    await page.waitForTimeout(600)
    await capture(600)
  }

  await page.waitForFunction(
    () => !(document.body.textContent ?? '').includes('Comprimiendo'),
    undefined,
    { timeout: 120_000 },
  )
  await page.waitForTimeout(300)
  await capture(3_000)

  const encoder = GIFEncoder()

  for (const frame of frames) {
    const palette = quantize(frame.rgba, 256)
    const indexed = applyPalette(frame.rgba, palette)
    encoder.writeFrame(indexed, frame.width, frame.height, { palette, delay: frame.delay })
  }

  encoder.finish()
  const bytes = encoder.bytes()

  const target = join(ROOT, 'docs', 'demo.gif')
  await writeFile(target, bytes)
  console.log(`demo.gif — ${frames.length} frames, ${(bytes.length / 1024).toFixed(0)} KB`)
} finally {
  await browser.close()
  await server.close()
}
