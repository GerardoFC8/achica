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

## D16 — La búsqueda por presupuesto prueba el techo primero y recibe el codificador inyectado

**Contexto.** El caso frecuente es un presupuesto holgado: un límite de 500 KB contra una foto que pesa 200 KB a calidad máxima. Bisecar hacia arriba desde el medio cuesta seis codificaciones para descubrir que no había nada que sacrificar, y cada codificación es cara de verdad — AVIF puede tardar segundos.

**Consecuencia.** Se prueba `maxQuality` primero: si entra, termina en una sola codificación. Si no entra, esa medición tampoco se desperdicia porque fija el techo desde el que baja la bisección. Además el codificador se recibe como parámetro, así que el algoritmo es puro, se prueba en Node con un codificador falso, y los casos incómodos —un formato sin perilla de calidad, un presupuesto inalcanzable— se cubren en milisegundos en lugar de minutos.

## D17 — El corte temprano del 3% solo aplica cuando ya hay un resultado que entra

**Contexto.** El spec pide cortar cuando dos iteraciones consecutivas quedan dentro de un margen del 3%. Leído al pie de la letra, ese corte puede dispararse mientras **todas** las tentativas siguen por encima del presupuesto, y entonces se reporta "no entra, hay que reducir dimensiones" cuando simplemente bajar más habría funcionado.

**Consecuencia.** El corte por estancamiento exige que ya exista un resultado que entre. Aparte, si dos codificaciones consecutivas dan exactamente el mismo tamaño, se corta siempre: significa que la calidad no está conectada a nada, que es justo lo que pasa con PNG. El corte temprano existe para ahorrar codificaciones una vez que hay respuesta, no para rendirse antes de tenerla. Hay un test que fija esta diferencia con un codificador casi plano arriba y con caída abrupta abajo.

## D18 — Cuando la calidad no alcanza, la búsqueda informa el piso en vez de fallar

**Contexto.** Medido sobre una foto real de 1800×1200: a calidad 100 pesa 999,8 KB, a 75 pesa 298 KB, a 40 pesa 123,2 KB. Un trámite que pide 50 KB es inalcanzable solo con calidad, y el spec responde a eso reduciendo dimensiones.

**Consecuencia.** El resultado vuelve con `withinBudget: false` y el archivo más pequeño encontrado. No es un error: quien llama necesita saber el piso para calcular cuánto hay que encoger, y decidir el redimensionado no es asunto de la búsqueda. Esa separación mantiene el algoritmo aplicable tal cual cuando llegue el redimensionado.

## D19 — Redimensionar nunca agranda, y la geometría va separada del remuestreo

**Contexto.** Un perfil que permite 1920 px de ancho está declarando un techo, no un objetivo. Agrandar una foto de 400 px para alcanzarlo inventaría detalle que nunca existió y produciría un archivo más pesado sin beneficio para nadie. Aparte, la aritmética que decide el tamaño destino y la llamada wasm que remuestrea fallan de maneras distintas: en la primera se esconde un error de redondeo o una relación de aspecto perdida, la segunda funciona o lanza.

**Consecuencia.** `fitWithin` solo reduce, redondea a píxeles enteros con mínimo de uno, y devuelve siempre un par nuevo en vez del objeto recibido — `ImageData` satisface la forma de `Dimensions`, así que devolver el argumento entregaría un bitmap completo donde se pidieron dos números. La geometría es pura y se prueba en Node contra una batería de relaciones de aspecto; el remuestreo se prueba en el navegador contra píxeles reales.

## D20 — Se conservan `premultiply` y `linearRGB`, y se comprueba que sirven

**Contexto.** `@jsquash/resize` trae ambos en `true`. Sin `premultiply`, el remuestreo promedia el color de los píxeles totalmente transparentes —habitualmente negro— dentro de sus vecinos visibles, y cada borde suave gana un halo oscuro. Sin `linearRGB`, promediar valores sRGB directamente oscurece el resultado, porque sRGB no es lineal en luz.

