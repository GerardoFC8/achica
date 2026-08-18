# Diseño

Documento cerrado en la Fase 3. Lo que antes eran preguntas abiertas ahora son decisiones, con el número que las respalda cuando existe.

La regla que gobierna todo lo demás: **esto es una herramienta, no una landing**. La primera pantalla es la zona de trabajo. No hay hero, no hay sección de características, no hay testimonios. Todo lo explicativo vive en el README.

---

## 1. Los datos que existen de verdad

Esta sección va primera a propósito. La interfaz solo puede mostrar lo que el núcleo produce, y el núcleo ya está construido y probado. Cualquier elemento que pida un dato que no está acá no se puede dibujar.

**Cada fila de la cola** (`QueueItem` en `src/state/queue.ts`) tiene:

| Campo         | Siempre       | Qué es                                                                                             |
| ------------- | ------------- | -------------------------------------------------------------------------------------------------- |
| `id`          | sí            | Identificador del trabajo                                                                          |
| `name`        | sí            | Nombre del archivo tal como lo trajo el usuario                                                    |
| `bytesBefore` | sí            | Peso original                                                                                      |
| `status`      | sí            | `pending`, `running`, `done`, `failed` o `cancelled`                                               |
| `blob`        | solo `done`   | El resultado, listo para guardar                                                                   |
| `ms`          | solo `done`   | Milisegundos que costó, medidos en el worker                                                       |
| `outcome`     | solo `done`   | `format`, `bytesAfter`, `width`, `height`, `quality`, `withinBudget`, `shrunkForBudget`, `encodes` |
| `error`       | solo `failed` | Código tipado, no un texto                                                                         |

**El total** (`totalsOf`) da `done`, `failed`, `cancelled`, `pending`, `bytesBefore`, `bytesAfter`, `savedBytes` y `savedRatio`.

**Lo que NO existe, y no se puede inventar:**

- **No hay porcentaje de avance dentro de un archivo.** El pool informa `started` y luego `settled`. Un archivo está esperando, comprimiendo, o terminado. Una barra que se llena de 0 a 100 % mientras se comprime sería una animación mentirosa.
- **No hay miniatura gratis.** Mostrar una previsualización obliga al navegador a decodificar la imagen otra vez, y la Fase 2 se fue entera en evitar exactamente eso (ver §2).
- **No hay estimación de tiempo restante.** Se puede derivar del promedio de `ms`, pero solo después de que varios archivos terminen, y con AVIF el promedio no predice nada.

---

## 2. Restricciones que trae la Fase 2

No son preferencias. Son consecuencias medidas, y romperlas rompe la promesa central del producto.

- **El pico de memoria lo fija la concurrencia: unos 240 MB por worker** (D31, medido). Cualquier cosa que la interfaz sostenga en memoria se suma a eso.
- **Los resultados viven como `Blob`** (D28), que el navegador puede respaldar en disco. Convertirlos a `data:` URL o a `Uint8Array` para mostrarlos los devuelve al montón.
- **Nada de miniaturas por fila.** 200 miniaturas son 200 decodificaciones vivas. El comparador antes/después se abre **de a un archivo por vez**, y su `URL.createObjectURL` se revoca al cerrar. Esta es una decisión de arquitectura disfrazada de decisión visual: es la que decide si la herramienta sobrevive a una carpeta grande.
- **Cero peticiones de red después de la carga inicial.** Las fuentes se auto-hospedan, no hay iconos remotos, no hay analítica. Es verificable en DevTools y hay un test de humo que lo audita.

---

## 3. Color

### Los seis valores

Se definen como propiedades personalizadas en `src/styles.css`, dentro del `@theme` de Tailwind v4, en el espacio de nombres `--color-*`. **Solo estos entran**: si la paleta por defecto de Tailwind no está declarada, `bg-gray-50` no existe y el defecto no se puede usar por descuido.

