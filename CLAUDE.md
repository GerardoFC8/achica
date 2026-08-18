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

Las cinco fases cerradas. 312 tests en verde en cuatro proyectos de Vitest (node, chromium, firefox), CI corriendo typecheck, lint, format, tests, build y el test de humo contra el build de producción.

Contra la definición de terminado del spec (sección 10): **diez de doce puntos**. Los dos que faltan son decisiones con evidencia, no deuda:

- **HEIC de entrada**: fuera de la v1 (D2). Las dos librerías disponibles son LGPL-3.0 y chocan con el eje MIT. Se detecta y se rechaza con un mensaje que dice qué hacer.
- **Opción de conservar metadatos**: no es entregable con el stack cerrado. Los códecs de @jsquash no escriben metadatos, y conservarlos tras hornear la rotación haría que los visores roten dos veces.

Verificado contra el host en vivo con `node scripts/smoke.mjs https://achica.gfcode.dev`, en Chromium y en Firefox: aislamiento cross-origin, flujo completo, ZIP válido en disco, y ninguna petición fuera del origen. Las tres peticiones que aparecen bajo `/cdn-cgi/` son de la protección anti-bots de Cloudflare, del mismo origen, y el comando las nombra.

## Si el trabajo continúa

Nada de esto está empezado y ninguno es deuda; son las puertas que la v1 dejó abiertas a propósito:

- **Volver a ofrecer el presupuesto de peso**, que es el eje 3 del spec y desde D49 no se alcanza desde la interfaz. El soporte está en el núcleo y probado; falta la manera de pedirlo.
- **Inglés.** La estructura del copy lo permite; el formateo de números ya recibe el idioma como argumento.
- **Reciclar workers** para bajar el pico de memoria (anotado en D31, no implementado).
- **Verificar el caso de 300 fotos de 12 MP** con una medición y no con un razonamiento.
