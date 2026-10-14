/**
 * The batch the demo drops: two dozen pictures that weigh what a phone's do.
 *
 * Nothing here is committed. The recipe is, and the files are rebuilt from it
 * into the system's temp directory, then reused while the recipe is unchanged:
 * a hundred megabytes of pictures would be the wrong thing to put in a
 * repository whose whole argument is making pictures lighter.
 *
 * Two of them are real photographs, the ones the EXIF fixtures carry, cropped
 * clear of the orientation labels printed on them and scaled to a phone
 * sensor's size. Those are the ones worth opening in the comparator. The rest
 * are built by ffmpeg out of layered noise at several scales, a gradient for
 * the light and a fine grain on top, so they compress the way a photo does
 * instead of the way a flat test card does. None of them is damaged: a failure
 * belongs in the smoke test, not in the first seconds of a demo.
 *
 * ffmpeg is a system binary, not an npm dependency. It is what encodes the
 * animation too, so the demo needs it either way.
 */

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { availableParallelism, tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

/** Top to bottom: sky or ceiling, light, ground, shadow. */
const PALETTES = {
  campo: ['5f8fc0', 'e8d6b0', '3d5a2a', '22301c'],
  playa: ['7fb3d5', 'f2e5c8', 'd8c39a', '8a7350'],
  atardecer: ['2b2d5c', 'd9785a', 'f0b67f', '3a2a26'],
  noche: ['0f1424', '2a3550', 'c9a35a', '1a1a1a'],
  interior: ['8a5a3c', 'd8b48a', '6b4a33', '2a1d16'],
  bosque: ['9fb7a0', '4f6b3a', '2c3d22', '151d10'],
  nieve: ['c8d6e5', 'f5f7fa', 'aeb9c4', '5d6873'],
}

const LANDSCAPE = [4032, 3024]
const PORTRAIT = [3024, 4032]
/** A second phone in the family, so not every row has the same dimensions. */
const OTHER_PHONE = [4000, 3000]

const synthetic = (name, palette, [width, height], seed, quality = 2) => ({
  kind: 'synthetic',
  name,
  palette,
  width,
  height,
  seed,
  quality,
})

/**
 * The batch, in the order it is dropped, which is the order the queue shows.
 * The landscape photograph sits third so its row is on screen when the demo
 * opens the comparator.
 */
export const LOTE = [
  synthetic('IMG_2038.jpg', 'campo', LANDSCAPE, 11),
  synthetic('IMG_2039.jpg', 'campo', LANDSCAPE, 23),
  { kind: 'photo', name: 'IMG_2041.jpg', source: 'Landscape_6.jpg' },
  synthetic('IMG_2042.jpg', 'playa', LANDSCAPE, 37),
  synthetic('IMG_2043.jpg', 'playa', PORTRAIT, 41),
  synthetic('IMG_2044.jpg', 'atardecer', LANDSCAPE, 53),
  synthetic('IMG_2045.jpg', 'atardecer', LANDSCAPE, 67, 3),
  synthetic('IMG_2047.jpg', 'bosque', PORTRAIT, 71),
  synthetic('IMG_2048.jpg', 'bosque', LANDSCAPE, 83),
  { kind: 'photo', name: 'IMG_2050.jpg', source: 'Portrait_6.jpg' },
  synthetic('IMG_2051.jpg', 'interior', LANDSCAPE, 97, 3),
  synthetic('IMG_2052.jpg', 'interior', PORTRAIT, 101),
  synthetic('IMG_2053.jpg', 'noche', LANDSCAPE, 113),
  synthetic('IMG_2054.jpg', 'noche', LANDSCAPE, 127, 3),
  { kind: 'screenshot', name: 'Screenshot_20250611-183205.png', width: 1080, height: 2400 },
  synthetic('IMG_2056.jpg', 'nieve', LANDSCAPE, 131),
  synthetic('IMG_2057.jpg', 'nieve', OTHER_PHONE, 137),
  synthetic('IMG_2058.jpg', 'campo', OTHER_PHONE, 149),
  synthetic('IMG_2060.jpg', 'playa', LANDSCAPE, 151),
  synthetic('IMG_2061.jpg', 'atardecer', PORTRAIT, 163),
  synthetic('IMG_2062.jpg', 'bosque', LANDSCAPE, 173, 3),
  synthetic('IMG_2063.jpg', 'interior', LANDSCAPE, 181),
  synthetic('IMG_2064.jpg', 'campo', PORTRAIT, 191),
  synthetic('IMG_2065.jpg', 'noche', OTHER_PHONE, 197),
]

/**
 * The photographs' crops, in their upright orientation (ffmpeg applies the
 * EXIF rotation before filtering). Each one leaves the printed labels out of
 * frame, and the two labels that sit inside the landscape's crop are covered
 * with a patch of the rock and grass beside them.
 */
const PHOTO_FILTERS = {
  'Landscape_6.jpg': {
    graph:
      '[0]split=3[base][rock][slope];' +
      '[rock]crop=200:100:1590:650[p1];' +
      // Feathered over 22 px, so the slope's texture runs through its edges.
      '[slope]crop=165:200:680:520,format=rgba,' +
      "geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='255*min(1,min(min(X,W-1-X),min(Y,H-1-Y))/22)'[p2];" +
      '[base]delogo=x=825:y=20:w=150:h=95[b0];' +
      '[b0][p1]overlay=1590:535[b1];' +
      '[b1][p2]overlay=818:485[b2];' +
      '[b2]crop=1620:1080:150:0,scale=4032:2688:flags=lanczos,',
    seed: 5,
  },
  'Portrait_6.jpg': {
    graph: '[0]delogo=x=540:y=800:w=120:h=175,crop=828:1104:170:566,scale=3024:4032:flags=lanczos,',
    seed: 9,
  },
}

/** A sensor's grain: luma only, the way a phone's noise reduction leaves it. */
const grain = (seed, strength) =>
  `format=yuv444p,noise=c0s=${strength}:c0f=t:all_seed=${seed},format=yuvj420p`

function argsFor(entry, fixtures, target) {
  const quiet = ['-hide_banner', '-loglevel', 'error', '-y']

  if (entry.kind === 'photo') {
    const { graph, seed } = PHOTO_FILTERS[entry.source]
    return [
      ...quiet,
      '-i',
      join(fixtures, entry.source),
      '-filter_complex',
      `${graph}${grain(seed, 6)}`,
      '-q:v',
      '2',
      target,
    ]
  }

  if (entry.kind === 'screenshot') {
    const size = `${entry.width}x${entry.height}`
    return [
      ...quiet,
      '-f',
      'lavfi',
      '-i',
      `mandelbrot=s=${size}:start_scale=1.2:end_scale=1.2:outer=normalized_iteration_count`,
      '-frames:v',
      '1',
      target,
    ]
  }

  const { width: w, height: h, seed } = entry
  const [c0, c1, c2, c3] = PALETTES[entry.palette]
  /*
   * Noise at four scales, the cheapest stand-in for a scene: the coarsest
   * layer is the light falling across it, the next the shapes in it, the
   * finest the texture a JPEG has to spend bytes on.
   */
  const layer = (cols, rows, amount, blur, offset) =>
    `color=c=gray:s=${cols}x${rows},format=gray,noise=alls=${amount}:allf=u:all_seed=${seed + offset},` +
    `scale=${w}:${h}:flags=bicubic${blur === 0 ? '' : `,gblur=sigma=${blur}`},format=gbrp,trim=end_frame=1`

  return [
    ...quiet,
    '-f',
    'lavfi',
    '-i',
    `gradients=s=${w}x${h}:c0=0x${c0}:c1=0x${c1}:c2=0x${c2}:c3=0x${c3}:nb_colors=4:` +
      `x0=0:y0=0:x1=${Math.round(w * 0.08)}:y1=${h}:type=linear:seed=${seed}:speed=0.00001,` +
      'trim=end_frame=1,format=gbrp',
    '-f',
    'lavfi',
    '-i',
    layer(Math.round(w / 168), Math.round(h / 168), 100, 120, 1),
    '-f',
    'lavfi',
    '-i',
    layer(Math.round(w / 16), Math.round(h / 16), 90, 8, 2),
    '-f',
    'lavfi',
    '-i',
    layer(Math.round(w / 4), Math.round(h / 4), 90, 0, 3),
    '-filter_complex',
    '[0][1]blend=all_mode=overlay:all_opacity=0.9[a];' +
      '[a][2]blend=all_mode=softlight:all_opacity=0.8[b];' +
      `[b][3]blend=all_mode=overlay:all_opacity=0.45,vignette=PI/5,${grain(seed + 4, 12)}`,
    '-frames:v',
    '1',
    '-q:v',
    String(entry.quality),
    target,
  ]
}

/** Runs `tasks` with at most `limit` in flight. */
async function pooled(tasks, limit) {
  const results = []
  let next = 0
  const worker = async () => {
    while (next < tasks.length) {
      const at = next++
      results[at] = await tasks[at]()
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker))
  return results
}

/**
 * Builds the batch, or finds it already built, and returns its paths in drop
 * order. The cache key is the recipe itself, so editing an entry above is
 * enough to get it rebuilt.
 */
export async function prepareBatch({ fixtures, fresh = false, log = console.log }) {
  const key = createHash('sha1').update(JSON.stringify([LOTE, PHOTO_FILTERS, argsFor.toString()]))
  const dir = join(tmpdir(), `achica-demo-lote-${key.digest('hex').slice(0, 10)}`)
  const done = join(dir, '.completo')
  const paths = LOTE.map((entry) => join(dir, entry.name))

  if (!fresh) {
    try {
      await stat(done)
      log(`batch: reusing ${dir}`)
      return paths
    } catch {
      // Not built yet, or interrupted halfway: build it.
    }
  }

  // A batch from an older recipe is a hundred megabytes nobody will read again.
  for (const name of await readdir(tmpdir())) {
    if (name.startsWith('achica-demo-lote-')) {
      await rm(join(tmpdir(), name), { recursive: true, force: true })
    }
  }
  await mkdir(dir, { recursive: true })
  log(`batch: building ${LOTE.length} files in ${dir}`)

  // Each ffmpeg run is mostly single-threaded filtering, so one per core.
  await pooled(
    LOTE.map((entry, at) => () => run('ffmpeg', argsFor(entry, fixtures, paths[at]))),
    availableParallelism(),
  )

  await writeFile(done, '')
  const sizes = await Promise.all(paths.map((path) => stat(path).then((info) => info.size)))
  const total = sizes.reduce((sum, size) => sum + size, 0)
  log(`batch: ${(await readdir(dir)).length - 1} files, ${(total / 1e6).toFixed(1)} MB`)
  return paths
}
