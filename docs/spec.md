# Prompt de proyecto: compresor de imágenes por lotes, 100% client-side

> Documento para pegar como contexto inicial en Claude Code / OpenCode al arrancar el repositorio.
> Está escrito para una metodología Spec-Driven Development: cada fase define entregable y criterio de aceptación.

---

## 1. Rol y contexto

Actúa como ingeniero senior de frontend con experiencia en WebAssembly, Web Workers y procesamiento de imágenes en el navegador. El desarrollador tiene ~4 años de experiencia full-stack, stack principal PHP/JS, cómodo con TypeScript y con despliegue en VPS propio.

No propongas alternativas de stack: las decisiones de la sección 4 están cerradas. Si detectas que una de ellas es inviable en la práctica, dilo explícitamente con evidencia técnica antes de implementar, no la cambies en silencio.

---

## 2. Qué se construye

Una aplicación web estática que comprime y convierte **múltiples imágenes a la vez**, sin backend, sin cuentas, sin límite de archivos, y sin que ningún byte salga del dispositivo.

Existen competidores (Asset Melt, PicsSizer, GetCompress, TinyPNG). El proyecto NO compite en funcionalidad genérica. Se diferencia en tres ejes, y toda decisión de producto debe justificarse contra al menos uno:

1. **Abierto y sin topes.** Licencia MIT, autohospedable, sin límite de archivos, sin cuentas, sin telemetría. La competencia es freemium cerrada con topes artificiales de 20 a 100 imágenes.
2. **Perfiles por destino, no por calidad.** El usuario no elige "calidad 75". Elige el destino ("imagen para artículo web", "adjunto de correo") y la app resuelve formato, dimensiones y calidad. Nació como "perfiles por trámite" y ese grupo salió del producto en D48: la lista siguió vacía después del despliegue y el usuario no tenía un trámite que resolver. La regla que lo gobernaba sigue escrita en `types.ts` por si vuelve.
3. **Presupuesto de peso como ciudadano de primera clase.** "Déjalas todas bajo 100 KB" es la operación principal, no una casilla escondida. Está implementado y probado en el núcleo, pero desde D49 ningún perfil del catálogo lo usa, así que hoy no se alcanza desde la interfaz. Eje pendiente, no eje cumplido.

**Nombre de trabajo:** `achica`. Verbo imperativo en español ("hazlo más pequeño"), tres sílabas, se escribe correctamente al oírlo una sola vez. Confirmar disponibilidad de dominio y de organización en GitHub antes de fijarlo. Alternativas: `pesojusto`, `encoge`. Se despliega en un subdominio de `gfcode.dev`.

---

## 3. No objetivos

Rechaza estas funciones si aparecen durante el desarrollo. Son las que convierten herramientas pequeñas en proyectos abandonados:

- Editor de imágenes (recorte manual, filtros, texto, dibujo)
- Cuentas de usuario, sincronización en la nube, historial en servidor
- Backend de cualquier tipo, incluso "solo para analytics"
- Eliminación de fondo, upscaling con IA, cualquier modelo pesado
- Soporte a video
- Internacionalización más allá de español e inglés
- App de escritorio o extensión de navegador en la v1

---

## 4. Stack cerrado

| Capa | Decisión | Razón |
|---|---|---|
| Build | Vite + TypeScript (modo estricto) | Salida estática pura, sin runtime de servidor. Next.js sería peso muerto aquí. |
| UI | React 19 | Familiaridad, ecosistema. |
| Estilos | Tailwind CSS v4 | Sin librería de componentes: el diseño es parte del portafolio. |
| Estado | Zustand | La cola de archivos es estado global con muchas actualizaciones parciales. Context re-renderizaría de más. |
| Códecs | `@jsquash/*` (jpeg, webp, avif, png, oxipng, resize) | Mismos códecs WASM que Squoosh (MozJPEG, libwebp, libavif, Oxipng), empaquetados para navegador y Web Workers. Apache 2.0. |
| Entrada HEIC | `heic-to` o `libheif-js` | Fotos de iPhone. Carga diferida: el WASM es pesado y la mayoría de usuarios no lo necesita. |
| Workers | Pool propio + Comlink | Comlink elimina el ruido de `postMessage`. El pool se implementa a mano para controlar concurrencia y cancelación. |
| Salida ZIP | `client-zip` | Streaming, sin acumular todo el ZIP en memoria. JSZip no sirve para lotes grandes. |
| Escritura local | File System Access API con fallback a ZIP | Escribir directo en la carpeta es la mejor UX donde existe (Chromium). |
| Persistencia | IndexedDB vía `idb` | Guarda perfiles personalizados. Nada de datos de imagen. |
| Tests | Vitest (lógica) + Playwright (humo) | Ver sección 8. |
| Despliegue | Build estático en Cloudflare Pages o GitHub Pages, subdominio de gfcode.dev | Estático puro. Sin servidor propio que mantener, coherente con el argumento del proyecto. |

