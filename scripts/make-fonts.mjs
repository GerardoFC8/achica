/**
 * Subsets the two typefaces the interface ships.
 *
 * Why subset at all: the app promises zero network requests after the initial
 * load, and `require-corp` blocks external subresources anyway, so Google
 * Fonts is out and every font byte is part of the first paint. Google's own
 * per-unicode-range subsets are 93.6 KB for these two; cut to what the
 * interface actually renders they are 29.3 KB.
 *
 * The split is asymmetric on purpose. Instrument Sans keeps all of Latin-1
 * because it renders file names, which come from the user and are not ours to
 * predict. Martian Mono renders only numbers we formatted ourselves, so it is
 * cut to the ~36 glyphs a number can contain — which is what makes an
 * otherwise expensive display face nearly free.
 *
 * Both faces are instanced before subsetting: the width axis is pinned (100
 * for the interface, 87.5 for the numbers, which is the density the table was
 * designed at) and the weight axis is kept as a range.
 *
 * Neither font has U+2264 «≤». That is why limits read "máx. 500 KB" and not
 * "≤ 500 KB": a symbol neither typeface can draw would fall back to whatever
 * the system has, in the middle of a column of our own numbers.
 *
 * Run: node scripts/make-fonts.mjs
 * Needs pyftsubset (`pip install 'fonttools[woff]'`). The outputs are
 * committed, so this only needs re-running when the glyph set changes.
 */

import { execFile } from 'node:child_process'
import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'src', 'fonts')
const WORK = join(ROOT, 'node_modules', '.cache', 'fonts')

const RAW = 'https://raw.githubusercontent.com/google/fonts/main/ofl'

/** Everything the interface can render: Latin-1 plus the punctuation in use. */
const INTERFACE_UNICODES = [
  'U+0020-007E',
  'U+00A0-00FF',
  'U+0131',
  'U+0152-0153',
  'U+2013-2014',
  'U+2018-201D',
  'U+2026',
  'U+2190-2193',
  'U+2212',
  'U+00B7',
].join(',')

/** Everything a formatted number can contain, and nothing else. */
const NUMBER_TEXT = '0123456789 .,%·×−-–→()/:+ KMGBTmspx'
const NUMBER_UNICODES = 'U+00A0,U+202F,U+2212,U+2192,U+00B7,U+00D7'

const FACES = [
  {
    family: 'instrumentsans',
    file: 'InstrumentSans[wdth,wght].ttf',
    out: 'instrument-sans.woff2',
    license: 'InstrumentSans-OFL.txt',
    pin: ['wdth=100', 'wght=400:700'],
    subset: ['--unicodes=' + INTERFACE_UNICODES],
  },
  {
    family: 'martianmono',
    file: 'MartianMono[wdth,wght].ttf',
    out: 'martian-mono.woff2',
    license: 'MartianMono-OFL.txt',
    pin: ['wdth=87.5', 'wght=400:700'],
    subset: ['--text=' + NUMBER_TEXT, '--unicodes=' + NUMBER_UNICODES],
  },
]

async function download(url, to) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${response.status} fetching ${url}`)
  await writeFile(to, Buffer.from(await response.arrayBuffer()))
}

async function requireTool(tool) {
  try {
    await run(tool, ['--help'])
  } catch {
    throw new Error(
      `${tool} is not on PATH. Install it with: pip install 'fonttools[woff]'\n` +
        'The subsetted fonts are committed, so this is only needed to regenerate them.',
    )
  }
}

await requireTool('pyftsubset')
await requireTool('fonttools')

await rm(WORK, { recursive: true, force: true })
await mkdir(WORK, { recursive: true })
await mkdir(OUT, { recursive: true })

let total = 0

for (const face of FACES) {
  const source = join(WORK, `${face.family}.ttf`)
  const pinned = join(WORK, `${face.family}-pinned.ttf`)
  const target = join(OUT, face.out)

  await download(`${RAW}/${face.family}/${encodeURIComponent(face.file)}`, source)
  await download(`${RAW}/${face.family}/OFL.txt`, join(OUT, face.license))

  await run('fonttools', ['varLib.instancer', source, ...face.pin, '-o', pinned])
  await run('pyftsubset', [
    pinned,
    ...face.subset,
    '--layout-features=kern,liga,calt,ccmp,locl,mark,mkmk',
    '--flavor=woff2',
    `--output-file=${target}`,
  ])

  const { size } = await stat(target)
  total += size
  console.log(`${face.out.padEnd(22)} ${(size / 1024).toFixed(1)} KB`)
}

const BUDGET = 60 * 1024
console.log(`${'TOTAL'.padEnd(22)} ${(total / 1024).toFixed(1)} KB (budget ${BUDGET / 1024} KB)`)

if (total > BUDGET) {
  console.error('Over budget. Cut glyphs or drop an axis before committing this.')
  process.exitCode = 1
}
