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

Fase: 3 — UI

Fase 2 cerrada: pool de workers con concurrencia, cancelación real y progreso por archivo, más el store de Zustand. 196 tests en dos proyectos de Vitest. `npm run bench` procesa 200 imágenes por la cola real y mide la memoria residente del árbol de procesos de Chrome; el resultado está en el README, junto con por qué ningún medidor de memoria accesible desde la página sirve.

Lo que dejó escrito la Fase 2 y condiciona lo que viene:

- Cancelar es terminar el worker (D25). El pool es dueño del ciclo de vida de los workers; el store solo le pide y espera el evento (D29).
- La memoria está acotada por la concurrencia, no por el largo de la cola: unos 240 MB por worker (D31).
- Los resultados viven como `Blob`, nunca como `Uint8Array` (D28). La Fase 4 los necesita así.
- React todavía no está instalado. Entra con la Fase 3.

`docs/diseno.md` está cerrado: paleta verificada contra contraste AA y simulación de daltonismo (D32), tipografía elegida y con presupuesto de bytes (D33), densidad, barra de peso, copy y mapa de errores. Se escribe contra ese documento, no contra el gusto del momento.

Siguiente criterio de aceptación: flujo completo usable en escritorio y móvil, con foco y teclado correctos, y una captura o GIF que se entienda sin explicación.