### Notas de integración obligatorias

- Vite necesita `optimizeDeps.exclude` para los paquetes `@jsquash` que usan glue de `wasm-pack`, o falla con "both async and sync fetching of the wasm failed". Configúralo desde el primer commit.
- Los binarios `.wasm` deben servirse como assets, no inlinearse.
- Verificar en el primer despliegue que el host sirve los `.wasm` con tipo MIME `application/wasm`. Si no, `WebAssembly.instantiateStreaming` falla y hay que usar el camino alternativo con `arrayBuffer()`. Se comprueba en la pestaña de red en dos minutos.

### 4.1 Aislamiento cross-origin: deseable, no bloqueante

El códec AVIF de jSquash tiene versión multihilo y monohilo. La multihilo requiere `SharedArrayBuffer`, y la librería detecta el entorno y cae automáticamente a monohilo donde no está disponible. Consecuencia: **sin cabeceras COOP y COEP la app funciona igual, solo codifica AVIF más lento.**

Reglas derivadas:

- La app detecta `crossOriginIsolated` en tiempo de ejecución y comunica el modo en la UI. Si está en monohilo y el usuario elige AVIF para un lote grande, se le advierte antes de empezar, no después.
- Si el host permite cabeceras (Cloudflare Pages vía `_headers`, Vercel vía `vercel.json`), se configuran `Cross-Origin-Opener-Policy: same-origin` y `Cross-Origin-Embedder-Policy: require-corp`.
- Si el host no las permite (GitHub Pages), se acepta el modo monohilo y se documenta en el README. **No usar el truco de `coi-serviceworker`** salvo decisión explícita del desarrollador: obliga a una recarga en la primera visita y es difícil de justificar.
- Con `require-corp` activo, cualquier recurso externo necesita cabecera CORP. La app no debe cargar recursos externos de todas formas (ver criterio de cero peticiones de red en la sección 10).

---

## 5. Arquitectura

```
src/
  core/                 Lógica pura, sin React, sin DOM. 100% testeable.
    codecs/             Envoltorio por formato sobre @jsquash
    budget.ts           Búsqueda de calidad para alcanzar un peso objetivo
    pipeline.ts         decode -> orientar -> resize -> encode
    profiles/           Definición y resolución de perfiles
  workers/
    encode.worker.ts    Un trabajo = un archivo. Expuesto con Comlink.
    pool.ts             Pool con concurrencia y cancelación
  state/                Store Zustand: cola, progreso, resultados
  ui/                   Componentes React
  output/               File System Access API, client-zip
```

**Regla dura:** `core/` no importa nada de React ni toca `window`. Si una función de `core/` necesita el DOM, está mal diseñada. Esta separación es la que hace que el proyecto se pueda testear y es lo que un revisor de código va a mirar primero.

### Flujo por archivo

```
File
  -> decode (según tipo detectado, no según extensión)
  -> aplicar orientación EXIF al bitmap
  -> resize si el perfil lo pide
  -> encode (una pasada, o iterativo si hay presupuesto de peso)
  -> Blob + métricas (bytes antes/después, ms, calidad final)
```

---

## 6. Decisiones técnicas que hay que resolver bien

