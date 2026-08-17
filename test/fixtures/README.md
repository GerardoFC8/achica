# Fixtures

Corpus de imágenes para la Fase 1. Cada binario del repositorio declara su origen, su licencia y qué caso prueba. Un fixture sin procedencia es un archivo que nadie se anima a borrar años después.

El corpus se divide en dos por una razón concreta:

- **`generated/`** son imágenes diminutas de contenido conocido, para afirmar en qué píxel exacto terminó cada color. Una foto real no permite esa precisión.
- **`vendor/`** son archivos reales de terceros, para cubrir el riesgo opuesto: que solo probemos contra nuestras propias suposiciones.

---

## `generated/`

Producidos por [`scripts/make-fixtures.mjs`](../../scripts/make-fixtures.mjs). Se comitean para que los tests no dependan de la red ni de un navegador instalado; el script se reejecuta solo cuando el corpus cambia.

La imagen base es de 64×32 con cuatro cuadrantes planos: rojo arriba a la izquierda, verde arriba a la derecha, azul abajo a la izquierda y blanco abajo a la derecha. Es deliberadamente **no cuadrada**, así una transposición se detecta por las dimensiones además de por el color.

| Archivo                                   | Qué prueba                                                                                                                                                             |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `no-exif.jpg`                             | Control negativo. Sin EXIF, no debe rotarse nada.                                                                                                                      |
| `orientation-1.jpg` … `orientation-8.jpg` | Las ocho orientaciones EXIF. El segmento APP1 lleva **solo** la etiqueta Orientation: si algo falla, no hay otro metadato al que culpar.                               |
| `truncated.jpg`                           | Cabecera válida, datos de barrido cortados a la mitad. Falla **durante** la decodificación, no en el primer byte, que es el camino de error más difícil de acertar.    |
| `empty.jpg`                               | Archivo de cero bytes.                                                                                                                                                 |
| `png-with-jpg-extension.jpg`              | Un PNG con extensión `.jpg`. La sección 6 del spec exige detectar el tipo real por firma de bytes; este es el caso que atrapa a quien confíe en el nombre del archivo. |
| `sample.webp`                             | WebP real codificado por Chromium. Su etiqueta de formato está en el desplazamiento 8, después del tamaño RIFF, no en el 4.                                            |

### `generated/headers/`

Cabeceras de contenedor **solo para detección**. No son imágenes decodificables, y la extensión `.bin` lo dice — lo que además impide que un test se apoye en la extensión justo mientras comprueba que la detección la ignora.

Las listas de marcas son el punto. Una caja `ftyp` declara una marca principal y varias compatibles, y ahí viven dos trampas reales que ninguna muestra descargada garantiza contener:

| Archivo               | Marca principal | Compatibles                    | Qué trampa cubre                                                                                                          |
| --------------------- | --------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `avif.bin`            | `avif`          | `avif`, `mif1`, `miaf`         | Los AVIF también declaran `mif1`. Un detector que compruebe HEIF primero llamaría HEIC a todos los AVIF.                  |
| `heic.bin`            | `heic`          | `heic`, `mif1`                 | Caso directo.                                                                                                             |
| `heif-mif1-major.bin` | `mif1`          | `mif1`, `heic`                 | Un HEIF real puede llevar `mif1` como marca principal y `heic` solo en la lista compatible. Leer la principal no alcanza. |
| `mp4.bin`             | `isom`          | `isom`, `iso2`, `avc1`, `mp41` | ISO-BMFF que no es una imagen. Debe rechazarse.                                                                           |
| `gif.bin`             | —               | —                              | Firma `GIF89a`. Formato real que no soportamos: merece un error distinto de "desconocido".                                |

### Comportamiento esperado por orientación

Medido contra Chromium, no deducido. La imagen base es 64×32 y las orientaciones 5 a 8 invierten las dimensiones.

| Orientación | Dimensiones | Superior izq. | Superior der. | Inferior izq. | Inferior der. | Transformación    |
| ----------- | ----------- | ------------- | ------------- | ------------- | ------------- | ----------------- |
| 1           | 64×32       | rojo          | verde         | azul          | blanco        | ninguna           |
| 2           | 64×32       | verde         | rojo          | blanco        | azul          | espejo horizontal |
| 3           | 64×32       | blanco        | azul          | verde         | rojo          | giro 180°         |
| 4           | 64×32       | azul          | blanco        | rojo          | verde         | espejo vertical   |
| 5           | 32×64       | rojo          | azul          | verde         | blanco        | transpuesta       |
| 6           | 32×64       | azul          | rojo          | blanco        | verde         | giro 90° horario  |
| 7           | 32×64       | blanco        | verde         | azul          | rojo          | transversa        |
| 8           | 32×64       | verde         | blanco        | rojo          | azul          | giro 270° horario |

