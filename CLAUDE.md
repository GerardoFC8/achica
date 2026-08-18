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

Fase: 4 — salida

Fase 3 cerrada: interfaz completa contra `docs/diseno.md` — arrastrar carpeta, selector de destino, tabla con la barra de peso, filtros, orden, selección con recomprimir y quitar, resumen total y comparador antes/después. 265 tests en verde, incluidos seis que manejan la app real en Chromium con códecs reales. Captura reproducible con `npm run screenshot`.

Guardar archivos no entró a propósito: es esta fase.

Lo que dejó escrito la Fase 3 y condiciona lo que viene:

- **D40 reemplaza a D24.** Un presupuesto que el archivo ya cumple no es un objetivo: se codifica una vez con la calidad del perfil. La interfaz no dibuja la marca cuando el presupuesto nunca limitó a ese archivo.
- Los pesos se cuentan de a mil (D37), porque los presupuestos de los perfiles son miles redondos. La memoria se sigue midiendo en potencias de dos.
- El `display` de las celdas se decide con utilidades de Tailwind; la capa `@layer components` pierde en silencio (D39).
- Soltar y comprimir son dos pasos (D38). La fila conserva su `File`, que es lo que permite recomprimir y abrir el comparador.
- La página de humo de la Fase 0 ya no se sirve: `src/smoke/` conserva módulos y tests, y la auditoría de red vuelve como test de humo en la Fase 5.

Siguiente criterio de aceptación: File System Access API con detección de soporte y respaldo a ZIP con `client-zip`, con conflictos de nombre resueltos por sufijo, y los dos caminos verificados en Chromium y en Firefox.
