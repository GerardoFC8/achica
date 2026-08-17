# achica

Comprime y convierte **muchas imágenes a la vez**, en tu navegador. Sin backend, sin cuentas, sin límite de archivos.

Ningún byte de tus imágenes sale de tu dispositivo, y no tenés que creernos: abrí las herramientas de desarrollo, pestaña Red, y comprimí una carpeta entera. **La aplicación no hace ninguna petición después de cargar.**

Lo que sí vas a ver en el sitio desplegado son unas pocas peticiones al mismo origen bajo `/cdn-cgi/`. Son de la protección anti-bots de Cloudflare, no las hace nuestro código, no llevan datos de imagen, y desaparecen si autohospedás el proyecto — que es exactamente para lo que la licencia es MIT. La propia página las cuenta y las muestra, separadas de las nuestras, para que no tengas que confiar en este párrafo.

## El problema

Un trámite pide fotos "de menos de 500 KB". Tenés 40 fotos de 4 MB salidas del celular. Las herramientas que hay o te cobran pasadas las 20 imágenes, o te suben los archivos a un servidor ajeno, o te obligan a elegir "calidad 75" sin decirte qué significa eso para el límite que tenés que cumplir.

## Tres ejes

Cada decisión de este proyecto se justifica contra al menos uno de estos tres. Si una función no encaja en ninguno, no entra.

### 1. Abierto y sin topes

Licencia MIT, autohospedable, sin límite de archivos, sin cuentas, sin telemetría. La alternativa habitual es freemium cerrado con topes artificiales de 20 a 100 imágenes.

### 2. Perfiles por destino, no por calidad

No elegís "calidad 75". Elegís a dónde va la imagen — "Mesa de Partes", "foto para ficha", "adjunto de correo" — y la app resuelve formato, peso máximo y dimensiones.

Los perfiles de trámites solo se agregan con fuente oficial verificable y fecha de verificación. Un perfil con un límite equivocado es peor que no tener el perfil: el usuario descubre el error recién cuando le rechazan el trámite.

### 3. Presupuesto de peso de primera clase

"Dejalas todas bajo 100 KB" es la operación principal, no una casilla escondida.

## Estado

**Fase 0 — fundación.** Todavía no comprime nada. Lo que existe hoy es la base: build, tipos estrictos, linting, tests y despliegue verificado.

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
