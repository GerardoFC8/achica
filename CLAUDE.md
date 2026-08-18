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

Fase: 5 — presentación y cierre (en curso)

Hecho: test de humo con Playwright en CI (`npm run smoke`), README final con GIF, decisiones de arquitectura y limitaciones conocidas.

Falta: desplegar el build de producción a https://achica.gfcode.dev y verificar las cabeceras contra el host en vivo. El despliegue es manual con `npx wrangler deploy` y necesita las credenciales de Cloudflare del usuario.

Lo que dejó escrito la Fase 5:

- El test de humo corre contra `dist/` servido con las cabeceras del host, en Chromium y en Firefox. Verifica el aislamiento cross-origin, el flujo completo, el ZIP que cae en disco, y **que ninguna petición salga del origen** — que es la promesa central del producto y hasta ahora solo se medía desde dentro de la página, donde Resource Timing es un piso.
- `scripts/make-gif.mjs` decodifica sus propios cuadros dentro del navegador que los sacó, porque Node no trae decodificador de PNG y agregar uno para leer capturas propias sería una dependencia de más. `gifenc` es CommonJS: los exports nombrados salen del default.
- La auditoría de red de la Fase 0 (`src/smoke/network-audit.ts`) sigue con sus tests pero ya no se sirve en la página; el test de humo la reemplazó con un instrumento mejor.
