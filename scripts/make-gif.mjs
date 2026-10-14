/**
 * The README's animation, and the video the same take becomes for posts.
 *
 * One recording, two files: docs/demo.gif for the README and docs/demo.mp4
 * (H.264, yuv420p, faststart) for the places that want a video. It is shot on
 * the production build served by `vite preview`, with a batch of two dozen
 * phone-sized pictures, so what moves here is what ships and every figure on
 * screen is one the app computed.
 *
 *   scripts/demo/guion.mjs     the scenes and the captions: edit this one
 *   scripts/demo/director.mjs  the cursor, the drop, the screencast
 *   scripts/demo/lote.mjs      the batch, built into the temp directory
 *
 * Needs ffmpeg on the PATH. It is a system binary and not an npm dependency:
 * it builds the batch and encodes both files. The palette for the GIF comes
 * from ffmpeg's palettegen and paletteuse, which pick one palette for the
 * whole take and only rewrite the rectangle that changed between frames; that
 * is what keeps twenty seconds of interface near two megabytes. It replaces
 * gifenc, which quantised every frame on its own and is no longer a
 * dependency.
 *
 * Run:  npm run build && npm run gif
 *       npm run gif -- --lang en      (another interface: docs/demo-en.*)
 *       npm run gif -- --fresh        (rebuild the batch even if cached)
 *       npm run gif -- --keep         (leave the raw frames on disk)
 */

import { execFile } from 'node:child_process'
import { mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs, promisify } from 'node:util'
import { chromium } from 'playwright'
import { preview } from 'vite'
import { Director } from './demo/director.mjs'
import { guion, IDIOMAS } from './demo/guion.mjs'
import { prepareBatch } from './demo/lote.mjs'

const run = promisify(execFile)
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * The app's own viewport, in CSS pixels, captured at twice the density. The
 * GIF is the 1x reading of it, which is what a README column shows at full
 * size; the video keeps the 2x frames.
 */
const VIEWPORT = { width: 960, height: 544 }
const DENSITY = 2
const BAND = 56
const PAPER = '0xF2F1EC'

const GIF_FPS = 15
const VIDEO_FPS = 30
const FADE_IN = 0.3
const FADE_OUT = 0.45

const { values: args } = parseArgs({
  options: {
    lang: { type: 'string', default: 'es' },
    fresh: { type: 'boolean', default: false },
    keep: { type: 'boolean', default: false },
  },
})

const idioma = IDIOMAS[args.lang]
if (idioma === undefined) {
  console.error(`No script for "${args.lang}". Languages: ${Object.keys(IDIOMAS).join(', ')}`)
  process.exit(1)
}

try {
  await stat(join(ROOT, 'dist', 'index.html'))
} catch {
  console.error('No dist/ to record. Run npm run build first.')
  process.exit(1)
}

/**
 * Playwright's own Chromium when it is installed, and otherwise the newest
 * one in PLAYWRIGHT_BROWSERS_PATH: a preinstalled browser one revision off is
 * fine for a recording, and failing on it would only send someone to
 * download a browser they already have.
 */