**Consecuencia.** Se conservan los dos y hay un test A/B que lo demuestra en lugar de darlo por sentado: con `premultiply` el píxel visible más oscuro del borde queda en 254, sin él baja a 248. Ese test necesitó una imagen construida a propósito —mitad blanco opaco, mitad transparente con negro debajo— porque ninguno de los fixtures de PngSuite tiene color lejano bajo la transparencia y con ellos la diferencia era del 0,13%, o sea ruido. Un test que parece evidencia sin serlo es peor que no tenerlo.

## D21 — Un formato sin pérdida con presupuesto de peso reduce dimensiones, no cambia de formato

**Contexto.** Era la pregunta abierta del punto 1.7 de la revisión inicial: el tipo `Profile` permite `format: 'keep'` junto a `maxBytes`, pero si la entrada es PNG el algoritmo de la sección 6 no aplica — oxipng no tiene perilla de calidad, así que no hay nada que bisecar. Quedaban tres salidas: fallar, cambiar de formato en silencio, o reducir dimensiones.

**Consecuencia.** Se reducen dimensiones. Cambiar de formato en silencio está descartado porque el spec prohíbe cambios callados y porque `keep` es una instrucción explícita del usuario. Fallar es peor que la alternativa: pedir 100 KB es una restricción real de un trámite, y un archivo más chico sirve mientras que un error no. El resultado informa `shrunkForBudget` con el tamaño al que se llegó, así que la interfaz puede decir con todas las letras que la imagen se achicó para entrar, en lugar de que el usuario lo descubra al abrirla.

## D22 — El paso de reducción se estima, no se parte a la mitad

**Contexto.** Cuando el presupuesto no se alcanza hay que achicar, y la pregunta es cuánto. Partir a la mitad a ciegas se pasa de largo cuando falta poco y se queda corto cuando falta mucho, y cada ronda cuesta una búsqueda completa de codificaciones.

**Consecuencia.** El peso codificado sigue de cerca la cantidad de píxeles, así que la escala lineal se estima como `sqrt(objetivo / actual)`, con un factor de 0,9 porque la estimación es optimista y acotada entre 0,1 y 0,95 para que toda ronda avance sin colapsar la imagen. Hay un test que contrasta la predicción contra el modelo cuadrático en cuatro distancias distintas. Aparte hay un tope de 16 codificaciones por archivo, no por búsqueda: el spec advierte que AVIF puede tardar segundos por imagen, y cuatro búsquedas de ocho intentos serían treinta y dos codificaciones para una sola foto.

## D23 — La regla de la fuente de los trámites es un error de compilación, no un comentario

**Contexto.** El spec es enfático: un perfil de trámite solo entra con `source` verificable y `verifiedAt`, porque un perfil con un límite equivocado es peor que no tener el perfil — el usuario se entera cuando le rechazan el trámite, y para entonces ya nos había creído. El tipo de la sección 7 declara ambos campos como opcionales, así que tal cual está no impide nada.

**Consecuencia.** El tipo se parte en dos formas. `GenericProfile` lleva un grupo de recomendación nuestra; `TramiteProfile` exige `source` y `verifiedAt` como obligatorios. Un perfil de trámite sin fuente **no compila** — verificado con una sonda deliberada. Es la misma estrategia de D6: la regla que más importa no puede depender de que alguien la recuerde con apuro. `PERFILES_TRAMITES` sale vacío en la v1, que es la respuesta honesta, y `provenanceOf` devuelve `null` para los perfiles genéricos justamente porque nuestras recomendaciones no tienen autoridad externa que citar.

## D24 — El tamaño de origen es un techo: nunca se devuelve un archivo más pesado

> **Reemplazada por D40.** El mecanismo de esta decisión —usar el tamaño de origen como techo de la búsqueda— resolvía el síntoma creando uno peor: recomprimía archivos que ya entraban. Se conserva escrita porque el problema que describe es real y D40 lo resuelve de otra forma.

