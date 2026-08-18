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
- **Nunca inventes requisitos de trámites.** Los perfiles del grupo "Trámites" solo entran con `source` verificable y `verifiedAt`. Sin fuente, no entra el perfil.
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

Fase: 3 — UI (implementada, no cerrada)

La interfaz está construida contra `docs/diseno.md` y la maqueta aprobada: arrastrar carpeta, selector de destino, tabla de la cola con la barra de peso, filtros, orden, selección con recomprimir y quitar, resumen total y comparador antes/después. 261 tests en verde, incluidos seis que manejan la app real en Chromium con códecs reales. Captura reproducible con `npm run screenshot`.

Guardar archivos **no** entra: es la Fase 4 del spec y se decidió respetar una fase a la vez.

**Falta para cerrar la fase, y es un hallazgo del núcleo, no de la interfaz.** La interfaz hizo visible que con un destino que tiene presupuesto, un archivo que ya entraba se recomprime igual y pierde calidad para no ganar nada: el techo efectivo es `min(maxBytes, tamañoDeOrigen)` (D24), así que la búsqueda maximiza calidad contra el propio tamaño del archivo y devuelve un 1 % de ahorro. En la captura, cuatro de cinco filas quedan en «justos» con ahorros de 0 %, 1 % y 4 %. Aparte, con imágenes diminutas el bucle de presupuesto reduce dimensiones varias veces y aun así devuelve un archivo más pesado, porque el encabezado del formato de salida ya supera al original. Las dos son cuestiones de `core/pipeline.ts` y hay que resolverlas antes de dar la fase por buena.

Lo que dejó escrito la Fase 3:

- Los pesos se cuentan de a mil, no de a 1024 (D37), porque los presupuestos de los perfiles son miles redondos.
- El `display` de las celdas se decide con utilidades de Tailwind; la capa de componentes pierde en silencio (D39).
- Soltar y comprimir son dos pasos (D38).
- La página de humo de la Fase 0 ya no se sirve: `src/smoke/` sigue con sus módulos y sus tests, y la auditoría de red vuelve como test de humo en la Fase 5.
