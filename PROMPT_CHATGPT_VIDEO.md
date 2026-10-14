Actuá como un prompt engineer senior especializado en video de producto con motion graphics y en escribir prompts para modelos de IA que programan (Claude Opus 5.5 trabajando en Claude Code, con acceso al repositorio del producto).

## Tu tarea

Escribime UN prompt final, listo para copiar y pegar, para que Claude Opus 5.5 produzca un video promocional en motion graphics de BarberOS que recorra toda la herramienta y muestre sus funciones. No hagas el video vos ni escribas el guion suelto: tu entregable es el prompt.

Antes de escribirlo, haceme hasta 5 preguntas cortas si algo crítico no está definido (por ejemplo: duración, formato vertical u horizontal, si lleva locución o solo texto en pantalla, música). Si te contesto "decidí vos", usá estos valores por defecto:
- Versión principal: 45 a 60 segundos, horizontal 16:9 (1920x1080), para la landing y YouTube.
- Versión corta: 15 a 30 segundos, vertical 9:16 (1080x1920), para Reels y TikTok.
- Sin locución. Texto en pantalla, cinético. Pista de música indicada como placeholder.

## Contexto de la herramienta que Opus va a usar

- Opus trabaja en Claude Code, dentro del repo de BarberOS (React 19 + Vite, CSS puro, Firebase). Puede leer el código, los componentes reales y los SVG de `public/img/`.
- El video se tiene que generar con código y renderizar a MP4. Pedile que use **Remotion** (React), así reutiliza la estética real de la app (pantallas recreadas como componentes, no capturas borrosas). Que el proyecto de video viva en una carpeta aparte (`/video`) para no tocar la app.
- Tiene que poder previsualizar, iterar y renderizar. Pedile que entregue: el proyecto Remotion, el guion/storyboard con tiempos, y el comando exacto para renderizar cada versión.

## Lo que tiene que tener el prompt que escribas

1. **Rol y objetivo** claros para Opus (director de motion graphics + desarrollador Remotion).
2. **Instrucción de leer primero** `CLAUDE.md` (está al día) y `BRIEF-BARBEROS.md` (tono y marca, pero atrasado en funciones), y revisar `src/pages/` para recrear las pantallas fielmente. Orden de autoridad: código > CLAUDE.md > brief. Funciones que existen hoy y el brief no menciona, y que el video tiene que poder mostrar: reseñas de 1 a 5 estrellas con promedio por barbero, cuentas con hasta 4 sucursales (el cliente elige a cuál va), horario cortado (ej. 8 a 16 y 19 a 22), botones de WhatsApp "Recordatorio" y "Gracias" por turno (abren WhatsApp con el mensaje escrito, lo manda el barbero), foto de cada barbero, logo y colores propios, ingresos del mes con comparación contra el anterior, promos por día y franja horaria, agenda del día pensada para el celular.
3. **Storyboard escena por escena** con tiempos en segundos, qué se ve, qué texto aparece y qué animación lo lleva. Arco narrativo sugerido:
   - Gancho (dolor): el celular vibrando mientras cortás. "Cortás el corte para contestar."
   - Giro: "Tu agenda no vive en WhatsApp. Vive acá."
   - Recorrido del cliente: link en el perfil de Instagram → página de reserva con el nombre de la barbería → barbero → servicio → día → hora → confirmado. Entra con Google, sin app.
   - Recorrido del barbero: notificación en el celular "Nuevo turno" aunque la app esté cerrada → panel con barra lateral negra, "Hola, Martín", turnos del día con estados (Pendiente / Confirmada / Cancelada).
   - Carga manual de un turno de WhatsApp en dos toques + walk-in que bloquea el horario.
   - Panel del dueño: facturación del mes, servicio que más deja, ausencias. "Números de verdad. Sin planillas."
   - Roles: el dueño ve todo, cada barbero ve lo suyo.
   - Después del corte: botón "Gracias" que abre WhatsApp con el mensaje listo + el cliente deja su reseña de 5 estrellas.
   - Sucursales: una cuenta, varios locales; el cliente elige a cuál va.
   - Marca propia: la página de reserva con la identidad de la barbería. "Con tu cara, no la nuestra."
   - Onboarding: Hablamos → Te la dejamos lista → Compartís el link. "Esa misma tarde entra el primer turno."
   - Cierre/CTA: "Probala 10 días sin pagar nada. No pedimos tarjeta." + botón "Pedir mi prueba de 10 días" + wa.me/5492257529684 + firma "BarberOS · por SACIA".