**Contexto.** Lo encontró un test de perfiles. Con `correo-adjunto` (máximo 500 KB) sobre una foto de 352 KB, la búsqueda halla la mayor calidad que entra en el presupuesto y devuelve 495 KB — más pesado que la entrada. Cumple el presupuesto al pie de la letra y es absurdo viniendo de una herramienta cuyo propósito es achicar.

**Consecuencia.** El presupuesto efectivo es `min(maxBytes, tamañoDeOrigen)`. Un presupuesto es un techo, no un objetivo. Consecuencia conocida: al convertir a un formato inherentemente más pesado que el origen —por ejemplo una foto a PNG— el tope obligará a reducir dimensiones. Es el comportamiento correcto para esta herramienta, y preferible a entregar en silencio un archivo más grande del que el usuario trajo.

## D25 — Cancelar es terminar el worker, porque el `AbortController` del spec no puede cruzar

**Contexto.** La sección 6 pide un `AbortController` por trabajo y exige que cancelar detenga los trabajos en vuelo, no que solo deje de encolar. Tal cual está escrito no es implementable: un `AbortSignal` no es clonable por estructura, así que no llega al worker. Chromium responde `DataCloneError` tanto en `structuredClone` como en `postMessage`; Node lo "clona" en silencio a un objeto plano con `aborted: undefined`, que es peor, porque un test en Node pasaría y el navegador fallaría. Y aunque cruzara, la codificación WASM corre de forma síncrona dentro del worker: una bandera cooperativa recién se leería cuando el trabajo ya terminó.

**Consecuencia.** Queda un solo mecanismo que cumple el requisito: `worker.terminate()`. Por eso el pool es dueño del ciclo de vida de los workers — los crea, los mata al cancelar y levanta reemplazos para los archivos que siguen esperando. El costo es reinstanciar el WASM del worker terminado, y se paga solo cuando el usuario cancela. El pool ignora la respuesta tardía de un trabajo que ya cerró, para que ningún archivo reporte dos veces.

## D26 — El pool recibe el `File`, no sus bytes, y no guarda ningún resultado

**Contexto.** La sección 6 avisa que la memoria es donde se cae la mayoría de estas herramientas, con una cola de 300 fotos de 12 MP como piso. Leer cada archivo a `ArrayBuffer` en el hilo principal para pasárselo al worker pondría la cola entera en memoria antes de comprimir el primer archivo.

**Consecuencia.** El trabajo lleva el `File`, que es un manejador a datos que el navegador ya tiene en disco y se clona sin copiar; cada worker lee el suyo cuando le toca. El pool tampoco acumula salidas: entrega cada informe por `onEvent` y lo suelta, así el planificador nunca sostiene 300 búferes. La concurrencia refuerza lo mismo — se deja un núcleo al hilo principal y el tope es 4 por memoria, no por velocidad: un bitmap de 12 MP son unos 48 MB en RGBA, y cuatro en vuelo ya son unos 200 MB de pico. Si el navegador no informa núcleos se usa 2, que mueve la cola sin apostar memoria en una máquina desconocida.

## D27 — El worker entrega los bytes en lugar de copiarlos, y el adaptador vigila al worker que nunca contesta

**Contexto.** Comlink clona por estructura todo lo que devuelve. Para un lote eso significa una segunda copia de cada imagen ya comprimida cruzando el límite, justo en la fase cuya aceptación es no hacer crecer la memoria. Aparte, Comlink no tiene tiempo de espera: si el worker muere de verdad —el WASM no carga, el navegador niega una reserva de memoria— la promesa queda pendiente para siempre y la fila muestra un archivo comprimiendo eternamente, que es peor que un error.

**Consecuencia.** El worker devuelve el informe con `Comlink.transfer` sobre el búfer de salida: ya no lo necesita, así que entregarlo sale gratis. Y `createWorkerRunner` escucha `error` y `messageerror` del worker para rechazar el trabajo en vuelo; el pool lo traduce a `worker-crashed`, que no es un `PipelineError` porque la imagen no tuvo la culpa. El worker mide los milisegundos desde la lectura del archivo, no desde la decodificación: esperar el disco también es parte de lo que costó ese archivo.

