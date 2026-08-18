/**
 * Phase 2's acceptance run: two hundred images through the real queue, in a
 * real browser, measuring what the tab costs while it works.
 *
 * Memory is measured from OUTSIDE the page, as the resident size of the whole
 * Chrome process tree, because every gauge reachable from inside it lies:
 * `performance.memory` returns a constant 10,000,000 in Chromium,
 * `performance.measureUserAgentSpecificMemory()` refuses to run even when
 * `crossOriginIsolated` is true, and CDP's JS heap metric excludes ArrayBuffer
 * backing stores — which is exactly where a decoded bitmap lives. Resident
 * size is the same quantity Chrome's own task manager reports, it covers the
 * renderer and every worker, and it moves when a real allocation happens.
 *
 * The page it drives is bench.html, the same one to open by hand when
 * recording with the Chrome memory profiler.
 *
 * Run: node scripts/bench.mjs [files] [concurrency]
 * The figures in the README come from this command.
 */

import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const requested = Number(process.argv[2] ?? '200')
const files = Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : 200

/**
 * Third argument picks the output plan: `webp` (default) or `png`. They cost
 * different things — webp pays a quality search, png pays oxipng and its thread
 * pool inside every worker — so the memory figure has to be quoted per plan.
 */
const plan = process.argv[4] === 'png' ? 'png' : 'webp'
const planParam = `&plan=${plan}`

/** Second argument overrides the pool's own concurrency, for comparison runs. */
const askedConcurrency = Number(process.argv[3] ?? '')
const concurrencyParam =
  Number.isFinite(askedConcurrency) && askedConcurrency > 0
    ? `&concurrency=${Math.floor(askedConcurrency)}`
    : ''

const SAMPLE_INTERVAL_MS = 1_000

/** Files are counted in thousands, the same way the interface counts them. */
const megabytes = (bytes) => `${(bytes / 1_000_000).toFixed(1)} MB`

/** Memory is not: RAM is powers of two, and calling a mebibyte a megabyte here
 *  would misreport the one figure this script exists to produce. */
const mebibytes = (bytes) => `${(bytes / 1_048_576).toFixed(1)} MiB`

/**
 * Every process descending from the one whose command line names our throwaway
 * profile directory. Chrome's renderers and gpu process are children and do
 * not carry that flag themselves, so the tree has to be walked.
 */
async function residentBytes(marker) {
  let entries
  try {
    entries = await readdir('/proc')
  } catch {
    return null // Not Linux: fall back to the profiler by hand.
  }

  const processes = new Map()
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue
    try {
      const [status, cmdline] = await Promise.all([
        readFile(`/proc/${entry}/status`, 'utf8'),
        readFile(`/proc/${entry}/cmdline`, 'utf8'),
      ])
      processes.set(Number(entry), {
        ppid: Number(/^PPid:\s+(\d+)$/m.exec(status)?.[1] ?? 0),
        rss: Number(/^VmRSS:\s+(\d+) kB$/m.exec(status)?.[1] ?? 0) * 1024,
        cmdline,
      })
    } catch {
      // The process exited between listing and reading it.
    }
  }

  const tree = new Set(
    [...processes].filter(([, info]) => info.cmdline.includes(marker)).map(([pid]) => pid),
  )
  if (tree.size === 0) return null

  for (let grew = true; grew;) {
    grew = false
    for (const [pid, info] of processes) {
      if (!tree.has(pid) && tree.has(info.ppid)) {
        tree.add(pid)
        grew = true
      }
    }
  }

  let total = 0
  for (const pid of tree) total += processes.get(pid)?.rss ?? 0
  return { bytes: total, processes: tree.size }
}

const profileDir = await mkdtemp(join(tmpdir(), 'achica-bench-'))
const server = await createServer({ logLevel: 'warn', server: { port: 0 } })
await server.listen()

const base = server.resolvedUrls?.local?.[0]
if (base === undefined) throw new Error('vite did not report a local url')

const context = await chromium.launchPersistentContext(profileDir, { args: [] })

try {
  const page = await context.newPage()
  page.on('pageerror', (error) => console.error('[page]', error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') console.error('[page]', message.text())
  })

  console.log(`Running ${files} files in ${base}bench.html …`)
  await page.goto(`${base}bench.html?files=${files}&auto=1${concurrencyParam}${planParam}`)

  const samples = []
  const takeSample = async () => {
    const resident = await residentBytes(profileDir)
    const settled = await page.evaluate(() => globalThis.__benchProgress ?? 0)
    if (resident !== null) samples.push({ settled, bytes: resident.bytes })
    return resident
  }

  const baseline = await takeSample()

  const polling = setInterval(() => {
    void takeSample()
  }, SAMPLE_INTERVAL_MS)

  try {
    await page.waitForFunction(() => globalThis.__benchReport !== undefined, undefined, {
      timeout: 10 * 60_000,
    })
  } finally {
    clearInterval(polling)
  }

  await takeSample()
  const report = await page.evaluate(() => globalThis.__benchReport)

  console.log('')
  console.log(`files        ${report.files} (${report.done} done, ${report.failed} failed)`)
  console.log(`concurrency  ${report.concurrency}`)
  console.log(`elapsed      ${report.ms} ms (${Math.round(report.ms / report.files)} ms/file)`)
  console.log(
    `bytes        ${megabytes(report.bytesBefore)} in, ${megabytes(report.bytesAfter)} out`,
  )
  console.log(
    `slowest run  ${report.slowdown === null ? 'unavailable' : `${report.slowdown.toFixed(2)}x the typical stretch`}`,
  )
  if (report.firstError !== null) {
    console.log(`first error  ${JSON.stringify(report.firstError)}`)
  }

  if (baseline === null || samples.length < 3) {
    console.log('')
    console.log('Resident memory unavailable on this platform: record bench.html with the')
    console.log('Chrome memory profiler instead.')
  } else {
    // The first quarter pays for spawning workers and instantiating a wasm
    // codec in each; growth after that is what says whether the queue keeps
    // what it processes.
    const steady = samples.filter((sample) => sample.settled >= report.files / 4)
    const first = steady[0] ?? samples[0]
    const last = samples[samples.length - 1]
    const processed = last.settled - first.settled
    const growth = processed > 0 ? (last.bytes - first.bytes) / processed : null
    const peak = samples.reduce((most, sample) => Math.max(most, sample.bytes), 0)

    console.log(
      `start        ${megabytes(baseline.bytes)} resident, ${baseline.processes} processes`,
    )
    console.log(`peak         ${megabytes(peak)} resident`)
    console.log(`end          ${megabytes(last.bytes)} resident`)
    console.log(
      `steady state ${growth === null ? 'unavailable' : `${Math.round(growth / 1024)} KB per file after the first quarter`}`,
    )
    console.log('')
    console.log('settled  resident')
    for (const sample of samples) {
      console.log(`${String(sample.settled).padStart(7)}  ${mebibytes(sample.bytes)}`)
    }
  }
} finally {
  await context.close()
  await server.close()
  await rm(profileDir, { recursive: true, force: true })
}