| Token              | Valor     | Trabajo                                                                                                                                |
| ------------------ | --------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `--color-paper`    | `#F2F1EC` | Fondo. Un neutro cálido apagado, no blanco: la pantalla es una superficie de trabajo llena de cifras y el blanco puro las hace vibrar. |
| `--color-ink`      | `#16181A` | Texto principal y anillo de foco.                                                                                                      |
| `--color-ink-soft` | `#5B6165` | Texto secundario, notas, filas canceladas.                                                                                             |
| `--color-fits`     | `#0D5C52` | Entró con margen.                                                                                                                      |
| `--color-tight`    | `#955D00` | Entró, pero justo.                                                                                                                     |
| `--color-over`     | `#6D2FA8` | No entró, o falló.                                                                                                                     |

Los filetes de tabla y la pista de la barra **no son un token**: son `--color-ink` al 12 % sobre el fondo, o sea `#D8D7D3`. Derivarlos en lugar de nombrarlos mantiene la paleta en seis valores y garantiza que armonicen.

### Por qué violeta para el tercer estado

Porque verde/ámbar/rojo no funciona, y está medido. Con la simulación de Machado, Oliveira y Fernandes (2009) al 100 % de severidad y distancia CIEDE2000, un trío teal/ámbar/carmesí colapsa a **ΔE 8,8 entre "justo" y "no entró" en deuteranopía**: dos estados opuestos que se ven casi idénticos. Un trío azul/ámbar/magenta colapsa a ΔE 9,6 en protanopía. El trío elegido no baja de **ΔE 21,8** en ninguna de las cuatro visiones.

| Visión       | fits      | tight     | over      | Peor par |
| ------------ | --------- | --------- | --------- | -------- |
| Normal       | `#0D5C52` | `#955D00` | `#6D2FA8` | 36,5     |
| Protanopía   | `#575652` | `#706100` | `#004FAC` | 21,8     |
| Deuteranopía | `#4D4E53` | `#7D6F04` | `#0050A6` | 22,0     |
| Tritanopía   | `#005E59` | `#A44F4E` | `#614C68` | 22,0     |

### Contraste, medido

| Sobre `--color-paper`           | Razón                    | Grado            |
| ------------------------------- | ------------------------ | ---------------- |
| `--color-ink`                   | 15,74:1                  | AAA              |
| `--color-ink-soft`              | 5,56:1                   | AA               |
| `--color-fits`                  | 6,96:1                   | AA               |
| `--color-tight`                 | 4,83:1                   | AA               |
| `--color-over`                  | 7,08:1                   | AAA              |
| Relleno de barra sobre su pista | 3,79:1 el peor (`tight`) | AA para gráficos |

### La regla que ningún valor puede romper

**El color nunca es el único indicador de estado.** Las tres señales se distinguen además por geometría —dónde termina el relleno respecto de la marca del presupuesto— y por cifra. Un usuario que no distingue ningún color debe poder leer la tabla completa sin perder un dato.

---

## 4. Tipografía

Dos familias, ambas con licencia SIL Open Font License y ambas con eje de ancho variable. Ese eje es la razón del par: en una herramienta de densidad, condensar es una decisión de diseño y no un `scaleX` que deforma las letras.

**Interfaz — Instrument Sans** (Rodrigo Fuenzalida, Jordan Egstad; OFL; ejes `wdth` 75–100 y `wght` 400–700). Etiquetas, nombres de archivo, botones, notas. Tiene altura de x alta y proporciones ajustadas, que es lo que sirve en filas de 28 px, y carácter suficiente para no leerse como plantilla. No es Inter ni ninguna grotesca neutra de startup.

**Números — Martian Mono** (Roman Shamin, Evil Martians; OFL; ejes `wdth` 75–112,5 y `wght` 100–800). Pesos, porcentajes, dimensiones, milisegundos. Monoespaciada, así que las cifras ya son tabulares por construcción; se fija `font-variant-numeric: tabular-nums` igual, y **toda columna de números va alineada a la derecha**. Se instancia en `wdth` 87,5 para que una columna de pesos ocupe lo que debe.

Esta app es una tabla de números, y esa sola decisión la separa de la mayoría de herramientas parecidas.