4. **Lenguaje de motion** concreto: transiciones con zoom/paneo de cámara sobre un mockup de celular y de laptop, cursor/dedo simulado que toca botones, cards que entran con spring suave, números que cuentan hacia arriba, texto cinético palabra por palabra, match cuts entre escenas. Ritmo ágil (cortes cada 2 a 4 s), easing consistente, nada de efectos baratos (sin glitch, sin partículas, sin 3D genérico).
5. **Identidad visual estricta** (copiala al prompt tal cual):
   - Casi todo blanco/casi-blanco (`#fafafa`, `#ffffff`) y negro (`#0a0a0a`). Un solo acento naranja `#e03d00` (hover `#ff5c1a`, suave `#fdf0eb`). El naranja es acento: una palabra, un botón, un subrayado. Nunca mayoría.
   - Escenas sobre negro `#0a0a0a` con texto blanco y acento naranja también valen.
   - Estados: éxito `#0f9960`, advertencia `#b45309`, error `#d92d20`.
   - Tipografías: Space Grotesk 700 con tracking negativo para títulos; Space Mono en MAYÚSCULAS con tracking amplio para etiquetas, con el punto `•` adelante (ej: `• TURNOS PARA BARBERÍAS · ARGENTINA`).
   - Esquinas de 8px, bordes finos `rgba(0,0,0,0.08)`, sombras mínimas, cero degradados, cero violeta o azul, cero estética "startup genérica".
   - Logo en `public/img/barberos-logo-full.svg` y `barberos-logo-icon.svg`. Ilustraciones planas de línea fina en `public/img/`.
6. **Tono del texto en pantalla:** voseo argentino, frases de una línea, concreto, canchero pero no chistoso. Usar las frases aprobadas del brief. Prohibido: "plataforma", "SaaS", "IA", "solución integral", "ecosistema", "optimizá tu gestión", "Registrate", "Descargá la app".
7. **Restricciones de veracidad (muy importante):**
   - No inventar testimonios, clientes, logos de barberías, cifras de usuarios ni "más de X barberías".
   - Los recordatorios AUTOMÁTICOS por WhatsApp NO están disponibles (esperan aprobación de Meta): si aparecen, solo como "Próximamente". No confundir con los botones manuales de wa.me, que sí existen. Exportación de clientes tampoco existe. La seña por Mercado Pago no se muestra salvo que yo lo confirme.
   - La oferta del cierre la defino yo antes de renderizar (hoy conviven "10 días de prueba armada por nosotros, por WhatsApp" y "alta sola con 5 días de prueba"); dejala como texto parametrizable.
   - El único dato numérico permitido como argumento: "entre el 20% y el 30% de los turnos sin recordatorio no se presentan".
   - En los mockups usar datos de ejemplo verosímiles (nombres de barberos y clientes ficticios, precios en ARS), nunca datos reales.
   - Precios de planes: no mostrarlos, el foco es la demo gratis.
8. **Especificaciones técnicas:** 30 fps, resolución por versión, safe areas para Reels (texto lejos de bordes y de la UI de Instagram), subtítulos/texto legible en celular sin sonido, duración por escena parametrizable, componentes reutilizables (PhoneMockup, LaptopMockup, KineticTitle, Cursor, StatCounter), y una composición separada por versión.
9. **Proceso de trabajo para Opus:** primero proponer el storyboard y esperar mi OK, después construir, después renderizar un preview, después pulir. Que valide que no hay texto cortado, que el naranja no domina y que cada escena se entiende sin sonido.
10. **Formato de entrega esperado de Opus:** lista de archivos creados, storyboard final con tiempos y comandos de render.

## Cómo quiero tu respuesta

- El prompt final completo, en español rioplatense, dentro de un solo bloque de código para copiar fácil.
- Estructurado con títulos (Rol, Contexto, Objetivo, Storyboard, Estilo visual, Motion, Texto, Restricciones, Técnico, Proceso, Entregables).
- Específico y sin relleno: cada línea tiene que cambiar el resultado.
- Debajo del bloque, máximo 5 líneas con decisiones que tomaste y qué podría ajustar yo.
