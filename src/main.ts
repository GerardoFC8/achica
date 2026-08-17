import './styles.css'
import { observeNetwork, type NetworkAudit } from './smoke/network-audit'
import { runWasmSmoke, type SmokeReport } from './smoke/wasm-check'

const app = document.querySelector<HTMLElement>('#app')

if (app === null) {
  throw new Error('Mount point #app is missing from index.html')
}

// Captured after the guard so the narrowed type survives into the closures
// below, without reaching for a non-null assertion.
const mount = app

type Row = { label: string; value: string; ok: boolean | null }

function renderRow({ label, value, ok }: Row): string {
  const mark = ok === null ? '' : ok ? '✓ ' : '✗ '
  return `
    <div class="flex items-baseline justify-between gap-4 border-b py-2">
      <span>${label}</span>
      <span data-state="${ok === null ? 'info' : ok ? 'ok' : 'fail'}">${mark}${value}</span>
    </div>`
}

function render(report: SmokeReport, audit: NetworkAudit): void {
  const rows: Row[] = [
    { label: 'Códec PNG instanciado', value: report.decoded ? 'sí' : 'no', ok: report.decoded },
    {
      label: 'Píxeles decodificados correctos',
      value: report.pixelsMatch ? 'sí' : 'no',
      ok: report.pixelsMatch,
    },
    {
      label: 'Content-Type del .wasm',
      value: report.wasmContentType ?? 'no se pudo leer',
      ok: report.wasmContentType === 'application/wasm',
    },
    {
      label: 'Aislamiento cross-origin',
      value: report.crossOriginIsolated ? 'activo' : 'inactivo (AVIF irá monohilo)',
      ok: report.crossOriginIsolated,
    },
    { label: 'Peticiones propias', value: String(audit.own), ok: null },
    { label: 'Peticiones inyectadas por la CDN', value: String(audit.edge), ok: null },
    {
      label: 'Peticiones a terceros',
      value: String(audit.thirdParty),
      ok: audit.thirdParty === 0,
    },
  ]

  mount.innerHTML = `
    <h1 class="mb-4 text-base font-bold">achica — fase 0</h1>
    <p class="mb-4">Todavía no comprime nada. Esta página verifica que el host sirve WebAssembly correctamente y audita sus propias peticiones de red.</p>
    ${rows.map(renderRow).join('')}
    <p class="mt-4">Las peticiones de la CDN son la protección anti-bots de Cloudflare, sobre nuestro mismo origen. No transportan datos de imagen y desaparecen si autohospedás el proyecto.</p>
    ${report.error === null ? '' : `<pre class="mt-4 whitespace-pre-wrap">${report.error}</pre>`}
  `
}

mount.className = 'mx-auto max-w-xl p-6 font-mono text-sm'
mount.innerHTML = '<p>Verificando el entorno…</p>'

const origin = globalThis.location.origin
const report = await runWasmSmoke()

// The edge injects its scripts after first paint, so the figures are kept
// live rather than frozen at the moment the smoke finished.
observeNetwork(origin, (audit) => {
  render(report, audit)
})
