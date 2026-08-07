# Prompt para IA de diseño — Landing SaciaTurno

> Copiá todo este documento como contexto inicial a la IA de diseño (v0, Lovable, Bolt, Figma Make, etc.). Incluye briefing, identidad visual, estructura de secciones y referencias.

---

## 1. Contexto del producto

**SaciaTurno** es un SaaS para barberías, peluquerías, salones de estética y negocios de servicios con turno. Permite que el dueño:
- Reciba reservas online sin tener que contestar WhatsApp todo el día
- Envíe recordatorios automáticos que reducen inasistencias
- Cobre seña antes del turno (Mercado Pago)
- Vea estadísticas de ingresos, servicios más vendidos, horarios pico

Cada barbería tiene su propia URL (`saciaturno.com/barberia-carlos`), su logo, sus colores. El cliente final reserva sin descargar nada.

**Mercado objetivo:** Argentina y LATAM. Barberos jóvenes, peluqueros, dueños de salón. Edad 22-45. Usan más el celular que la compu. No son técnicos.

**Competencia (para diferenciarse):** Booksy, Fresha, AgendaPro. La nuestra gana en: precio en pesos, soporte en español, integración con WhatsApp y Mercado Pago locales.

---

## 2. Identidad visual SACIA

**Paleta principal (obligatoria):**
- Fondo oscuro: `#0A1628` (deep navy)
- Acento cyan: `#00C8FF` (highlight, CTAs, números)
- Texto blanco: `#FFFFFF`
- Texto secundario: `#B8C5D6`
- Cards/bloques: `#142339`

**Paleta complementaria (acentos):**
- Success: `#00E676` (verde WhatsApp/check)
- Warning: `#FFB347` (amarillo Mercado Pago)
- Danger: `#FF5C7C` (rojo cancelaciones, opcional)

**Tipografía:**
- Headlines: sans-serif moderna, bold (Inter, Geist, Satoshi, o similar)
- Body: misma familia, regular
- Mono (opcional, para URLs/código): JetBrains Mono o similar

**Logo:** El logotipo es "SACIA" donde "SAC" va en blanco y "IA" en cyan `#00C8FF`. La marca del producto es "**SaciaTurno**" — escrita con la misma lógica de color o íntegra en blanco con punto cyan.

**Estilo general:** Tech-forward pero cálido. Dark mode primario. Glassmorphism sutil. Bordes sutiles `1px` con opacidad baja. Sombras suaves cyan en hover. NADA de gradientes morados/rosados ni vibras "AI generic".

---

## 3. Estructura de la landing (orden obligatorio)

### A. NAV
Logo SaciaTurno a la izquierda. Links: `Cómo funciona`, `Precios`, `FAQ`. CTA a la derecha: **"Probar gratis"** (botón cyan, texto navy). Mobile: hamburguesa.

### B. HERO (above the fold)
- **Headline (h1, grande, bold):** "El sistema de turnos que tu barbería necesitaba ayer"
- **Subhead (1 línea):** "Reservas online, recordatorios por WhatsApp y cobro de seña. Sin instalar nada."
- **CTAs (dos botones lado a lado):**
  1. Primario cyan: **"Empezá gratis · 14 días"**
  2. Secundario outline: **"Ver demo en vivo"**
- **Visual a la derecha (o debajo en mobile):** mockup de un iPhone mostrando el flujo de reserva del cliente (3 pantallas en cascada: selección de barbero → elegir horario → confirmación con WhatsApp llegando). Fondo con sutil glow cyan detrás del teléfono.
- **Trust strip debajo:** "Más de 50 barberías ya lo usan" + 3-4 logos placeholder (o iconos de profesiones: barbero, peluquera, manicura).

