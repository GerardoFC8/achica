# Decisiones

Registro de decisiones no obvias. Cada entrada: una línea de contexto, una de consecuencia.
Las decisiones se agregan, no se reescriben. Si una se revierte, se agrega la nueva explicando por qué.

---

## D1 — Host: Cloudflare Pages

**Contexto.** El DNS de `gfcode.dev` ya vive en Cloudflare y la cuenta tiene Pages activo; `_headers` permite fijar COOP y COEP, cosa que GitHub Pages no. Vercel era técnicamente viable y el spec lo nombra, pero su plan Hobby restringe el uso comercial y agregaría un salto proxy de Cloudflare hacia Vercel.

**Consecuencia.** `crossOriginIsolated` puede ser `true`, así que AVIF multihilo queda disponible previo opt-in. Rocket Loader y Email Obfuscation deben quedar desactivados a nivel de zona: el primero inyecta un script desde `ajax.cloudflare.com`, que con `Cross-Origin-Embedder-Policy: require-corp` queda bloqueado y además rompe la promesa de cero peticiones de red.

## D2 — HEIC queda fuera de la v1

**Contexto.** Las dos librerías disponibles son copyleft: `heic-to` (23,2 MB desempaquetado) y `libheif-js` (6,1 MB) son ambas LGPL-3.0, contra los 0,5 MB y Apache-2.0 de `@jsquash/jpeg`. Chocan con el primer eje del producto, que es licencia MIT y autohospedable. Además iOS convierte HEIC a JPEG automáticamente al elegir fotos desde la biblioteca, así que el caso real se reduce a fotos copiadas del celular a una computadora.

**Consecuencia.** La v1 sale MIT limpio, sin excepciones de licencia que documentar. Un HEIC se detecta por firma de bytes ISO-BMFF y produce un error tipado con instrucción accionable, no un fallo silencioso. Entra en la v1.1 como módulo dinámico sin modificar y con aviso de licencia; el flujo `decode → orientar → resize → encode` no cambia, así que es aditivo.

## D3 — Vitest con dos entornos: `node` para lógica pura, navegador para códecs

**Contexto.** `@jsquash` decodifica a `ImageData`, que no existe en Node — verificado en Node 24: `ImageData`, `ImageBitmap`, `OffscreenCanvas` y `createImageBitmap` son todos `undefined`. Su propia documentación advierte que el soporte para Node es limitado. Pero la mayor parte de `core/` (perfiles, presupuesto, detección de firma) es aritmética y bytes: no necesita navegador.

**Consecuencia.** Dos proyectos de Vitest. El de Node corre rápido y cubre casi todo `core/`; el de navegador, con proveedor Playwright, corre solo los tests que atraviesan un códec real. Refuerza la regla dura de que `core/` sea lógica pura: si un test necesita el proyecto de navegador, es señal de que la función toca el borde.

## D4 — TypeScript 6.0.3, no 7

**Contexto.** TypeScript 7 (compilador nativo) ya es `latest`, pero `typescript-eslint@8.67.0` declara `typescript >=4.8.4 <6.1.0`. Con TS 7 el proyecto se queda sin linting de TypeScript, y la regla de no usar `any` sin comentario justificante depende de ese linter.

**Consecuencia.** Se fija 6.0.3, la última estable dentro del rango soportado. Revisar cuando `typescript-eslint` publique compatibilidad con la 7; la migración debería ser un cambio de versión, no de código.

## D5 — React entra en la Fase 3, no en la 0

**Contexto.** El stack cerrado incluye React 19, pero el criterio de la Fase 0 solo pide Vite, TypeScript estricto, Tailwind, linting, Vitest y CI, y la Fase 1 es explícitamente "cero React". La página de humo que verifica el hosting no necesita un framework.

**Consecuencia.** La Fase 0 instala menos y falla en menos lugares. El humo de WASM es TypeScript y DOM directo.

## D6 — La frontera de `core/` la verifica el linter, no la disciplina

**Contexto.** La regla dura del proyecto es que `core/` no importe React ni toque `window`. Una regla que depende de que alguien la recuerde en una revisión se rompe el día que hay apuro.

**Consecuencia.** ESLint bloquea, dentro de `src/core/**`, los imports de React y los globales de DOM. Romper la arquitectura falla en CI, no en la revisión.

## D7 — Tailwind v4 fija el piso de navegadores del proyecto

**Contexto.** Tailwind v4 depende de `@property` y `color-mix()`, así que exige Safari 16.4+, Chrome 111+ y Firefox 128+. Ese piso es más alto que el de los códecs WASM, o sea que lo impone la capa de estilos, no la de procesamiento.

**Consecuencia.** Ese es el piso soportado de la aplicación y va documentado como limitación conocida. Importa antes de lo que parece: el spec marca Safari como el terreno frágil y pide probarlo temprano, no en la última fase.

## D8 — Idioma: documentación y copy en español, código y commits en inglés

**Contexto.** El spec fija el español como idioma base del producto y toda la documentación existente está en español. El código no tiene precedente en este repo.

**Consecuencia.** README, `docs/`, mensajes de error y textos de interfaz en español. Identificadores, comentarios de código y mensajes de commit en inglés, con Conventional Commits. Un único criterio, sin decidirlo archivo por archivo.
