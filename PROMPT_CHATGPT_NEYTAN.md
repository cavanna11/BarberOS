# Neytan Barber 777 — briefing para armar el prompt de diseño

> **Para qué es este archivo.** Santiago le cobró aparte a esta barbería un
> trabajo de diseño sobre su página de reserva. Esto es todo lo que se sabe de
> la cuenta (verificado contra la base de producción el 12/10/2026), más la
> recomendación técnica. Va a ChatGPT junto con el **logo** de la barbería para
> que saque la paleta y devuelva un prompt concreto, que después se ejecuta en
> el repo.
>
> Nada de acá está inventado: los datos salen de Firestore y de Firebase Auth.
> Lo que no se sabe está marcado como **A COMPLETAR**.

---

## 1. La cuenta, tal como está hoy

| | |
|---|---|
| Nombre | **Neytan barber 777** |
| Link público | `https://barberos.sacia.tech/neytanbarber777` |
| Ciudad | Santa Teresita (provincia de Buenos Aires, la costa) |
| Dirección | **vacía** — no cargó la calle. Sin eso no hay botón "Cómo llegar" |
| Teléfono / WhatsApp | `+54 9 11 2517-1800` |
| Instagram | `@neyttan_barber777` |
| Presentación actual | *"Reservá tu turno en segundos"* (genérica, de relleno) |
| Logo | **no cargó ninguno** |
| Dueño | `neyttanbarber94@gmail.com`, entra con Google |
| Creada | 09/10/2026 |
| Plan | **Básico** ($15.000/mes), sin deuda, activa |

**El equipo y el catálogo** (cargados el 12/10):

- 1 barbero: **Neytan**. Es el dueño y el único que atiende.
- 1 servicio: **Corte de pelo — $20.000 — 30 minutos**.
- Horario: lunes a viernes 09:00–20:00, sábados 09:00–18:00, domingos cerrado.
- Cancelación: hasta 2 horas antes. Grilla de turnos cada 30 minutos.

**Colores que tiene guardados hoy** (y que NO se ven en ningún lado, ver §2):

| | |
|---|---|
| Primario | `#3ce000` — verde neón |
| Secundario | `#000000` — negro |
| Acento | `#04ff00` — verde más neón todavía |

⚠️ **Estos tres colores hay que revisarlos contra el logo.** Parecen elegidos a
ojo. El verde `#3ce000` es muy luminoso: sobre él **el texto tiene que ir en
negro**, no en blanco (con blanco el contraste da 1.6:1, ilegible). El sistema
ya lo calcula solo, pero conviene saberlo al elegir la paleta definitiva.

**A COMPLETAR por Santiago:**

- La dirección exacta del local.
- Qué le prometió concretamente al barbero y por cuánto.
- Si va a cargar más servicios (barba, color, niños) o se queda con uno solo.
- Si tiene fotos de sus trabajos, y cuántas.

---

## 2. El dato más importante: ya tiene comprado lo que quiere, apagado

BarberOS habilita funciones por plan, y esa habilitación se hace cumplir en la
base de datos, no en la interfaz. **Neytan está en Plan Básico, que las tiene
todas apagadas:**

```
fotoPerfil: false     la foto del barbero en la reserva
pagina:     false     su página de presentación antes de la reserva
paginaFoto: false     la plantilla con foto de portada a pantalla completa
colores:    false     sus colores propios
logo:       false     su logo propio
```

Por eso su verde está guardado y el cliente que abre el link ve el naranja de
BarberOS. No es un bug: es el candado del plan funcionando.

**Entonces, buena parte de lo que pagó NO es código: es prenderle las
funciones.** En el panel global eso se hace cambiándolo de plan, o —si el trato
fue "paga aparte y se queda en Básico"— con el **Plan Personalizado**, que
permite escribirle las capacidades una por una sin tocarle el abono.

Con eso prendido y sin escribir una línea de código, Neytan pasa a tener:

1. **Su página de presentación** en `/neytanbarber777`: nombre, logo, una línea
   de presentación, y botones grandes para *Reservar*, *Servicios y precios*,
   *Cómo llegar*, *WhatsApp*, *Instagram*. Tres plantillas para elegir
   (**Simple**, **Tarjeta**, **Con foto de portada**). El flujo de reserva queda
   intacto, en `/neytanbarber777/reservar`.