## D28 — La fila guarda un `Blob`, no el `Uint8Array` que produjo el worker

**Contexto.** El store tiene que conservar cada resultado hasta que el usuario lo guarde, y la aceptación de la fase es procesar 200 imágenes sin que la memoria de la pestaña crezca sin control. Un `Uint8Array` vive clavado en el montón de JavaScript mientras exista la fila.

**Consecuencia.** Al llegar el informe, el store envuelve la salida en un `Blob` con su tipo MIME y suelta el arreglo tipado. Un `Blob` es un manejador que el navegador puede respaldar en disco, así que doscientos resultados esperando a ser guardados dejan de ser doscientos búferes en el montón. Efecto colateral que se aprovecha en la Fase 4: un `Blob` es lo que la File System Access API y `client-zip` esperan recibir. Para que esto compile sin aserciones, `EncodedBytes` declara en `core/` que los bytes codificados están respaldados por un `ArrayBuffer` común y no por uno compartido — solo esos se pueden transferir entre hilos o envolver en un `Blob`.

## D29 — El store traduce, el pool decide

**Contexto.** Al cancelar, el store podría marcar la fila como cancelada de inmediato y quedar más "reactivo". Pero el pool ya resuelve carreras que el store no ve: un trabajo que estaba contestando cuando llegó la orden, un worker que murió, un archivo que ya había terminado.

**Consecuencia.** `cancel` y `cancelAll` solo le piden al pool; la fila cambia recién cuando llega el evento. Dos lugares decidiendo el mismo estado se contradicen en la primera carrera, y el que ve la verdad es el pool. Por la misma razón el store agrega las filas **antes** de encolar: el pool arranca trabajos de forma síncrona dentro de `enqueue`, así que el primer evento `started` llega antes de que `enqueue` devuelva el control, y en el orden inverso ese evento no encontraría fila que actualizar.

## D30 — La memoria se mide desde fuera de la página, porque adentro todos los medidores mienten

**Contexto.** La aceptación de la Fase 2 exige demostrar que la memoria de la pestaña no crece con el lote. Se probaron tres medidores accesibles desde la propia página y los tres fallaron, cada uno de una forma distinta: `performance.memory.usedJSHeapSize` devuelve 10.000.000 constante en Chromium —comprobado reservando 50 MB sin que se moviera un byte—; `performance.measureUserAgentSpecificMemory()` lanza `SecurityError: not available` incluso con `crossOriginIsolated` en `true`, que es la única condición que documenta; y la métrica de montón de CDP (`Performance.getMetrics`) no cuenta los búferes de `ArrayBuffer`, que es exactamente donde vive un bitmap decodificado.

**Consecuencia.** `scripts/bench.mjs` mide desde Node la memoria residente de todo el árbol de procesos de Chrome, identificado por un directorio de perfil descartable. Es la misma cantidad que muestra el administrador de tareas del navegador, cubre el renderizador y cada worker, y se movió 204 MB cuando se le pidió reservar 200 MB —o sea que el medidor está vivo, cosa que ninguno de los otros tres podía decir. El código de la página quedó sin medición de memoria: un medidor muerto en el código es una invitación a confiar en él. Es la misma lección de la auditoría de red de la Fase 0: el instrumento se comprueba antes de creerle.

## D31 — El pico de memoria lo fija la concurrencia, no el largo de la cola

**Contexto.** El tope de 4 workers venía del spec sin número que lo respaldara. La corrida del banco lo puso a prueba con 200 imágenes.

**Consecuencia.** Con concurrencia 4 el pico son 948 MB sobre la línea base; con concurrencia 2, 519 MB. Unos 240 MB por worker, y plano respecto de la cantidad de archivos: la memoria oscila en diente de sierra sin tendencia ascendente entre el archivo 50 y el 200. La mayor parte de esos 240 MB es memoria lineal de WebAssembly, que crece para decodificar y **no se devuelve**; por eso el costo es por worker vivo y no por archivo procesado. Consecuencia práctica: subir el tope de concurrencia se paga en memoria de forma lineal e inmediata, y la única vía para bajar el pico sin perder paralelismo sería reciclar workers, que costaría reinstanciar el WASM. Queda anotado, no implementado.