### C. PROBLEMA (sección "Te suena familiar?")
Tres columnas con icono, título corto y descripción de 1 línea. Estilo: cards oscuras con borde sutil. Tono: empático, no acusatorio.
1. 📱 **Contestás WhatsApp hasta a la madrugada** — "Cada turno son 6 mensajes. Multiplicalo por 50 clientes."
2. 👻 **Te dejan plantado** — "1 de cada 4 clientes no se presenta. Hora perdida = plata perdida."
3. 📒 **Llevás la agenda en papel** — "Un cliente cancela y nadie se entera. Otro no encuentra horario libre."

### D. SOLUCIÓN — "Cómo funciona" (3 pasos)
Timeline horizontal (vertical en mobile) con 3 pasos numerados. Cada paso: número grande cyan + título + descripción + screenshot pequeño.
1. **Configurá tu barbería** — "Servicios, horarios, profesionales. 10 minutos."
2. **Compartí tu link** — "saciaturno.com/tu-barberia. En tu Instagram, WhatsApp, tarjeta."
3. **Recibí reservas mientras dormís** — "Tu cliente reserva, paga la seña, recibe recordatorio. Vos solo cortás pelo."

### E. FEATURES (la carne del producto)
Grid 2x3 o 3x2 de cards. Cada card: icono grande cyan, título, descripción de 2 líneas. Hover: glow cyan sutil.
- 🟢 **Recordatorios por WhatsApp** — "24h y 2h antes del turno. Reducen las inasistencias hasta 60%."
- 💳 **Seña con Mercado Pago** — "Cobrá un % antes del turno. Si no paga, el horario se libera."
- 🎨 **Tu barbería, tu marca** — "Tu logo, tus colores. El cliente ve tu marca, no la nuestra."
- 👥 **Multi-profesional** — "Cada barbero con su agenda y sus servicios."
- 📊 **Reportes que sirven** — "Ingresos, top clientes, servicio más vendido."
- 📱 **Funciona en cualquier celular** — "PWA instalable. No bajás nada."

### F. DEMO VISUAL (sección "Mirá cómo se ve")
Tabs o carrusel con 4 capturas grandes:
1. Vista del cliente reservando turno (mobile)
2. Mensaje de WhatsApp que recibe el cliente
3. Dashboard del barbero con estadísticas (desktop)
4. Calendario del día con turnos pagos vs sin pagar

### G. PRECIOS (3 cards, la del medio destacada)
| BÁSICO | PRO ⭐ | BUSINESS |
|--------|-------|----------|
| USD 20/mes | USD 40/mes | USD 100/mes |
| 1 profesional | Profesionales ilimitados | Todo lo de Pro |
| Reservas online | + WhatsApp + Mercado Pago | + Multi-sucursal |
| Recordatorios por email | + White-label completo | + Dominio propio |
| Hasta 100 turnos/mes | + Reportes avanzados | + Soporte dedicado |

CTA en cada card: "Empezar". Card del medio (Pro) con borde cyan y badge "RECOMENDADO".

Debajo: "Setup único USD 100. Cancelás cuando quieras. Sin tarjeta para la prueba gratis."

### H. TESTIMONIOS (placeholder al inicio, real después)
3 cards con foto circular, nombre, barbería, ciudad, quote corta. Ejemplo:
> "Pasé de contestar WhatsApp hasta las 11pm a tener la agenda llena sin tocar el celu."
> **Carlos M.** · Barbería Sacia · Buenos Aires

### I. FAQ (acordeón)
- ¿Necesito tarjeta de crédito para probar?
- ¿Mis clientes tienen que descargar una app?
- ¿Cómo cobro la seña?
- ¿Qué pasa si cambio de opinión?
- ¿Funciona en mi celular viejo?
- ¿Puedo importar mis clientes actuales?

### J. CTA FINAL (sección oscura con glow)
- Headline grande: "Tu próxima reserva empieza ahora"
- Subhead: "14 días gratis. Sin tarjeta. Sin compromiso."
- Botón cyan grande: **"Crear mi barbería"**

### K. FOOTER
- Columna 1: Logo + tagline corto + redes
- Columna 2: Producto (Features, Precios, FAQ)
- Columna 3: Empresa (Sobre SACIA, Blog, Contacto)
- Columna 4: Legal (Términos, Privacidad)
- Línea inferior: "© 2026 SACIA · Hecho en Argentina"

