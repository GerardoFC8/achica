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

**Consecuencia.** Dos proyectos de Vitest, separados por convención de nombre: `*.test.ts` corre en Node, `*.browser-test.ts` corre en Chromium vía Playwright. El de Node cubre casi todo `core/` y corre rápido; el de navegador solo los tests que atraviesan un códec real. Refuerza la regla dura de que `core/` sea lógica pura: si un test necesita el proyecto de navegador, es señal de que la función toca el borde.

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

## D8 — La página "vacía" de la Fase 0 decodifica una imagen real

**Contexto.** El spec pide desplegar una página vacía para que los problemas de hosting aparezcan en la Fase 0 y no en la 5. Pero una página realmente vacía no prueba nada: sin ningún `.wasm` en el build no hay tipo MIME que verificar ni instanciación que pueda fallar.

**Consecuencia.** El despliegue decodifica un PNG de 2×2 con `@jsquash/png` y reporta en pantalla si el códec se instanció, si los píxeles salieron correctos, con qué `Content-Type` sirvió el host el `.wasm`, y si la página quedó aislada cross-origin. Vive en `src/smoke/`, que es andamiaje declarado fuera de la arquitectura de la sección 5 y se retira en la Fase 3, cuando reportar `crossOriginIsolated` pasa a ser una función real de la interfaz. `vite preview` replica las cabeceras de `public/_headers` para que un problema de COEP aparezca en local y no después de desplegar.

## D9 — Idioma: documentación y copy en español, código y commits en inglés

**Contexto.** El spec fija el español como idioma base del producto y toda la documentación existente está en español. El código no tiene precedente en este repo.

**Consecuencia.** README, `docs/`, mensajes de error y textos de interfaz en español. Identificadores, comentarios de código y mensajes de commit en inglés, con Conventional Commits. Un único criterio, sin decidirlo archivo por archivo.

## D10 — Workers con assets estáticos, no Pages. Refina D1

**Contexto.** D1 eligió Cloudflare Pages. Al crear el proyecto apareció que Cloudflare ya dirige los proyectos nuevos a Workers con assets estáticos: el formulario no pide directorio de salida, pide un comando `npx wrangler deploy`. Pages sigue soportado, pero las capacidades nuevas van a Workers.

**Consecuencia.** El host sigue siendo Cloudflare y todo lo que motivó D1 se mantiene: DNS en la misma cuenta, dominio automático, sin cláusula de uso comercial, y `_headers` soportado siempre que viva dentro del directorio de assets, que es donde Vite lo deja al copiar `public/`. Cambia el mecanismo: hace falta `wrangler.jsonc` en el repo, sin campo `main` porque no hay Worker ni lo va a haber. La advertencia de la documentación —que `_headers` no se aplica a respuestas generadas por código de Worker— no nos alcanza justamente porque no generamos ninguna.

## D11 — La promesa de red se dice con precisión y la página se autoaudita

**Contexto.** Medida la URL desplegada, la página hacía diez peticiones: cinco nuestras y cinco inyectadas por Cloudflare. Dos eran telemetría (Web Analytics: `beacon.min.js` cross-origin y `POST /cdn-cgi/rum`), que la sección 2 prohíbe como "sin telemetría" y la sección 3 como "backend de cualquier tipo, incluso solo para analytics". Las otras tres son la detección de bots del plan Free, que no se puede acotar por host ni por ruta: con Bot Fight Mode activo, JavaScript Detections se habilita automáticamente y no se puede desactivar, y las acciones Skip, Bypass y Allow no tienen efecto.

**Consecuencia.** Web Analytics apagado, con lo que las peticiones a terceros quedan en cero. Bot Fight Mode se conserva encendido por decisión del desarrollador, porque la zona `gfcode.dev` aloja además aplicaciones con superficie de login y el ajuste es de zona, sin excepciones posibles. La afirmación del README pasa de "ninguna petición" a lo que es cierto y comprobable: ninguna petición de nuestro código después de la carga, cero peticiones a terceros, y unas pocas del borde sobre nuestro mismo origen que desaparecen al autohospedar. La página cuenta las tres categorías en vivo, así que la promesa se verifica sola en lugar de pedir confianza. Una afirmación exacta que resiste el chequeo vale más que una absoluta que se desmiente al primer DevTools abierto.