## D32 — La tercera señal es violeta, porque verde/ámbar/rojo está medido y falla

**Contexto.** El spec exige que los tres estados por archivo se distingan también para daltónicos. La combinación obvia —verde, ámbar, rojo— es justamente la que no cumple, y se comprobó en lugar de suponerlo: con la simulación de Machado, Oliveira y Fernandes (2009) al 100 % de severidad y distancia CIEDE2000, un trío teal/ámbar/carmesí cae a **ΔE 8,8 entre "entró justo" y "no entró" en deuteranopía**. Dos estados opuestos, prácticamente el mismo color. Un trío azul/ámbar/magenta cae a ΔE 9,6 en protanopía.

**Consecuencia.** La paleta es teal `#0D5C52`, ámbar `#955D00` y violeta `#6D2FA8`, que no baja de **ΔE 21,8** en visión normal, protanopía, deuteranopía ni tritanopía, y donde las tres señales cumplen AA sobre el fondo (4,83:1 la peor). El ámbar tuvo que oscurecerse desde `#A86A00`, que se veía mejor pero daba 3,93:1 y no llegaba a AA. La herramienta de medición se validó antes de creerle: CIEDE2000 contra los datos de prueba de Sharma, y el contraste contra el 21:1 exacto de negro sobre blanco.

## D33 — Dos familias con eje de ancho, auto-hospedadas y subseteadas

**Contexto.** Hacía falta una monoespaciada para los números y una de interfaz con carácter. Y hay dos reglas del spec que fuerzan la mano: cero peticiones de red después de la carga inicial, y `require-corp`, que bloquea cualquier recurso externo sin cabecera CORP. Google Fonts queda descartado, así que cada byte de fuente es carga inicial.

**Consecuencia.** Instrument Sans para la interfaz y Martian Mono para los números, ambas OFL y ambas con eje `wdth` variable —verificado en la metadata de Google Fonts—, que es lo que permite condensar en una tabla densa sin deformar con `scaleX`. Se subsetean una vez con `pyftsubset` y el `.woff2` se commitea, como los fixtures: sin dependencia de build ni de ejecución. La monoespaciada se recorta a los ~25 glifos que aparecen en un número, lo que vuelve casi gratis una familia que de otro modo sería cara. Presupuesto: las dos por debajo de 60 KB, a medir y no a estimar.

## D34 — Los números se formatean con `es-419` de reserva, no con `es`

**Contexto.** Verificado con `Intl.NumberFormat`: `es` produce `1.234.567,89` y `66 %`, mientras que `es-419`, `es-PE` y `es-MX` producen `1,234,567.89` y `66%`. El público de los perfiles de trámites es latinoamericano.

**Consecuencia.** El formateo respeta el idioma del navegador, y cuando no hay uno utilizable usa `es-419`. Vive en un módulo puro que recibe el idioma como argumento, así que los tests son deterministas en lugar de depender de la máquina que los corre. En una app que es una tabla de cifras, el separador equivocado se nota en cada fila.

## D35 — Sin miniaturas por fila; el comparador abre de a un archivo

**Contexto.** Una tabla con previsualización por fila es lo que cualquiera dibujaría. Con 200 archivos son 200 decodificaciones vivas, y la Fase 2 se fue entera en demostrar que la memoria está acotada por la concurrencia y no por el largo de la cola (D31, ~240 MB por worker).

**Consecuencia.** La fila muestra cifras y la barra de peso, nunca una imagen. El comparador antes/después se abre desde una fila, muestra un archivo por vez y revoca sus `URL.createObjectURL` al cerrar. Es una decisión de arquitectura disfrazada de decisión visual: es la que decide si la herramienta sobrevive a una carpeta grande.