Estas son las que separan la herramienta seria del clon de fin de semana. Trátalas como requisitos, no como detalles.

**Orientación EXIF.** Si no aplicas la orientación al bitmap antes de codificar, las fotos de celular salen rotadas. Es el bug más común de este tipo de herramienta. Los metadatos se eliminan por defecto (privacidad), pero la orientación debe haberse aplicado ya al píxel.

**Búsqueda por presupuesto de peso.** Para "que pese menos de X KB": bisección sobre el parámetro de calidad, máximo 8 iteraciones, con corte temprano si dos iteraciones consecutivas quedan dentro de un margen del 3%. Si en calidad mínima aceptable (definir umbral, sugerido 40) todavía no entra, reducir dimensiones y reintentar. Documenta en el README que se optimiza por tamaño y no por métrica perceptual, y por qué (Butteraugli multiplicaría el costo por imagen).

**Memoria.** Este es el punto donde la mayoría de estas herramientas se cae. Nunca mantener `ImageData` decodificado de todos los archivos a la vez. Concurrencia por defecto: `navigator.hardwareConcurrency - 1`, con tope de 4. Liberar `ImageBitmap` con `.close()` y revocar los object URLs de previsualización. Debe sobrevivir a una cola de 300 fotos de 12 MP.

**Cancelación.** `AbortController` por trabajo y botón de cancelar todo. Cancelar debe detener trabajos en vuelo, no solo dejar de encolar.

**Errores por archivo.** Un archivo corrupto o un formato no soportado marca ese archivo como fallido y la cola continúa. Nunca abortar el lote entero. Cada fallo muestra causa legible, no un stack trace.

**Detección de tipo real.** Por firma de bytes (magic number), no por extensión. Un `.jpg` que en realidad es PNG es un caso común y real.

---

## 7. Modelo de perfiles

El diferenciador vive aquí. Un perfil es data, no código:

```ts
type Profile = {
  id: string
  label: string            // "Adjunto de correo"
  group: 'Web' | 'Correo' | 'Mensajería' | 'Miniatura'
  format: 'jpeg' | 'webp' | 'png' | 'avif' | 'keep'
  maxBytes?: number        // ningún perfil del catálogo lo usa hoy (D49)
  maxWidth?: number
  maxHeight?: number
  minQuality?: number
  quality?: number
  stripMetadata: boolean
  note?: string            // qué hace este perfil y por qué
}
```

`keep` es la postura por defecto (D49): solo el perfil web cambia la extensión, porque ahí convertir a WebP es lo que se está pidiendo. Devolver un `.jpg` a quien entregó un `.png` cambia el nombre que va a buscar y le quita la transparencia sin decirlo.

**Los perfiles de trámite salieron del producto (D48).** El grupo existió con la lista vacía durante toda la v1 y nunca recibió un perfil. Hoy los cuatro perfiles del catálogo son recomendaciones propias, y el selector lo dice en cada fila: ninguno cita una autoridad externa porque ninguno la tiene.

**Instrucción crítica, vigente si el grupo vuelve:**

No inventes ni estimes valores de requisitos de portales del Estado. Un perfil de trámite se agrega únicamente con `source` (URL o documento oficial) y `verifiedAt`, y esa obligación va en el tipo, no en un comentario. Si el requisito no se puede verificar, el perfil no entra. Un perfil con un límite equivocado es peor que no tener el perfil, porque el usuario descubre el error recién cuando le rechazan el trámite.

La UI debe mostrar de dónde sale cada requisito. Eso es lo que hace confiable la herramienta.

---

## 8. Dirección de diseño

La interfaz es parte del portafolio. Un diseño que se lea como plantilla anula el trabajo técnico. Estas reglas son obligatorias.

### Premisa

**Esto es una herramienta, no una landing page.** No hay hero, no hay sección de características, no hay testimonios, no hay llamada a la acción. La primera pantalla es la zona de trabajo: arrastras y ya estás dentro. Todo lo explicativo vive en el README, no en el sitio.

### Anti-defaults: prohibido

Estas son las señales que hacen que una interfaz se lea como generada por IA. Ninguna entra:

- La paleta de Tailwind por defecto: `gray-50` de fondo, `blue-500` de primario, `rounded-lg` y `shadow-md` en todo
- Inter como tipografía (ni Geist, ni ninguna grotesca neutra de startup)
- Degradados morado a azul, en cualquier parte
- Emojis en títulos o botones
- Todo centrado, todo en tarjetas, todo con el mismo espaciado
- Fondo crema con serif de alto contraste y acento terracota
- Fondo casi negro con un único acento verde ácido
- Iconos genéricos donde un número o una palabra dicen más

### Sistema de tokens

Antes de escribir componentes, define y escribe en `docs/diseno.md`:

**Color.** De 4 a 6 valores con nombre semántico, no decorativo. El color aquí tiene trabajo real que hacer: la app tiene tres estados por archivo (entró en presupuesto / entró pero justo / no entró o falló). Deriva la paleta de esa necesidad funcional, no de una estética elegida antes. Un neutro de fondo, un tinta para texto, y tres señales distinguibles también para daltónicos (el color nunca es el único indicador de estado).

**Tipografía.** Dos roles mínimo:
- Una monoespaciada para **todos los números**: pesos, porcentajes, dimensiones, tiempos. Con cifras tabulares (`font-variant-numeric: tabular-nums`) y alineadas a la derecha. Esta app es una tabla de números y esa sola decisión la separa del 90% de las herramientas parecidas.
- Una de interfaz con carácter para etiquetas y encabezados. Candidatas con personalidad y licencia abierta: Instrument Sans, Bricolage Grotesque, Public Sans, Space Grotesk. Elige una y justifícala en `docs/diseno.md`.

**Densidad.** Es una herramienta de lote: la fila es la unidad de diseño, no la tarjeta. Debe poder verse 30 archivos sin scrollear infinito. Prioriza densidad legible sobre aire decorativo.

### Elemento distintivo

Elige uno y solo uno, ejecutado bien. Propuesta de partida: **la barra de peso por fila**, una representación visual de dónde cayó cada archivo respecto del presupuesto, que hace que el lote entero se lea de un vistazo sin leer cifras. Si el agente propone otro, debe ser igual de específico al problema (peso, lote, presupuesto) y no genérico.

Todo lo demás alrededor se mantiene callado y disciplinado.

### Copy

- Verbos concretos en voz activa. "Comprimir 34 imágenes", no "Procesar".
- El botón dice lo que pasa, y el resultado usa la misma palabra.
- Los errores dicen qué pasó y qué hacer, sin disculparse y sin vaguedad. "PNG corrupto, no se pudo leer la cabecera" y no "Algo salió mal".
- La pantalla vacía es una invitación a actuar, no un dibujo con texto gris.
- Español como idioma base, inglés después.

### Piso de calidad

Responsive hasta móvil. Foco de teclado visible. `prefers-reduced-motion` respetado. Contraste AA mínimo. Nada de esto se anuncia en la UI, simplemente está.

---

## 9. Método de trabajo

Seis fases. Cada una termina con commit funcional, tests en verde y demo visible. No pasar a la siguiente sin cumplir el criterio de aceptación.

### Fase 0: fundación
Repo, Vite + TS estricto + Tailwind, ESLint y Prettier, Vitest configurado, CI en GitHub Actions (typecheck, lint, test, build). Licencia MIT. README con el problema y los tres ejes de diferenciación.
Incluye **desplegar una página vacía** al host definitivo desde el primer día, con dominio conectado.
**Aceptación:** `npm run build` limpio, CI en verde, y una URL pública viva sobre un repo prácticamente vacío. Los problemas de hosting (MIME de wasm, cabeceras, dominio) se descubren aquí y no en la fase 5.

### Fase 1: núcleo sin UI
`core/` completo: códecs, pipeline, orientación EXIF, presupuesto de peso, resolución de perfiles. Cero React.
**Aceptación:** suite de Vitest con imágenes reales de fixture (JPEG de cámara con EXIF rotado, PNG con transparencia, JPEG progresivo, archivo corrupto) que comprueba: el resultado cabe en el presupuesto, la orientación es correcta, la transparencia sobrevive, el archivo corrupto produce error tipado y no una excepción.