2. **Sus colores en todo lo que ve el cliente**: la página, los 6 pasos de la
   reserva, la confirmación, "Mis turnos" y el encabezado.
3. **Su logo** arriba del link.
4. **Una foto de portada** a pantalla completa.
5. **Su foto** como barbero en el paso de elegir profesional.

---

## 3. Lo que de verdad NO existe, y es donde conviene gastar la plata

Esto es lo que el producto hoy **no tiene** y lo que un barbero pide cuando dice
"quiero que se me conozca un poco más":

### 3.1 Galería de trabajos ← la más importante

No hay forma de mostrar fotos de cortes en ningún lado. Para un barbero es *la*
prueba social: antes del precio y antes del horario, el cliente quiere ver cómo
corta. Hoy solo se puede poner una foto de portada y la foto de perfil.

**Restricción técnica que condiciona el diseño:** BarberOS **no usa Firebase
Storage** por decisión de arquitectura. Las imágenes van como `data URL` adentro
del documento de Firestore, que tiene un tope duro de **1 MB**. Hoy: logo ≤250 KB,
portada ≤400 KB. Una galería entra en el documento aparte de la página
(`businesses/{id}/public/pagina`), así que realistamente son **4 a 6 fotos de
~120 KB cada una**, cuadradas y comprimidas en el navegador antes de subir.

Si se quieren 20 fotos, hay que meter Firebase Storage, y eso es otro proyecto
(reglas nuevas, costo nuevo, borrado en cascada). **Recomendación: 6 fotos, en
una grilla, y listo.**

### 3.2 "Sobre mí" de verdad

Hoy la presentación es una línea (`welcomeMessage`) y en la página hay un título
(≤60 caracteres) y una bajada (≤160). Para "que se lo conozca" hace falta un
bloque de texto más largo: cuántos años hace que corta, qué estilo, por qué.

### 3.3 Reseñas a la vista

El sistema de reseñas ya existe y funciona, pero las estrellas **solo se ven en
el panel del dueño**. Mostrar el promedio y dos o tres comentarios en la página
es barato y es exactamente lo que convence a alguien que no lo conoce.

---

## 4. Lo que NO recomiendo hacer

**El panel del barbero con sus colores.** Se puede —la maquinaria ya está— pero
no lo gastaría:

- El panel lo ve **él solo**. Sus clientes no entran nunca ahí.
- Es una herramienta de trabajo, no una vitrina. Que se parezca al de todas las
  barberías es bueno: cuando pida soporte, lo que ve él y lo que ve Santiago es
  lo mismo.
- Esa misma plata, puesta en la galería de trabajos, la ven todos los que abren
  el link.

Si igual lo quiere, es una capacidad más (`panelConSuMarca`) y se hace en un
rato. Pero que sea una decisión, no un arrastre del pedido original.

**Y lo que no hay que hacer bajo ningún concepto: una página a medida para esta
barbería.** BarberOS es multi-tenant. Un diseño hecho a mano para un cliente es
código que después nadie mantiene, que no se puede vender dos veces y que se
rompe en el próximo cambio del producto. **Todo lo que salga de acá tiene que
ser una plantilla o una capacidad que cualquier barbería pueda tener.** Lo que
hace que la de Neytan se vea distinta son sus datos, sus colores y sus fotos, no
su código.

---

## 5. Restricciones que el diseño TIENE que respetar

Esto es lo que ChatGPT tiene que tener a la vista para no proponer algo
inconstruible:

1. **Es un sistema de plantillas, no un sitio.** El diseño se define con
   variables (colores, tipografía, espaciado), no con un layout único.
2. **La barbería elige SOLO dos colores**: primario y secundario. Los fondos, el
   texto, los bordes y los estados (éxito, error) son del producto y no se
   tocan. Dejar elegir el color del texto *y* el del fondo es la forma más
   rápida de que alguien arme una página ilegible.
3. **El color del texto sobre los botones se calcula**, no se elige: luminancia
   relativa de WCAG, corte en 0.179. Con el verde de Neytan da **texto negro**.