### Auto-hospedaje y presupuesto de bytes

Consecuencia forzosa de dos reglas del spec: cero peticiones de red después de la carga inicial, y `Cross-Origin-Embedder-Policy: require-corp`, que bloquea cualquier recurso externo sin cabecera CORP. **Google Fonts queda descartado.**

- Ambas se subsetean una sola vez con `pyftsubset` y el `.woff2` resultante se commitea, igual que se hace con los fixtures. Sin dependencia de build, sin dependencia en tiempo de ejecución.
- Instrument Sans: latin más los signos del español (`á é í ó ú ü ñ Ñ ¿ ¡ «»`), eje `wght` conservado, `wdth` fijado en 100.
- Martian Mono: solo lo que aparece en un número. Dígitos, `. , % × – / : ( ) +` y las letras de `KB`, `MB`, `ms`, `px`. Unos 25 glifos.
- **Presupuesto: las dos juntas por debajo de 60 KB en `woff2`.** Hay que medirlo, no estimarlo.
- `font-display: swap` y una pila de reserva declarada para que el reflujo sea corto.
- **Corregido al implementar:** no se precargan con `rel="preload"`. Vite las versiona dentro de `/assets`, que `_headers` ya cachea para siempre, y precargarlas exigiría nombres estables fuera de ese versionado. La hoja de estilos se carga en el `<head>` de forma síncrona, así que la petición de la fuente arranca de todos modos apenas se parsea; la precarga ganaba milisegundos en la primera visita y costaba el cacheado inmutable en todas las demás.

---

## 5. Densidad y ritmo

La fila es la unidad de diseño, no la tarjeta. Nada de tarjetas.

- **Rejilla base de 4 px.** Todo espaciado es múltiplo.
- **Altura de fila: 28 px** en puntero fino. Sale de la exigencia de ver 30 archivos: con la barra superior en 56 px y el total inferior en 52 px, una pantalla de 1080p a zoom 100 % deja unos 842 px de tabla, y 842 / 30 = 28,07.
- **Altura de fila: 48 px** en puntero grueso, porque el blanco mínimo de toque son 44 px.

Escala tipográfica, corta a propósito:

| Rol                         | Tamaño / interlínea | Familia                                 |
| --------------------------- | ------------------- | --------------------------------------- |
| Nombre de la app            | 15 / 20             | Instrument Sans 600                     |
| Etiqueta, nombre de archivo | 13 / 16             | Instrument Sans 400–500                 |
| Número en fila              | 12 / 16             | Martian Mono 400                        |
| Número del total            | 14 / 16             | Martian Mono 500                        |
| Nota, procedencia           | 12 / 16             | Instrument Sans 400, `--color-ink-soft` |

En puntero grueso todo sube dos pasos: 15 px las etiquetas, 14 px los números.

**Verificación obligatoria, con captura:** 30 filas visibles en 1920×1080 a zoom 100 %; en 1366×768 entran 19 y las 30 quedan a un desplazamiento corto. Y todo debe seguir siendo usable con el zoom del navegador al 200 %.

---

## 6. Elemento distintivo: la barra de peso

Confirmado. Uno solo, y todo lo demás alrededor se mantiene callado.

Cada fila lleva una barra que dice dónde cayó ese archivo respecto de su presupuesto. El lote entero se lee de un vistazo sin leer una sola cifra.

### Geometría

- **La pista es el peso original de ese archivo**, y ocupa siempre el ancho completo de la columna. La normalización es por fila, no compartida: lo que se compara entre filas es la proporción, que es la pregunta real —cuánto se achicó—, y una escala compartida haría invisible al archivo chico al lado del grande.
- **El relleno es el peso final** como fracción del original.
- **La marca del presupuesto** es un filete vertical en `min(maxBytes, bytesBefore) / bytesBefore`. El tope en el tamaño de origen no es un detalle de dibujo: es D24, el presupuesto es un techo y nunca se devuelve un archivo más pesado que el que entró.

### Los tres estados