---

## 4. Mockups e imágenes (qué generar/buscar)

**Obligatorios (mockups de producto):**
- iPhone mostrando flujo de reserva (3-4 pantallas)
- Pantalla de WhatsApp con el recordatorio (formato chat real)
- Dashboard del barbero en laptop
- Captura del calendario semanal con turnos

**Fotografía (estilo):**
- Barberías reales argentinas (evitar stock yanqui)
- Personas reales, no modelos perfectos
- Luz natural, ambiente cálido
- Si no hay presupuesto: ilustraciones planas con paleta SACIA

**Iconografía:**
- Estilo line-icons o duotone (cyan + blanco)
- Lucide React, Phosphor, o Heroicons funcionan
- NO emojis genéricos como decoración principal

**Patterns/decoración:**
- Grid sutil de puntos cyan en backgrounds (5% opacidad)
- Glow cyan radial detrás de elementos hero
- Líneas finas conectando secciones (opcional)

---

## 5. Copywriting — tono y reglas

**Idioma:** Español argentino, voseo natural ("reservá", "tenés", "podés").

**Tono:** Directo, sin marketing exagerado. Hablar como un amigo que sabe del tema, no como brochure corporativo.

**Reglas:**
- Headlines en máximo 8 palabras
- Subheads en máximo 15 palabras
- Cada feature explicada en 2 líneas
- Usar números concretos ("60% menos inasistencias", no "muchas menos inasistencias")
- Verbos en acción ("Recibí", "Cobrá", "Compartí")
- Sin jerga técnica visible (nada de "SaaS multi-tenant" en la landing)

**Lo que NO decir:**
- "Revolucioná tu negocio"
- "La solución definitiva"
- "Powered by AI" (aunque lo esté)
- "Disrupción"
- Cualquier inglesismo evitable

---

## 6. UX rules

- **Mobile-first.** El 70% de los barberos van a entrar desde el celu.
- **CTA siempre visible.** Botón "Probar gratis" fijo en nav scrolleable.
- **Carga rápida.** Sin videos auto-play. Imágenes optimizadas. Lazy loading.
- **Sin formularios largos.** El signup es: email + nombre de barbería + slug auto-generado.
- **Hover states cyan.** Botones, links, cards.
- **Animaciones sutiles.** Fade-in en scroll, hover lifts. NADA de animaciones que distraigan.

---

## 7. Stack técnico (para que el output sea usable)

- **React + Vite** (mismo stack del producto principal)
- **Tailwind CSS** (NO CSS modules, NO styled-components)
- **lucide-react** para iconos
- **framer-motion** opcional para animaciones de entrada
- **shadcn/ui** opcional para componentes base (button, card, accordion para FAQ)
- Una sola página: `index.html` + `App.jsx` + componentes en `src/components/landing/`

---

## 8. Entregable esperado

Una landing single-page lista para deployar en Vercel/Netlify/Firebase Hosting. Código limpio, componentes separados por sección, responsive completo, paleta SACIA aplicada consistentemente, copy en español argentino.

**Bonus si podés:** modo dark/light toggle (default dark), micro-interacciones en CTAs, score Lighthouse 90+.

---

## 9. Inspiración de referencia

Estilo y vibe a buscar:
- linear.app (dark mode + cyan accents + tipografía limpia)
- raycast.com (hero con producto mostrado, copy directo)
- cal.com (es competencia tangencial, ver cómo presentan booking)
- vercel.com (dark mode + microinteracciones)

**NO copiar:** colores morados/violetas (cliché AI), gradientes saturados, ilustraciones 3D blob.

---

**Resumen en una línea:** Landing dark mode con acentos cyan, hero con mockup de iPhone, problema/solución/features/pricing/FAQ, copy directo en español argentino, mobile-first, deployable en React + Tailwind.