async function launch() {
  /*
   * Emulated density alone is not enough: the screencast hands back frames at
   * CSS size and ignores it. Forcing the scale factor on the browser itself
   * makes the compositor paint, and the screencast deliver, at 2x.
   */
  const options = { args: [`--force-device-scale-factor=${DENSITY}`] }
  try {
    return await chromium.launch(options)
  } catch (error) {
    const root = process.env.PLAYWRIGHT_BROWSERS_PATH
    if (root === undefined || !/Executable doesn't exist/.test(String(error))) throw error

    const builds = (await readdir(root)).filter((name) => /^chromium-\d+$/.test(name)).sort()
    const newest = builds.at(-1)
    if (newest === undefined) throw error

    const executablePath = join(root, newest, 'chrome-linux', 'chrome')
    console.log(`chromium: using ${executablePath}`)
    return chromium.launch({ ...options, executablePath })
  }
}

/** Seconds, as ffconcat wants them. */
const seconds = (value) => value.toFixed(4)

/**
 * A concat list that holds each image for its duration. The last entry is
 * repeated because the demuxer otherwise drops the final duration.
 */
async function concatList(path, entries) {
  const lines = ['ffconcat version 1.0']
  for (const { file, duration } of entries) {
    lines.push(`file '${file}'`, `duration ${seconds(duration)}`)
  }
  lines.push(`file '${entries.at(-1).file}'`)
  await writeFile(path, `${lines.join('\n')}\n`)
}

/** Renders each caption as the dark band that sits under the app. */
async function renderCaptions(browser, base, captions, site, dir) {
  const page = await browser.newPage({
    viewport: { width: VIEWPORT.width, height: BAND },
    deviceScaleFactor: DENSITY,
  })

  try {
    // The app's own page, for its self-hosted typefaces; the band replaces it.
    await page.goto(base)
    const files = new Map()

    for (const { text, tag } of captions) {
      const key = JSON.stringify([text, tag])
      if (files.has(key)) continue

      const file = join(dir, `band-${files.size}.png`)
      await page.evaluate(
        ({ text, tag, site, height }) => {
          const band = document.createElement('div')
          band.style.cssText =
            `box-sizing:border-box;width:100vw;height:${height}px;padding:0 20px;` +
            'display:flex;align-items:center;gap:14px;background:#16181A;color:#F2F1EC;' +
            "font-family:'Instrument Sans',system-ui,sans-serif"

          const line = document.createElement('p')
          line.textContent = text
          line.style.cssText =
            'margin:0;flex:1;min-width:0;font-size:17px;line-height:22px;font-weight:500;' +
            'white-space:nowrap;overflow:hidden;text-overflow:ellipsis'
          band.append(line)

          if (tag !== null) {
            const chip = document.createElement('span')
            chip.style.cssText =
              'flex:none;font-size:12px;line-height:16px;padding:3px 8px;border-radius:2px;' +
              'border:1px solid rgba(242,241,236,.5)'
            const factor = document.createElement('span')
            factor.textContent = `${tag.factor}×`
            factor.style.fontFamily = "'Martian Mono',ui-monospace,monospace"
            chip.append(`${tag.label} `, factor)
            band.append(chip)
          }

          const url = document.createElement('span')
          url.textContent = site
          url.style.cssText = 'flex:none;font-size:13px;line-height:16px;opacity:.62'
          band.append(url)

          document.body.style.margin = '0'
          document.body.replaceChildren(band)
        },
        { text, tag, site, height: BAND },
      )
      await page.evaluate(() => document.fonts.ready)
      await page.screenshot({ path: file })
      files.set(key, file)
    }

    return files
  } finally {
    await page.close()
  }
}

const fixtures = join(ROOT, 'test', 'fixtures', 'vendor', 'exif-orientation')
const files = await prepareBatch({ fixtures, fresh: args.fresh })

const work = await mkdtemp(join(tmpdir(), 'achica-demo-'))
const server = await preview({ logLevel: 'error', preview: { port: 0 } })
const local = server.resolvedUrls?.local?.[0]
if (local === undefined) throw new Error('vite preview did not report a local url')
const base = new URL(idioma.path, local).href

const browser = await launch()
let director

try {
  const page = await browser.newPage({
    viewport: VIEWPORT,
    deviceScaleFactor: DENSITY,
    acceptDownloads: true,
  })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))

  await page.goto(base)
  await page.evaluate(() => document.fonts.ready)

  director = new Director(page, { files, viewport: VIEWPORT, framesDir: work })
  await director.prepare()
  console.log(`recording ${base}`)
  await director.record(() => guion(director, idioma))

  if (errors.length > 0) throw new Error(`the page threw: ${errors.join('; ')}`)

  const footer = (await page.locator('footer').innerText()).replace(/\s+/g, ' ')
  console.log(`footer: ${footer}`)
  for (const download of director.downloads) {
    const archive = join(work, download.suggestedFilename())
    await download.saveAs(archive)
    console.log(
      `zip: ${download.suggestedFilename()}, ${((await stat(archive)).size / 1e6).toFixed(2)} MB`,
    )
  }

  // The app track: each frame held until the next one replaced it.
  const { frames, start, end } = director
  const shown = frames.filter((frame, at) => (frames[at + 1]?.t ?? end) > start && frame.t < end)
  const appTrack = shown.map((frame, at) => {
    const from = director.filmTime(Math.max(frame.t, start))
    const to = director.filmTime(Math.min(shown[at + 1]?.t ?? end, end))
    return { file: frame.file, duration: to - from }
  })
  const duration = director.filmTime(end)

  // The caption track, from the same clock.
  const bands = await renderCaptions(browser, base, director.captions, idioma.captions.site, work)
  const captions = director.captions.filter((caption) => caption.t < end)
  const bandTrack = captions
    .map((caption, at) => ({
      file: bands.get(JSON.stringify([caption.text, caption.tag])),
      duration:
        director.filmTime(Math.min(captions[at + 1]?.t ?? end, end)) -
        director.filmTime(Math.max(caption.t, start)),
    }))
    // A caption replaced in the same instant it was set never reached the screen.
    .filter((entry) => entry.duration > 0.001)

  await concatList(join(work, 'app.txt'), appTrack)
  await concatList(join(work, 'band.txt'), bandTrack)

  const fps = director.frames.length / (end - start)
  const sped = director.fastForwards.map(
    (ff) => `${(ff.to - ff.from).toFixed(1)} s at ${ff.factor}×`,
  )
  console.log(
    `take: ${(end - start).toFixed(1)} s real, ${duration.toFixed(1)} s on film, ` +
      `${director.frames.length} frames (${fps.toFixed(1)} per second)` +
      (sped.length > 0 ? `, sped up ${sped.join(', ')}` : ''),
  )

  const inputs = [
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    'app.txt',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    'band.txt',
  ]
  const fades =
    `trim=duration=${seconds(duration)},` +
    `fade=t=in:st=0:d=${FADE_IN}:color=${PAPER},` +
    `fade=t=out:st=${seconds(duration - FADE_OUT)}:d=${FADE_OUT}:color=${PAPER}`
  const ffmpeg = (extra) =>
    run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...inputs, ...extra], {
      cwd: work,
      maxBuffer: 1 << 24,
    })

  const video = join(ROOT, 'docs', `${idioma.output}.mp4`)
  await ffmpeg([
    '-filter_complex',
    `[0]fps=${VIDEO_FPS},format=rgb24[app];[1]fps=${VIDEO_FPS},format=rgb24[band];` +
      `[app][band]vstack=shortest=1,${fades},format=yuv420p`,
    '-c:v',
    'libx264',
    '-preset',
    'slow',
    '-crf',
    '18',
    '-movflags',
    '+faststart',
    '-r',
    String(VIDEO_FPS),
    video,
  ])

  /*
   * One palette for the whole take, weighted toward what moves (stats_mode
   * diff), and only the rectangle that changed is written to each frame. The
   * dither is ordered rather than error diffusion on purpose: a Bayer pattern
   * is fixed to the pixel grid, so redithering one rectangle leaves no seam at
   * its edge and nothing shimmers where the interface holds still. Measured
   * on this take, sierra2_4a looked marginally smoother in the photograph's
   * sky and weighed a fifth more.
   */
  const gif = join(ROOT, 'docs', `${idioma.output}.gif`)
  const width = VIEWPORT.width
  await ffmpeg([
    '-filter_complex',
    `[0]fps=${GIF_FPS},scale=${width}:-1:flags=lanczos,format=rgb24[app];` +
      `[1]fps=${GIF_FPS},scale=${width}:-1:flags=lanczos,format=rgb24[band];` +
      `[app][band]vstack=shortest=1,${fades},split[a][b];` +
      '[a]palettegen=max_colors=256:stats_mode=diff[palette];' +
      '[b][palette]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle',
    gif,
  ])

  for (const path of [gif, video]) {
    console.log(`${path.slice(ROOT.length + 1)}: ${((await stat(path)).size / 1e6).toFixed(2)} MB`)
  }
} finally {
  await browser.close()
  await server.close()
  if (args.keep) console.log(`frames kept in ${work}`)
  else await rm(work, { recursive: true, force: true })
}
