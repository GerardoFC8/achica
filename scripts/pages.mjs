/**
 * Writes the pages the registry describes: index.html, en/index.html (and, as
 * tools arrive, <slug>/index.html and en/<slug>/index.html) and
 * public/sitemap.xml (D57). The files stay in the repository, because Vite
 * builds from real HTML files and because they are worth reading in review;
 * test/pages.test.ts fails if they stop matching the registry.
 *
 * The registry is TypeScript with no runtime imports, so Node (v24) loads it
 * with its own type stripping, no Vite and no loader needed.
 *
 * Run: npm run pages
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { listPages, renderPage, renderSitemap } from '../src/tools/pages.ts'
import { REGISTRY } from '../src/tools/registry.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const write = async (file, content) => {
  const target = join(ROOT, file)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, content)
  console.log(`wrote ${file}`)
}

for (const { tool, language, file } of listPages(REGISTRY)) {
  await write(file, renderPage(REGISTRY, tool, language))
}
await write('public/sitemap.xml', renderSitemap(REGISTRY))
