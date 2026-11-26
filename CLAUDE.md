# achica

Compresor de imágenes por lotes, 100% client-side, sin backend ni cuentas.

**Antes de cualquier tarea, lee `docs/spec.md`.** Ahí está el stack cerrado, la arquitectura, la dirección de diseño y las fases. Este archivo solo contiene las reglas que no se negocian nunca.

## Reglas permanentes

- **`src/core/` no importa React ni toca `window`.** Es lógica pura y testeable. Si una función de `core/` necesita el DOM, está mal diseñada.
- **El stack de la sección 4 del spec está cerrado.** Si una decisión es técnicamente inviable, dilo con evidencia antes de implementar. Nunca la cambies en silencio.
- **Nada de la sección 3 (no objetivos) entra al proyecto.** Cada función fuera de alcance es una semana que aleja el despliegue.
- **Una fase a la vez.** No empieces la siguiente sin que la anterior cumpla su criterio de aceptación, con tests en verde y commit funcional.
- **Sin `any` sin comentario que lo justifique.** TypeScript en modo estricto.
- **Antes de agregar una dependencia, justifícala en el mismo commit.**
- **Cada decisión no obvia va a `docs/decisiones.md`**: una línea de contexto, una de consecuencia.
- **Nunca inventes requisitos de trámites.** El grupo "Trámites" salió del producto en D48, pero la regla no caduca: si vuelve, un perfil solo entra con `source` verificable y `verifiedAt`, y esa obligación va en el tipo. Sin fuente, no entra el perfil.
- **Cero peticiones de red después de la carga inicial.** Es la promesa central del producto y debe ser verificable en DevTools.

## Comandos

```
npm run dev
npm run build
npm run test
npm run typecheck
npm run lint
```

## Estado actual

**v1 terminada y desplegada** en https://achica.gfcode.dev

Las cinco fases cerradas. 336 tests en verde en cuatro proyectos de Vitest (node, chromium, firefox), CI corriendo typecheck, lint, format, tests, build y el test de humo contra el build de producción.

Contra la definición de terminado del spec (sección 10): **diez de doce puntos**. Los dos que faltan son decisiones con evidencia, no deuda:

- **HEIC de entrada**: fuera de la v1 (D2). Las dos librerías disponibles son LGPL-3.0 y chocan con el eje MIT. Se detecta y se rechaza con un mensaje que dice qué hacer.
- **Opción de conservar metadatos**: no es entregable con el stack cerrado. Los códecs de @jsquash no escriben metadatos, y conservarlos tras hornear la rotación haría que los visores roten dos veces.

Verificado contra el host en vivo con `node scripts/smoke.mjs https://achica.gfcode.dev`, en Chromium y en Firefox: aislamiento cross-origin, flujo completo, ZIP válido en disco, y ninguna petición fuera del origen. Las tres peticiones que aparecen bajo `/cdn-cgi/` son de la protección anti-bots de Cloudflare, del mismo origen, y el comando las nombra.

Después de la v1: la primera pantalla viaja prerenderizada en el HTML con metadatos para buscadores y vistas previas (D52), el tope de peso volvió como elección del usuario (D53) y la interfaz existe en inglés en `/en/` (D54). Los textos viven en `src/ui/copy/`, nunca escritos dentro de un componente.

## Si el trabajo continúa

**Rumbo vigente (D56):** achica pasa a ser una suite de herramientas de imagen, cada una con su ruta (`/quitar-exif`, `/censurar-imagen`, `/stickers-emojis-discord`, `/auditar-imagenes-web`, y las demás). El editor y el video ya no son no objetivos de la sección 3, pero las reglas permanentes de arriba siguen mandando: `core/` puro, cero peticiones de red, una fase a la vez, y ninguna dependencia o licencia nueva sin justificarla en el mismo commit.

Hechas: S0, la base de páginas generadas desde `src/tools/registry.ts` (D57), S1, Redimensionar y Convertir sobre la misma cola (D58), S2, Quitar EXIF por bytes sin recodificar (D59), y S3, el auditor de imágenes de una web a partir de un HAR (D60; nunca se piden URLs). Siguen aplazados el snippet de DevTools (dimensiones mostradas frente a naturales), las landings tipo `/png-a-webp`, HEIC (S4), AVIF en Quitar EXIF y las herramientas `/censurar-imagen` y `/stickers-emojis-discord`.

Nada de lo que sigue está empezado y ninguno es deuda; son las puertas que la v1 dejó abiertas a propósito:

- **Reciclar workers** para bajar el pico de memoria (anotado en D31, no implementado).
- **Verificar el caso de 300 fotos de 12 MP** con una medición y no con un razonamiento.