| Estado           | Condición                                     | Color           | Refuerzo sin color                                                    |
| ---------------- | --------------------------------------------- | --------------- | --------------------------------------------------------------------- |
| Entró con margen | el relleno termina antes del 90 % de la marca | `--color-fits`  | Queda visiblemente corto de la marca                                  |
| Entró justo      | el relleno termina entre el 90 % y la marca   | `--color-tight` | Toca la marca                                                         |
| No entró         | el relleno pasa la marca                      | `--color-over`  | El tramo excedido se dibuja con trama diagonal, no solo con otro tono |

### Los casos que faltan

- **Sin presupuesto en el perfil** (`maxBytes` ausente): no hay marca. El relleno usa `--color-fits` y la cifra de la fila es el ahorro. Sin presupuesto, todo resultado es "lo más chico que pudimos", y dibujar una marca inventada sería mentir.
- **Esperando**: pista vacía, sin animación.
- **Comprimiendo**: la pista se marca como activa sin fingir avance, porque el avance dentro de un archivo no existe (§1). Bajo `prefers-reduced-motion` la señal es estática.
- **Falló**: sin barra. La fila muestra la causa en palabras, en `--color-over`. Un archivo corrupto no tiene peso final que graficar, y dibujarle una barra vacía lo haría parecer un archivo que pesó cero.
- **Cancelado**: sin barra, fila en `--color-ink-soft`. Fue una decisión del usuario, no un problema del archivo.
- **Redimensionado para entrar** (`shrunkForBudget` presente): la fila lo dice con todas las letras junto a las dimensiones. El usuario tiene que enterarse acá y no al abrir el archivo.

---

## 7. Estructura de pantalla

Tres zonas, sin nada más.

**Barra superior, 56 px.** Nombre de la app a la izquierda. Selector de destino. El botón de acción a la derecha. Nada centrado.

**Superficie de trabajo.** Sin archivos es la zona para soltarlos, y ocupa todo. Con archivos es la tabla, a sangre completa, sin tarjeta que la encierre. Columnas: estado y nombre, peso antes, peso después, ahorro, barra, tiempo. En puntero grueso la fila se parte en dos líneas y la barra cruza el ancho completo debajo.

**Total inferior, 52 px, fijo.** Cuántos van, cuánto pesaba el lote, cuánto pesa, cuánto se ahorró. Es la cifra por la que el usuario vino.

**El comparador antes/después** se abre desde una fila, cubre la pantalla, muestra un archivo por vez, y revoca sus URL de objeto al cerrar (§2). Vista ajustada por defecto y un conmutador a 1:1, porque los artefactos de compresión solo se ven a tamaño real.

---

## 8. Perfiles en la interfaz

El selector se llama **«Destino»**, no «Perfil» ni «Calidad». El usuario elige a dónde va la imagen y la app resuelve el resto: ese es el diferenciador y el nombre tiene que decirlo.

Perfiles genéricos de la v1: «Imagen para artículo web», «Adjunto de correo», «Enviar por mensajería», «Miniatura», agrupados por Web, Correo, Mensajería y Miniatura.

**Cada destino muestra de dónde sale su límite**, y la interfaz distingue dos cosas que no son lo mismo:

- Perfil de trámite: `Requisito de {source}, verificado el {verifiedAt}`, con enlace a la fuente.
- Perfil genérico: `Recomendación nuestra`, más su `note`. No tiene autoridad externa que citar y disfrazarlo de requisito sería la deshonestidad exacta que la regla de la fuente existe para impedir.

**El grupo «Trámites» sale vacío en la v1**, y eso hay que mostrarlo como lo que es. No un estado triste ni un grupo escondido: una línea que dice que un requisito solo entra con fuente oficial y fecha de verificación, porque un perfil con el límite equivocado es peor que no tener el perfil —el usuario se entera cuando le rechazan el trámite. Una lista vacía explicada así es una señal de que se puede confiar en la herramienta, no un hueco.

---

## 9. Copy

Verbos concretos en voz activa. El botón dice lo que pasa y el resultado usa la misma palabra. Español neutral, sin formas regionales.

