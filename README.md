# achica

Comprime y convierte **muchas imágenes a la vez**, en tu navegador. Sin backend, sin cuentas, sin límite de archivos.

Ningún byte de tus imágenes sale de tu dispositivo, y no hace falta creernos: abre las herramientas de desarrollo, pestaña Red, y comprime una carpeta entera. **La aplicación no hace ninguna petición después de cargar.**

En el sitio desplegado sí aparecen unas pocas peticiones al mismo origen bajo `/cdn-cgi/`. Son de la protección anti-bots de Cloudflare, no las hace nuestro código, no llevan datos de imagen, y desaparecen al autoalojar el proyecto — que es exactamente para lo que la licencia es MIT. La propia página las cuenta y las muestra, separadas de las nuestras, para que nadie tenga que confiar en este párrafo. Esa cuenta es un piso, no un total: la API del navegador que la mide no registra todas las peticiones, y la página lo dice en lugar de aparentar exactitud. La autoridad sigue siendo la pestaña Red, y el código que hace la cuenta está acá para leerlo.

## El problema

Un trámite pide fotos "de menos de 500 KB". Tienes 40 fotos de 4 MB salidas del celular. Las herramientas disponibles o cobran pasadas las 20 imágenes, o suben los archivos a un servidor ajeno, o exigen elegir "calidad 75" sin explicar qué significa eso para el límite que hay que cumplir.

## Tres ejes

Cada decisión de este proyecto se justifica contra al menos uno de estos tres. Si una función no encaja en ninguno, no entra.

### 1. Abierto y sin topes

Licencia MIT, autohospedable, sin límite de archivos, sin cuentas, sin telemetría. La alternativa habitual es freemium cerrado con topes artificiales de 20 a 100 imágenes.

### 2. Perfiles por destino, no por calidad

No eliges "calidad 75". Eliges a dónde va la imagen — "Mesa de Partes", "foto para ficha", "adjunto de correo" — y la app resuelve formato, peso máximo y dimensiones.

Los perfiles de trámites solo se agregan con fuente oficial verificable y fecha de verificación. Un perfil con un límite equivocado es peor que no tener el perfil: el usuario descubre el error recién cuando le rechazan el trámite.

### 3. Presupuesto de peso de primera clase

"Déjalas todas bajo 100 KB" es la operación principal, no una casilla escondida.

## Estado

**Fase 1 cerrada.** El núcleo ya comprime, pero todavía no hay interfaz. Detección por firma de bytes, orientación EXIF, redimensionado, presupuesto de peso y perfiles, con 147 tests. Desplegado en https://achica.gfcode.dev

El plan completo por fases está en [`docs/spec.md`](docs/spec.md). Las decisiones técnicas y por qué se tomaron, en [`docs/decisiones.md`](docs/decisiones.md).

## Desarrollo

```bash
npm install
npm run dev        # servidor local
npm run build      # build estático a dist/
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
npm run test       # vitest
```

## Licencia

MIT. Ver [`LICENSE`](LICENSE).