---

## `vendor/exif-orientation/`

**Origen:** [recurser/exif-orientation-examples](https://github.com/recurser/exif-orientation-examples)
**Licencia:** MIT (ver `LICENSE` en esa carpeta)

Fotografías reales de cámara con EXIF rotado. Solo se comitean dos de las dieciocho del repositorio original: pesan unos 340 KB cada una y el corpus generado ya cubre las ocho orientaciones de forma sistemática. Estas dos existen para comprobar que un JPEG de cámara auténtico —con su APP1 completo, su miniatura y sus metadatos de fabricante— se decodifica y se orienta igual que nuestros fixtures sintéticos.

| Archivo           | Qué prueba                                                                        |
| ----------------- | --------------------------------------------------------------------------------- |
| `Landscape_6.jpg` | JPEG de cámara apaisado con orientación 6, el caso más común en fotos de celular. |
| `Portrait_6.jpg`  | El mismo caso en retrato.                                                         |

---

## `vendor/pngsuite/`

**Origen:** [PngSuite](http://www.schaik.com/pngsuite/), de Willem van Schaik
**Licencia:** permiso explícito de uso, copia, modificación y distribución sin cargo (ver `LICENSE` en esa carpeta)

Es la suite de pruebas canónica de PNG. Los archivos conservan su nombre original para que la procedencia sea rastreable.

### Transparencia y estructura

| Archivo        | Qué prueba                                                                                      |
| -------------- | ----------------------------------------------------------------------------------------------- |
| `basn6a08.png` | RGBA de 8 bits: canal alfa real.                                                                |
| `tbrn2c08.png` | Color verdadero con transparencia por `tRNS`, que no es un canal alfa.                          |
| `tp1n3p08.png` | Paleta con transparencia.                                                                       |
| `basn2c16.png` | Color verdadero de 16 bits. `@jsquash/png` requiere `bitDepth: 16` explícito para no truncarlo. |
| `basi2c08.png` | Entrelazado Adam-7.                                                                             |

### Corruptos

Seis modos de fallo distintos en menos de 1 KB. **El defecto de cada archivo se verificó leyendo sus bytes**, no se dedujo de la convención de nombres.

| Archivo        | Defecto verificado                                                                |
| -------------- | --------------------------------------------------------------------------------- |
| `xs1n0g01.png` | Firma PNG rota en el primer byte (`09` en vez de `89`). Falla antes de leer nada. |
| `xhdn0g08.png` | CRC inválido en `IHDR`. La cabecera existe pero no es confiable.                  |
| `xcsn0g01.png` | CRC inválido en `IDAT`. Cabecera válida, datos corruptos: falla tarde.            |
| `xd0n2c08.png` | Profundidad de bits inválida (0).                                                 |
| `xc9n2c08.png` | Tipo de color inválido (9).                                                       |
| `xdtn0g01.png` | Sin chunk `IDAT`. Estructura correcta, sin datos de imagen.                       |

---

## Pendiente

**AVIF y HEIC decodificables.** Solo hay cabeceras, suficientes para probar la detección pero no la decodificación. Chromium no sirve como generador: pedirle `image/avif` **devuelve un PNG en silencio**, sin lanzar error y con el tipo MIME cambiado. Por eso el generador comprueba `blob.type` en lugar de confiar en lo que pidió. Los fixtures decodificables entran cuando existan los envoltorios de códec.

**~~JPEG progresivo~~ — resuelto sin agregar un binario.** MozJPEG codifica progresivo por defecto, así que nuestro propio codificador produce uno. `encode.browser-test.ts` codifica, verifica que la cabecera de trama sea SOF2 (`0xFFC2`) en lugar de SOF0, y lo decodifica de vuelta. Prueba las dos direcciones, que es más de lo que habría mostrado un fixture estático.

<!-- Entrada original, conservada para explicar por qué no hay archivo:
**JPEG progresivo.** El spec lo pide como fixture de la Fase 1 y todavía no está. No hay codificador JPEG en el sistema y el lienzo de Chromium solo emite baseline. Se generará con `@jsquash/jpeg` y su opción `progressive` en cuanto exista el envoltorio de códec en `core/`, que es de esta misma fase. Está anotado acá en lugar de omitirse en silencio.
-->
