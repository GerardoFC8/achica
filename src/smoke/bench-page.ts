import '../styles.css'
import type { OutputPlan } from '../core/pipeline'
import { benchFiles, runQueueBench, type BenchReport } from './queue-bench'

/**
 * The page behind `npm run bench`, and the one to have open when recording
 * with Chrome's memory profiler.
 *
 * The profiler is the measurement the spec asks for, and it needs a real tab
 * doing real work — which is why this is a page and not a test. It also takes
 * files from disk, because two hundred copies of one photo prove less than two
 * hundred photos that differ in size, format and orientation.
 */

const FIXTURE_URLS = import.meta.glob('../../test/fixtures/**/*.jpg', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>

declare global {
  var __benchReport: BenchReport | undefined
  /** Read by scripts/bench.mjs, which samples memory from outside the page. */
  var __benchProgress: number
}

globalThis.__benchProgress = 0

const found = document.querySelector<HTMLElement>('#bench')
if (found === null) throw new Error('Mount point #bench is missing from bench.html')

// Captured after the guard so the narrowed type survives into the closures
// below, without reaching for a non-null assertion.
const mount = found

const params = new URLSearchParams(location.search)
const requested = Number(params.get('files') ?? '200')
const fileCount = Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : 200

/** Overridable so a run can show what the concurrency cap actually buys. */
/**
 * `webp` is the realistic path: a weight budget, which re-encodes to find its
 * quality. `png` is the one worth measuring separately (D50) — there the cost
 * is not a quality search but oxipng, which starts a rayon thread pool inside
 * every worker, so it is the shape that can move the memory figure.
 */
const PLANS: Readonly<Record<string, OutputPlan>> = {
  webp: { format: 'webp', maxBytes: 120_000, maxWidth: 1280 },
  png: { format: 'png', maxWidth: 1280 },
}

const PLAN: OutputPlan = PLANS[params.get('plan') ?? 'webp'] ?? {
  format: 'webp',
  maxBytes: 120_000,
  maxWidth: 1280,
}

const askedConcurrency = Number(params.get('concurrency') ?? '')
const concurrency =
  Number.isFinite(askedConcurrency) && askedConcurrency > 0
    ? Math.floor(askedConcurrency)
    : undefined

const megabytes = (bytes: number): string => `${(bytes / 1_048_576).toFixed(1)} MB`

function render(html: string): void {
  mount.innerHTML = `<div class="mx-auto max-w-2xl p-6 font-mono text-sm">${html}</div>`
}

function renderReport(report: BenchReport): string {
  const samples = report.samples
    .map(
      (sample) =>
        `<tr><td class="pr-6 text-right">${sample.settled}</td><td class="text-right">${sample.ms} ms</td></tr>`,
    )
    .join('')

  const slowdown =
    report.slowdown === null ? 'sin dato' : `${report.slowdown.toFixed(2)}× sobre el tramo típico`

  return `
    <h1 class="mb-4 text-lg">Banco de la cola</h1>
    <p>${report.done} terminados, ${report.failed} fallidos, ${report.cancelled} cancelados, en ${report.ms} ms</p>
    <p>Concurrencia: ${report.concurrency}</p>
    <p>${megabytes(report.bytesBefore)} de entrada, ${megabytes(report.bytesAfter)} de salida</p>
    <p class="mt-4">Tramo más lento: ${slowdown}</p>
    <table class="mt-4"><thead><tr><th class="pr-6 text-right">Archivos</th><th class="text-right">Tiempo</th></tr></thead><tbody>${samples}</tbody></table>
    <p class="mt-4 max-w-prose text-xs">
      Esta página no mide memoria: ningún medidor accesible desde dentro dice la
      verdad sobre ella. Para medirla, graba con el perfilador de Chrome
      mientras corre, o usa <code>npm run bench</code>, que la mide desde fuera.
    </p>`
}

async function run(files: readonly File[]): Promise<void> {
  render(`<p>Procesando ${files.length} archivos…</p>`)

  const report = await runQueueBench({
    files,
    plan: PLAN,
    ...(concurrency === undefined ? {} : { concurrency }),
    onProgress: (settled, total) => {
      globalThis.__benchProgress = settled
      if (settled % 10 === 0) render(`<p>Procesando ${settled} de ${total}…</p>`)
    },
  })

  globalThis.__benchReport = report
  render(renderReport(report))
}

/**
 * By name, not by taking the first match: the corpus also holds `empty.jpg`,
 * a zero-byte file that exists to prove the empty-file error, and a bench
 * built on it reports two hundred failures in eighty milliseconds.
 */
const FIXTURE = 'Landscape_6.jpg'

async function fixtureFiles(count: number): Promise<File[]> {
  const key = Object.keys(FIXTURE_URLS).find((path) => path.endsWith(`/${FIXTURE}`))
  const url = key === undefined ? undefined : FIXTURE_URLS[key]
  if (url === undefined) throw new Error(`fixture not found: ${FIXTURE}`)

  const bytes = await (await fetch(url)).arrayBuffer()
  if (bytes.byteLength === 0) throw new Error(`fixture is empty: ${FIXTURE}`)

  return benchFiles(bytes, count)
}

render(`
  <h1 class="mb-4 text-lg">Banco de la cola</h1>
  <p class="mb-4 max-w-prose">Elige tus propias fotos, o usa ${fileCount} copias de la foto de prueba.</p>
  <p><input id="pick" type="file" accept="image/*" multiple /></p>
  <p class="mt-4"><button id="start" class="border px-3 py-1">Usar ${fileCount} copias de la foto de prueba</button></p>`)

document.querySelector<HTMLButtonElement>('#start')?.addEventListener('click', () => {
  void fixtureFiles(fileCount).then(run)
})

document.querySelector<HTMLInputElement>('#pick')?.addEventListener('change', (event) => {
  const picked = (event.target as HTMLInputElement).files
  if (picked !== null && picked.length > 0) void run([...picked])
})

if (params.get('auto') === '1') void fixtureFiles(fileCount).then(run)
