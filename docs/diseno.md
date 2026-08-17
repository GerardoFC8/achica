# Diseño

Este documento se completa **antes** del primer componente, en la Fase 3. Hasta entonces son preguntas abiertas, no decisiones tomadas.

La regla que lo gobierna: esto es una herramienta, no una landing. La primera pantalla es la zona de trabajo. Todo lo explicativo vive en el README.

---

## Color

La paleta se deriva de una necesidad funcional, no de una estética elegida antes. La app tiene tres estados por archivo y el color existe para distinguirlos:

- entró en presupuesto
- entró, pero justo
- no entró, o falló

De 4 a 6 valores con nombre semántico. Un neutro de fondo, una tinta para texto, y tres señales. **El color nunca es el único indicador de estado**: las tres señales deben distinguirse también para daltónicos y llevar forma, texto o posición además del tono.

- [ ] Definir los tokens y su nombre semántico
- [ ] Verificar contraste AA sobre fondo y sobre las tres señales
- [ ] Verificar las tres señales en simulación de deuteranopía y protanopía

## Tipografía

Dos roles como mínimo.

**Números.** Una monoespaciada para pesos, porcentajes, dimensiones y tiempos, con `font-variant-numeric: tabular-nums` y alineación a la derecha. Esta app es una tabla de números; esa sola decisión la separa de la mayoría de herramientas parecidas.

**Interfaz.** Una con carácter para etiquetas y encabezados. Candidatas con licencia abierta: Instrument Sans, Bricolage Grotesque, Public Sans, Space Grotesk. Queda prohibida Inter, y cualquier grotesca neutra de startup.

**Restricción que ya está decidida:** las fuentes se auto-hospedan. Es consecuencia forzosa de dos reglas del spec: cero peticiones de red después de la carga inicial, y `Cross-Origin-Embedder-Policy: require-corp`, que bloquea cualquier recurso externo sin cabecera CORP. Google Fonts queda descartado.

- [ ] Elegir la monoespaciada y justificarla
- [ ] Elegir la de interfaz y justificarla
- [ ] Subsetear y auto-hospedar ambas

## Densidad

Es una herramienta de lote: **la fila es la unidad de diseño, no la tarjeta**. Deben verse 30 archivos sin scroll infinito. Densidad legible por encima de aire decorativo.

- [ ] Definir la altura de fila y el ritmo vertical
- [ ] Comprobar 30 filas en una pantalla de laptop y el equivalente en móvil

## Elemento distintivo

Uno solo, ejecutado bien. Todo lo demás alrededor se mantiene callado.

Propuesta de partida: **la barra de peso por fila**, una representación de dónde cayó cada archivo respecto del presupuesto, que hace legible el lote entero de un vistazo sin leer cifras. Cualquier alternativa debe ser igual de específica al problema — peso, lote, presupuesto — y no genérica.

- [ ] Confirmar o reemplazar la propuesta
- [ ] Diseñar su comportamiento en los tres estados y cuando no hay presupuesto definido

## Copy

- Verbos concretos en voz activa. "Comprimir 34 imágenes", no "Procesar".
- El botón dice lo que pasa y el resultado usa la misma palabra.
- Los errores dicen qué pasó y qué hacer, sin disculparse. "PNG corrupto, no se pudo leer la cabecera", no "Algo salió mal".
- La pantalla vacía invita a actuar; no es un dibujo con texto gris.

## Piso de calidad

Nada de esto se anuncia en la interfaz. Simplemente está.

- [ ] Responsive hasta móvil
- [ ] Foco de teclado visible
- [ ] `prefers-reduced-motion` respetado
- [ ] Contraste AA como mínimo

## Prohibido

Las señales que hacen que una interfaz se lea como generada automáticamente:

- La paleta por defecto de Tailwind: `gray-50` de fondo, `blue-500` de primario, `rounded-lg` y `shadow-md` en todo
- Inter, Geist, o cualquier grotesca neutra de startup
- Degradados de morado a azul, en cualquier parte
- Emojis en títulos o botones
- Todo centrado, todo en tarjetas, todo con el mismo espaciado
- Fondo crema con serif de alto contraste y acento terracota
- Fondo casi negro con un único acento verde ácido
- Iconos genéricos donde un número o una palabra dicen más