| Situación           | Texto                                                                             |
| ------------------- | --------------------------------------------------------------------------------- |
| Pantalla vacía      | «Arrastra tus imágenes aquí» / «o elige archivos» / «Nada sale de tu dispositivo» |
| Botón, listo        | «Comprimir 34 imágenes»                                                           |
| Botón, corriendo    | «Cancelar»                                                                        |
| Total, terminado    | «34 imágenes comprimidas · 67,3 MB → 22,5 MB · 66 % menos»                        |
| Fila esperando      | «En cola»                                                                         |
| Fila corriendo      | «Comprimiendo»                                                                    |
| Fila redimensionada | «Se redujo a 1280 × 853 para entrar»                                              |
| Fila cancelada      | «Cancelado»                                                                       |

**Errores.** Cada código tipado del núcleo tiene un texto que dice qué pasó y qué hacer. Sin disculpas, sin vaguedad, sin rastro de pila.

| Código                        | Texto                                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------------- |
| `empty-file`                  | «Archivo vacío, no hay nada que comprimir»                                                              |
| `unknown-format`              | «No es una imagen que se pueda reconocer»                                                               |
| `unsupported-format` (`heic`) | «Las fotos HEIC del iPhone no entran en esta versión. Expórtalas como JPEG desde el teléfono»           |
| `unsupported-format` (otros)  | «{formato} no está soportado. Convierte el archivo a JPEG, PNG, WebP o AVIF»                            |
| `decode-failed`               | «{formato} dañado, no se pudo leer la imagen»                                                           |
| `encode-failed`               | «No se pudo generar el {formato} de salida»                                                             |
| `worker-crashed`              | «El navegador cortó el proceso, probablemente por falta de memoria. Prueba con menos archivos a la vez» |

**Números.** Se formatean con `Intl.NumberFormat`, en un módulo puro que recibe el idioma como argumento para que los tests sean deterministas. La reserva es **`es-419`**, no `es`: verificado, `es` produce `1.234.567,89` y `66 %`, mientras que `es-419` produce `1,234,567.89` y `66%`. En una app que es una tabla de cifras, el separador equivocado se nota en cada fila.

---

## 10. Piso de calidad

Nada de esto se anuncia en la interfaz. Simplemente está, y cada punto se verifica.

- [ ] Responsive hasta móvil, con filas de 48 px y blancos de toque de 44 px
- [ ] Foco de teclado visible: anillo de 2 px en `--color-ink` con 2 px de separación, en todo elemento accionable
- [ ] Toda la cola operable solo con teclado, incluido cancelar una fila
- [ ] `prefers-reduced-motion` respetado: sin animación de entrada de filas, sin pulso en las filas activas
- [ ] Contraste AA como mínimo, con los valores de §3
- [ ] Zoom del navegador al 200 % sin pérdida de función
- [ ] Las tres señales comprobadas en simulación de protanopía y deuteranopía
- [ ] 30 filas visibles en 1920×1080 a zoom 100 %, con captura

---

## 11. Prohibido

Las señales que hacen que una interfaz se lea como generada automáticamente:

- La paleta por defecto de Tailwind: `gray-50` de fondo, `blue-500` de primario, `rounded-lg` y `shadow-md` en todo
- Inter, Geist, o cualquier grotesca neutra de startup
- Degradados de morado a azul, en cualquier parte
- Emojis en títulos o botones
- Todo centrado, todo en tarjetas, todo con el mismo espaciado
- Fondo crema con serif de alto contraste y acento terracota
- Fondo casi negro con un único acento verde ácido
- Iconos genéricos donde un número o una palabra dicen más
- Barras de avance que se llenan sin dato que las respalde

---

## 12. Fuera de alcance en la v1

No son ideas descartadas para siempre. Son decisiones de alcance, y entran solo si alguien las pide con un motivo.

- Tema oscuro. Un solo tema, y bien resuelto.
- Miniaturas por fila (§2).
- Estimación de tiempo restante (§1).
- Inglés. La estructura del copy lo permite; la traducción es posterior.