## D36 — Las dos fuentes se subsetean de forma asimétrica, y ninguna se inlinea

**Contexto.** D33 fijó un presupuesto de 60 KB para las dos familias sin saber el número real. Los subsets por rango Unicode de Google pesan 93,6 KB, así que no alcanzaba con descargarlos. Además hay una asimetría que importa: Instrument Sans dibuja **nombres de archivo**, que vienen del usuario y no son nuestros para adivinar, mientras que Martian Mono solo dibuja números que formateamos nosotros.

**Consecuencia.** Instrument Sans conserva todo Latin-1 —195 glifos, 25,8 KB— y Martian Mono se recorta a los 36 glifos que puede contener un número: 3,6 KB. Total **29,3 KB**, menos de la mitad del presupuesto. Las dos se instancian antes de subsetear, con el eje `wdth` fijado (100 la interfaz, 87,5 los números) y el `wght` conservado como rango, verificado leyendo la tabla `fvar` del archivo resultante. Un descubrimiento del camino: **ninguna de las dos fuentes tiene `≤` (U+2264)**, así que los límites se escriben «máx. 500 KB» y no «≤ 500 KB» — un símbolo que ninguna de nuestras familias puede dibujar caería a una fuente del sistema en medio de una columna de números propios. Y ningún `.woff2` se inlinea: el subset de números pesa menos que el umbral de Vite y estaba quedando incrustado en la hoja de estilos, que cambia con cada edición, mientras que una fuente es inmutable y se cachea para siempre.

## D37 — Los pesos se cuentan de a mil, no de a 1024

**Contexto.** Un `KB` puede ser 1000 o 1024 bytes y las dos convenciones circulan. Pero los perfiles ya están escritos y sus presupuestos son números decimales redondos: `maxBytes: 500_000` para «Adjunto de correo», `300_000` para mensajería.

**Consecuencia.** Se cuenta de a mil. Dividir por 1024 imprimiría ese mismo límite como «488 KB» justo debajo de la etiqueta que promete 500, y una herramienta cuyo argumento es la honestidad con el peso no puede permitirse esa contradicción en la primera fila. Debajo de diez unidades se muestra un decimal —0,4 KB es un archivo y 0 KB no es nada— y de ahí para arriba se redondea, porque nadie necesita «500,0 KB» y el dígito extra ensancha toda la columna.

## D38 — Soltar y comprimir son dos pasos

**Contexto.** El store encolaba al soltar, así que la cola arrancaba antes de que el usuario tocara el selector de destino. Elegir el destino es la idea central del producto: gastarse el lote entero con el perfil que estaba puesto por defecto es exactamente lo contrario.

**Consecuencia.** `add(files)` agrega filas sin trabajo y `start(plan)` manda a la cola todo lo que sigue esperando. `requeue(ids, plan)` cubre recomprimir una selección con otro destino, conservando la identidad de la fila. Efecto colateral que se aprovecha: la fila conserva su `File`, que es un manejador a disco y no una copia, y eso es lo que permite tanto recomprimir como abrir el comparador sin volver a pedirle el archivo al usuario.

## D39 — El `display` de las celdas se decide con utilidades, no en la capa de componentes

**Contexto.** La fila es una grilla que cambia de forma: tabla en pantalla ancha, cuatro líneas apiladas en angosta. Esa geometría se escribió como CSS propio en `@layer components`, incluido el `display: none` que oculta la línea de números en escritorio. No funcionó, y el modo en que falló es el detalle que importa: la capa de utilidades de Tailwind se emite después, así que `flex` en el elemento le gana a `display: none` en la capa de componentes. El resultado fue una columna de números flotando al costado de la tabla, con toda la grilla desalineada porque esa celda ocupaba un área que el template ancho no define.

**Consecuencia.** En `@layer components` vive solo la geometría —qué celda va en qué área y cómo cambia el template—; mostrar y ocultar se hace con `hidden` y `md:block` sobre el elemento. Regla general que queda: en cuanto una propiedad se declara en las dos capas, gana la utilidad, y el CSS propio pierde en silencio.

