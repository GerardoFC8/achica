/**
 * The images other sites show for achica: the link preview (public/og.png,
 * 1200x630, what WhatsApp, X, LinkedIn and Slack put under a shared link) and
 * the home-screen icon iOS asks for (public/apple-touch-icon.png).
 *
 * Drawn as HTML in Playwright with the app's own fonts and tokens, so they are
 * regenerated instead of exported from a design tool nobody has. No figures on
 * the preview: the three bars are the weight bar as a mark, not a result, and
 * a number on them would be one the app never measured.
 *
 * Left-aligned and quiet on purpose; the anti-defaults in docs/spec.md
 * (section 8) hold for a preview as much as for the interface.
 *
 * Run: npm run og
 */

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// The tokens from src/styles.css. Copied rather than parsed: six values that
// change once a year, against a CSS parser for a script.
const PAPER = '#f2f1ec'
const INK = '#16181a'
const INK_SOFT = '#5b6165'
const FITS = '#0d5c52'
const TIGHT = '#955d00'
const RULE = '#d8d7d3'

const font = await readFile(join(ROOT, 'src', 'fonts', 'instrument-sans.woff2'))
const favicon = await readFile(join(ROOT, 'public', 'favicon.svg'), 'utf8')

const BASE_STYLE = `
  @font-face {
    font-family: 'Instrument Sans';
    src: url(data:font/woff2;base64,${font.toString('base64')}) format('woff2');
    font-weight: 400 700;
  }
  * { margin: 0; box-sizing: border-box; }
  html, body { background: ${PAPER}; color: ${INK}; }
  body { font-family: 'Instrument Sans', sans-serif; -webkit-font-smoothing: antialiased; }
`

/** One weight bar: the track, what the file weighs now, and where the budget sits. */
const bar = (fill, colour, mark) => `
  <div style="position: relative; height: 18px; background: ${RULE};">
    <div style="width: ${fill * 100}%; height: 100%; background: ${colour};"></div>
    ${
      mark === null
        ? ''
        : `<div style="position: absolute; left: ${mark * 100}%; top: -8px; width: 4px; height: 34px; background: ${INK};"></div>`
    }
  </div>`

const PREVIEW = `
  <style>${BASE_STYLE}</style>
  <div style="width: 1200px; height: 630px; padding: 64px 72px; display: flex; flex-direction: column;">
    <div style="display: flex; justify-content: space-between; align-items: baseline;">
      <p style="font-size: 40px; font-weight: 600; letter-spacing: -0.02em;">achica</p>
      <p style="font-size: 24px; color: ${INK_SOFT};">achica.gfcode.dev</p>
    </div>

    <p style="margin-top: 64px; max-width: 980px; font-size: 68px; line-height: 1.06; font-weight: 600; letter-spacing: -0.025em;">
      Comprime muchas imágenes a&nbsp;la vez, sin subirlas.
    </p>
    <p style="margin-top: 24px; font-size: 28px; line-height: 1.3; color: ${INK_SOFT};">
      En tu navegador. Sin cuentas, sin límite de archivos, de código abierto.
    </p>

    <div style="margin-top: auto; display: grid; gap: 22px;">
      ${bar(0.34, FITS, null)}
      ${bar(0.58, FITS, null)}
      ${bar(0.86, TIGHT, 0.9)}
    </div>
  </div>`

const ICON = `
  <style>${BASE_STYLE}</style>
  <div style="width: 180px; height: 180px; background: ${PAPER};">
    ${favicon.replace('<svg ', '<svg width="180" height="180" ')}
  </div>`

const browser = await chromium.launch()

try {
  const page = await browser.newPage({ deviceScaleFactor: 1 })

  for (const { html, width, height, out } of [
    { html: PREVIEW, width: 1200, height: 630, out: 'og.png' },
    { html: ICON, width: 180, height: 180, out: 'apple-touch-icon.png' },
  ]) {
    await page.setViewportSize({ width, height })
    await page.setContent(html)
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: join(ROOT, 'public', out), type: 'png' })
    console.log(`public/${out}, ${width}x${height}`)
  }
} finally {
  await browser.close()
}
