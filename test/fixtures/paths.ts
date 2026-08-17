import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

const generated = (name: string): string => join(HERE, 'generated', name)
const pngsuite = (name: string): string => join(HERE, 'vendor', 'pngsuite', name)
const camera = (name: string): string => join(HERE, 'vendor', 'exif-orientation', name)

/** Orientation 1 through 8, indexed by the EXIF value itself. */
export const ORIENTATION_FIXTURES: Readonly<Record<number, string>> = Object.freeze({
  1: generated('orientation-1.jpg'),
  2: generated('orientation-2.jpg'),
  3: generated('orientation-3.jpg'),
  4: generated('orientation-4.jpg'),
  5: generated('orientation-5.jpg'),
  6: generated('orientation-6.jpg'),
  7: generated('orientation-7.jpg'),
  8: generated('orientation-8.jpg'),
})

export const FIXTURES = Object.freeze({
  noExif: generated('no-exif.jpg'),
  truncatedJpeg: generated('truncated.jpg'),
  emptyFile: generated('empty.jpg'),
  pngDisguisedAsJpeg: generated('png-with-jpg-extension.jpg'),
  sampleWebp: generated('sample.webp'),

  rgbaPng: pngsuite('basn6a08.png'),
  truecolorWithTrns: pngsuite('tbrn2c08.png'),
  paletteWithTransparency: pngsuite('tp1n3p08.png'),
  sixteenBitPng: pngsuite('basn2c16.png'),
  interlacedPng: pngsuite('basi2c08.png'),

  cameraLandscape: camera('Landscape_6.jpg'),
  cameraPortrait: camera('Portrait_6.jpg'),
})

/** Each entry pairs a corrupt file with the defect verified in its bytes. */
export const CORRUPT_FIXTURES = Object.freeze([
  { path: pngsuite('xs1n0g01.png'), defect: 'broken PNG signature' },
  { path: pngsuite('xhdn0g08.png'), defect: 'invalid CRC in IHDR' },
  { path: pngsuite('xcsn0g01.png'), defect: 'invalid CRC in IDAT' },
  { path: pngsuite('xd0n2c08.png'), defect: 'invalid bit depth' },
  { path: pngsuite('xc9n2c08.png'), defect: 'invalid colour type' },
  { path: pngsuite('xdtn0g01.png'), defect: 'no IDAT chunk' },
])