4. **Un tenant SÍ puede usar cualquier color.** La regla de "nada de violeta ni
   azul" es de la marca BarberOS, no de las barberías.
5. **Mobile primero, 375 px.** Este link se abre desde la bio de Instagram. Si
   se ve bien en el celular y aceptable en escritorio, está bien. Al revés, no.
6. **El flujo de reserva no se toca.** Son 6 pasos (profesional → servicio →
   fecha → hora → datos → confirmar), están validados en el servidor y es lo
   único que de verdad no puede fallar. Se puede repintar; no se puede
   reordenar.
7. **Un dato, un lugar.** El nombre, la dirección, el Instagram, el WhatsApp y
   los servicios ya están cargados en Configuración: la página los lee de ahí.
   Nada de pedirle al barbero que escriba su dirección otra vez.
8. **Sin Firebase Storage**: ver §3.1 para los límites reales de imágenes.
9. La paleta base del producto es naranja `#e03d00` sobre casi-blanco
   `#fafafa`, tipografías **Space Grotesk** (títulos) y **Space Mono**
   (etiquetas en mayúscula), esquinas de 8 px. Un tenant pisa los colores; la
   tipografía y el espaciado son del producto.

---

## 6. Lo que le pido a ChatGPT que devuelva

Con el **logo de Neytan Barber 777** adjunto, devolver:

### 6.1 Paleta

- `primaryColor` y `secondaryColor` en hex, sacados del logo. **Solo dos.**
- Para el primario: el contraste contra blanco y contra negro, y cuál de los dos
  gana. (Si el primario termina siendo un verde muy luminoso como el que tiene
  hoy, decirlo explícitamente.)
- Si el logo es monocromo o no da para una paleta, decirlo y proponer una
  alternativa — no inventar colores que no están.

### 6.2 Plantilla

Elegir una de las tres que existen y justificar en dos líneas:

- **Simple** — fondo liso, nombre grande, botones en columna.
- **Tarjeta** — todo dentro de una tarjeta centrada.
- **Con foto de portada** — foto a pantalla completa de fondo, botones encima
  con vidrio esmerilado y un velo oscuro para que se lea el texto.

### 6.3 Textos, escritos y listos para pegar

- **Título** de la página (≤60 caracteres).
- **Bajada** (≤160 caracteres).
- **Presentación** / "sobre mí" (3 a 5 líneas), en español rioplatense, simple,
  sin publicidad inflada. Hoy dice *"Reservá tu turno en segundos"*, que no dice
  nada de él.
- Los textos de los botones libres, si conviene agregar alguno.

### 6.4 Las fotos que hay que pedirle a Neytan

Lista concreta: cuántas, de qué (cortes terminados, el local, él trabajando),
en qué proporción (cuadradas / apaisadas) y para qué va cada una.

### 6.5 Qué construir, en orden, con un porqué

Separado en dos columnas:

- **Configuración** (prender capacidades, cargar datos y fotos) — sin código.
- **Código** (galería, "sobre mí", reseñas en la página) — cada uno pensado
  **como capacidad del producto**, no como algo de Neytan.

---

## 7. Lo que NO quiero que ChatGPT haga

- Proponer un sitio a medida, una landing aparte o un dominio propio.
- Inventar funciones que no están en este documento (turnos por WhatsApp
  automáticos, pagos nuevos, fidelización, un constructor de páginas).
- Inventar datos de la barbería: si falta algo, que lo marque como faltante.
- Devolver una paleta de 10 colores, o un sistema de diseño entero. Son dos
  colores y una plantilla.
- Escribir código. Lo que tiene que devolver es **el prompt y las decisiones**;
  el código se escribe después, en el repo, con el contexto completo.

---

## 8. Resumen en una línea

> El 80% de lo que Neytan pagó se resuelve **prendiéndole las capacidades que ya
> existen y cargándole bien los datos y las fotos**. El 20% que falta —y que
> justifica el trabajo— es la **galería de trabajos** y un **"sobre mí"** de
> verdad, construidos como funciones del producto para que la próxima barbería
> que las pida ya las tenga.