## D12 — La auditoría de red se declara un piso, no un total

**Contexto.** La primera versión de la auditoría reportaba cero peticiones de la CDN cuando el navegador hacía tres: el borde inyecta un iframe oculto y la línea de tiempo de un documento no incluye los recursos que pide un documento hijo. Al recorrer también los marcos del mismo origen la cuenta subió a dos de tres. La tercera nunca aparece en ninguna línea de tiempo accesible, y se descartó por medición que fuera por workers, por `clearResourceTimings` o por desbordamiento del buffer, que tenía solo cuatro entradas.

**Consecuencia.** Resource Timing no es un registro completo de la actividad de red, así que cualquier auditoría hecha desde la propia página es un límite inferior. Las filas se etiquetan como observadas, los marcos no inspeccionables se cuentan aparte, y la página declara que la autoridad es la pestaña Red y que el código de la cuenta es público. Una herramienta que dice qué no puede ver es más confiable que una que informa un número limpio y se desmiente al primer contraste; y el argumento fuerte no era nunca la cifra, sino que el código sea legible y autoalojable.

## D13 — Los fallos de `core/` son valores, y llevan código, no frase

**Contexto.** El spec exige que un archivo corrupto produzca un error tipado y no una excepción, y la razón es el lote: una foto rota entre trescientas debe marcar esa fila y dejar que la cola siga. Las excepciones se propagan hacia arriba, y el código que se propaga por defecto termina envuelto en `try/catch` en cada llamada hasta que alguien olvida uno y muere el lote entero.

**Consecuencia.** `core/` devuelve `Result<T, E>`: el fallo es un valor, el compilador obliga a mirarlo y no se puede ignorar en silencio. Los errores llevan un **código** y datos estructurados, nunca una oración: la redacción pertenece a la interfaz. Eso mantiene `core/` libre de presentación y es además lo que permite mostrar el mismo fallo en español o en inglés sin tocar la lógica.

## D14 — La orientación EXIF se aplica al decodificar, y el valor por defecto de jSquash es el equivocado

**Contexto.** `@jsquash/jpeg` acepta `preserveOrientation` y lo trae en `false` por defecto. El nombre se lee al revés: `true` significa "preservar la orientación que el fotógrafo quiso", o sea **aplicar** la rotación a los píxeles; `false` entrega los píxeles tal como están almacenados. Medido contra las ocho orientaciones: con `false`, una foto con orientación 6 sale 64×32 sin rotar; con `true` sale 32×64 y coincide exactamente con lo que hace Chromium. Tomar el valor por defecto publica todas las fotos de celular de costado, que es el bug que la sección 6 del spec señala como el más común de estas herramientas.

**Consecuencia.** El decodificador pasa `preserveOrientation: true` siempre, y la orientación queda resuelta en la entrada en lugar de viajar junto al bitmap. Todo lo que sigue —redimensionar, codificar, la previsualización— puede tratar ancho y alto como lo que el usuario ve, y no queda ninguna bandera que un paso posterior pueda olvidar.

## D15 — Cada códec se carga bajo demanda

**Contexto.** Medido en el build: el wasm de AVIF pesa 1.171 KB (345 KB comprimido), contra 166 KB de MozJPEG, 181 KB de PNG y 138 KB de WebP. Empaquetarlos todos de entrada haría que AVIF fuera el 87% de la carga inicial, para algo que la mayoría de usuarios nunca usa.

**Consecuencia.** Cada envoltorio usa `import()` dinámico, así que Vite emite un asset por códec y el JS de entrada queda en 8 KB. Es el mismo argumento que el spec ya aplica a HEIC, extendido a AVIF porque los números lo piden.
