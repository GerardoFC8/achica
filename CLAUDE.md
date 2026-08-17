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

Fase: 1 — núcleo sin UI

Fase 0 cerrada: build limpio, CI en verde y https://achica.gfcode.dev en vivo, sirviendo `.wasm` como `application/wasm` con `crossOriginIsolated` activo.

Siguiente criterio de aceptación: suite de Vitest con imágenes reales de fixture (JPEG de cámara con EXIF rotado, PNG con transparencia, JPEG progresivo, archivo corrupto) que compruebe que el resultado cabe en el presupuesto, que la orientación es correcta, que la transparencia sobrevive y que el archivo corrupto produce un error tipado y no una excepción. Cero React.
