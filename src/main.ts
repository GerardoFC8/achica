import './styles.css'
import { runWasmSmoke } from './smoke/wasm-check'

const app = document.querySelector<HTMLElement>('#app')

if (app === null) {
  throw new Error('Mount point #app is missing from index.html')
}

function row(label: string, value: string, ok: boolean): string {
  return `
    <div class="flex items-baseline justify-between gap-4 border-b py-2">
      <span>${label}</span>
      <span data-state="${ok ? 'ok' : 'fail'}">${ok ? '✓' : '✗'} ${value}</span>
    </div>`
}

app.className = 'mx-auto max-w-xl p-6 font-mono text-sm'
app.innerHTML = '<p>Verificando el entorno…</p>'

const report = await runWasmSmoke()

app.innerHTML = `
  <h1 class="mb-4 text-base font-bold">achica — fase 0</h1>
  <p class="mb-4">Todavía no comprime nada. Esta página verifica que el host sirve WebAssembly correctamente.</p>
  ${row('Códec PNG instanciado', report.decoded ? 'sí' : 'no', report.decoded)}
  ${row('Píxeles decodificados correctos', report.pixelsMatch ? 'sí' : 'no', report.pixelsMatch)}
  ${row(
    'Content-Type del .wasm',
    report.wasmContentType ?? 'no se pudo leer',
    report.wasmContentType === 'application/wasm',
  )}
  ${row(
    'Aislamiento cross-origin',
    report.crossOriginIsolated ? 'activo' : 'inactivo (AVIF irá monohilo)',
    report.crossOriginIsolated,
  )}
  ${report.error === null ? '' : `<pre class="mt-4 whitespace-pre-wrap">${report.error}</pre>`}
`