### Fase 2: workers y cola
Pool con concurrencia, cancelación y progreso por archivo. Store de Zustand.
**Aceptación:** script de banco de pruebas que procesa 200 imágenes sin que la memoria de la pestaña crezca de forma monótona. Medir con el perfilador de Chrome y anotar el resultado en el README.

### Fase 3: UI
Arrastrar carpeta, tabla de la cola con estado y ahorro por archivo, selector de perfil, comparador antes/después, resumen total. Diseño propio, sin plantilla.
**Aceptación:** flujo completo usable en escritorio y móvil, teclado y foco correctos, y una captura o GIF que se entienda sin explicación.

### Fase 4: salida
File System Access API con detección de soporte, fallback a ZIP con `client-zip`, conflictos de nombre resueltos con sufijo.
**Aceptación:** los dos caminos verificados en Chromium y en Firefox.

### Fase 5: presentación y cierre
Despliegue de producción bajo subdominio de gfcode.dev. Cabeceras verificadas si el host las soporta, o degradación documentada si no. README final con GIF, decisiones de arquitectura y limitaciones conocidas. Test de humo con Playwright en CI.
**Aceptación:** un desconocido entra al link, arrastra una carpeta y obtiene resultados sin leer nada.

### Reglas transversales

- Commits pequeños en español o inglés, pero consistentes. Conventional commits.
- Ningún `any` en TypeScript sin comentario que justifique.
- Cada decisión no obvia (elegir bisección, tope de concurrencia, quitar metadatos) queda escrita en `docs/decisiones.md` con una línea de contexto y una de consecuencia. Este archivo es material de entrevista.
- Antes de agregar una dependencia: justificarla en el mismo commit.

---

## 10. Definición de terminado (v1)

- [ ] Procesa 200+ imágenes sin colgar ni agotar memoria
- [ ] JPEG, PNG, WebP, AVIF de entrada y salida; HEIC de entrada
- [ ] Presupuesto de peso funcionando y verificado contra objetivos reales
- [ ] Orientación EXIF correcta en fotos de celular
- [ ] Metadatos eliminados por defecto, con opción de conservarlos
- [ ] Errores por archivo sin romper el lote
- [ ] Cancelación real
- [ ] Escritura a carpeta y descarga ZIP
- [ ] Perfiles de destino funcionando, cada uno diciendo que es recomendación propia (los de trámite salieron en D48)
- [ ] Cero peticiones de red después de la carga inicial (verificable en DevTools, y dicho en el README como promesa comprobable)
- [ ] Desplegado y accesible
- [ ] README con GIF, arquitectura, limitaciones y `docs/decisiones.md`

---

## 11. Riesgos conocidos

- **AVIF es lento de codificar.** Puede tardar segundos por imagen. Advertirlo en la UI antes de que el usuario encole 200 archivos, no después.
- **HEIC infla el bundle.** Cargar el módulo solo cuando aparece un HEIC en la cola.
- **Safari es el terreno frágil.** Probar temprano, no en la fase 5. Si algo no funciona ahí, documentarlo en vez de pelear.
- **Empaquetar PNG es la corrida más cara.** Resuelto en D50 con oxipng, que es la única compresión que un formato sin pérdida puede recibir, pero cuesta 2,2 s por foto de 2 MP y sube el pico de memoria un 23,5 % porque abre un pool de hilos dentro de cada worker. Medido, acotado, y sin crecimiento por archivo.
- **Alcance.** Cada función fuera de la sección 3 es una semana que no acerca el proyecto al despliegue. El proyecto solo vale desplegado.

---

## 12. Primera tarea

No escribas código todavía. Devuelve:

1. Cualquier punto donde este documento se contradiga o donde una decisión de la sección 4 sea técnicamente inviable, con evidencia.
2. La lista de fixtures de imagen que hacen falta para la fase 1 y cómo obtenerlos.
3. El plan de la fase 0 desglosado en tareas concretas.

Luego espera confirmación antes de implementar.