## D40 — Un presupuesto que el archivo ya cumple no es un objetivo

**Contexto.** Lo hizo visible la interfaz de la Fase 3, y es el defecto que D24 introdujo al arreglar otro. La búsqueda por presupuesto maximiza calidad contra su techo, así que apuntarla a un techo que el origen ya cumple devuelve el tamaño del origen: con «Enviar por mensajería» (máx. 300 KB) sobre una foto de 252 KB devolvía 249 KB. Un ahorro del 1 % pagado con una pasada completa de pérdida de calidad. En la captura del lote, cuatro de cinco filas quedaban en «justos» ahorrando entre 0 % y 4 %.

Peor con imágenes chicas: para un PNG de 32×32 el techo efectivo pasaba a ser sus propios 167 bytes, dentro de los cuales no entra ni el encabezado de un JPEG, así que el bucle de reducción molía la imagen hasta 9×9 y **aun así devolvía un archivo más pesado**. Destruía la foto persiguiendo un límite que nunca estuvo en el camino.

**Consecuencia.** Cuando `bytesBefore <= maxBytes`, el objetivo deja de ser el presupuesto y pasa a ser la calidad del perfil —que es para lo que el usuario eligió un destino—: una sola codificación, sin búsqueda. Si esa codificación se pasa del presupuesto, cosa posible al convertir a un formato más pesado, recién ahí entra la búsqueda. El techo de la búsqueda vuelve a ser `maxBytes` a secas: el tope contra el tamaño de origen solo se activaba en el caso que ahora se atiende aparte.

La interfaz refleja la misma regla: **la marca del presupuesto no se dibuja cuando el presupuesto nunca limitó a ese archivo**. Fijarla al borde derecho invitaba a leer «entró justo» en una fila donde el límite jamás estuvo en juego. Verificado con dos corridas que comparan calidad 40 contra calidad 90, porque una calidad reportada no prueba nada por sí sola y un umbral de tamaño solo habría descrito el contenido de ese fixture.

## D41 — Los nombres de salida se deciden una vez, fuera de los dos caminos

**Contexto.** Guardar en una carpeta y armar un ZIP son dos APIs distintas, y cada una podría resolver los nombres por su cuenta. Un choque de nombres cuesta un archivo en las dos: en una carpeta se sobrescribe en silencio, y dentro de un ZIP quedan dos entradas iguales que unas herramientas rechazan y otras descartan sin avisar.

**Consecuencia.** `src/output/names.ts` decide para ambos, sin nada de navegador adentro: extensión según el formato que realmente salió —`jpeg` se escribe `.jpg`, que es lo que espera el sistema operativo— y sufijo `-2`, `-3` antes de la extensión cuando hay repetidos, comparando sin distinguir mayúsculas porque Windows y macOS tampoco distinguen. El caso que importa no es el exótico: convertir `foto.jpg` y `foto.png` a WebP crea un choque que **no existía hasta que nosotros convertimos**. El contador sigue de largo si el usuario ya traía un `foto-2`.

## D42 — Firefox entra a la suite, acotado a la capa de salida

**Contexto.** La aceptación de la Fase 4 pide los dos caminos verificados en Chromium y en Firefox. Hasta ahora el proyecto `browser` de Vitest solo corría Chromium — o sea que el navegador donde el respaldo a ZIP deja de ser un premio consuelo y pasa a ser el único camino no se ejecutaba nunca.

**Consecuencia.** Un tercer proyecto de Vitest corre Firefox sobre `src/output/**` y nada más. Acotado a propósito: lo que la fase tiene que probar es que los dos caminos de guardado funcionan en los dos navegadores, y repetir la suite de códecs completa cuesta minutos de CI sin responder ninguna pregunta nueva. El test de detección de soporte quedó escrito para pasar en los dos: afirma que la respuesta coincide con la realidad del navegador, no una constante. Correr toda la interfaz en Firefox queda para el test de humo de la Fase 5.
