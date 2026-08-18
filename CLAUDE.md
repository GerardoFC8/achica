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

Fase: 5 — presentación y cierre

Fase 4 cerrada: los dos caminos de salida, con los nombres decididos una sola vez fuera de ambos. 299 tests en verde en cuatro proyectos de Vitest (node, chromium, firefox). El ZIP es la acción por defecto y la carpeta queda al lado (D43).

Cómo quedó verificada la aceptación, que pedía los dos caminos en Chromium y en Firefox:

- **ZIP**: `npm run verify:download` maneja la app real en los dos navegadores, dispara la descarga y comprueba el archivo que cae en disco — cabecera local, fin de directorio central, una entrada por archivo. Idéntico byte a byte en ambos.
- **Carpeta**: verificada a mano en Chromium. Ningún test puede abrir `showDirectoryPicker`: exige gesto del usuario y un diálogo nativo. Los casos difíciles —cerrar el diálogo, permiso que se cae a mitad del lote— están cubiertos con dobles en `src/output/save.browser-test.ts`.
- Firefox corre acotado a `src/output/**` (D42): es donde el ZIP es el único camino.

Lo que dejó escrito la Fase 4:

- Los nombres se deciden en `src/output/names.ts`, fuera de los dos caminos (D41). `jpeg` se escribe `.jpg`. El choque que importa lo creamos nosotros al convertir `foto.jpg` y `foto.png` al mismo formato.
- Las funciones de guardado reciben su borde de plataforma como argumento. Es lo único que las vuelve testeables.

Siguiente criterio de aceptación: un desconocido entra al link, arrastra una carpeta y obtiene resultados sin leer nada. Incluye README final con GIF, cabeceras verificadas en el host, y test de humo con Playwright en CI — que es donde corresponde llevar `verify:download` y la auditoría de red que la Fase 0 dejó en `src/smoke/`.
