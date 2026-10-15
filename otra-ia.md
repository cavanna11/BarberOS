# Cómo trabajar en BarberOS

> Si sos una IA que acaba de abrir este proyecto: **leé este archivo entero
> antes de tocar nada, y después leé `CLAUDE.md`.**
>
> Este archivo dice **cómo se trabaja acá**. `CLAUDE.md` dice **qué es el
> sistema y por qué cada cosa está como está**. Los dos están al día y los dos
> importan; este es más corto a propósito.

---

## Lo primero: esto está en producción, con clientes reales

`barberos.sacia.tech` lo usan barberías de verdad, hoy, para tomar turnos.
Cuando algo se rompe, un cliente no reserva y el barbero no se entera. No es un
proyecto de práctica.

De ahí sale todo lo demás que dice este archivo.

---

## Las cinco reglas que no se discuten

1. **Ningún componente habla con Firestore directo.** Todo pasa por
   `src/lib/repository.js`. Si necesitás leer o escribir algo, agregá la
   función ahí.
2. **Las suscripciones viven solo en `src/contexts/BusinessSync.jsx`.** Un
   `onSnapshot` suelto en un componente hace que el mismo documento se cobre
   una vez por componente montado.
3. **No toques `availabilityEngine.js` ni `statsCalculator.js`** salvo que no
   haya otra forma. Hay tres excepciones hechas y las tres están documentadas en
   `CLAUDE.md` con su motivo. Si hacés una cuarta, documentala igual.
4. **El filtro del frontend NO es seguridad.** Lo que aísla una barbería de otra
   son las Security Rules y los custom claims. Esconder un botón no protege
   nada: con la consola abierta se saltea.
5. **No inventes.** Ni nombres de archivos, ni estructuras, ni funciones que
   "deberían existir". Leé el código antes. En este proyecto hay varias cosas a
   medio construir que parecen terminadas (ver abajo).

---

## El modelo de permisos, en tres frases

- Los **custom claims** son la única fuente de permiso. Los escribe solo el
  Admin SDK desde Cloud Functions. Sin claims, sos cliente.
- Las **Firestore Rules** los verifican en cada lectura y escritura.
- El **frontend solo esconde**. Nunca lo presentes como protección.

Los roles son `owner` (dueño), `admin` (peluquero: solo SUS turnos), `cajero`
(mostrador: toda la agenda, sin los números del negocio), más `platform` y
`platform: 'moderator'` para el equipo de la plataforma.

**Si agregás un rol o una capacidad, se toca en TRES lugares** y hay que tocar
los tres o queda incoherente: `src/config/plans.js` (lo que muestra la
interfaz), `firestore.rules` (lo que la base acepta) y `functions/planes.js` (lo
que validan las Functions).

**No dupliques lógica de permisos.** Si ya existe una función que otorga acceso
(`setBusinessAdmin`), llamala; no copies su contenido adentro de otra para
ahorrarte una llamada. Ahí viven chequeos que no son obvios —el `email_verified`,
el que impide que un dueño le pise los claims a la plataforma— y una copia se
separa del original en el primer cambio.

---

## Lo que más daño hace acá: las fallas mudas

Es **el patrón de bug recurrente de este proyecto**. Vale más que cualquier otra
cosa en este archivo:

> Algo no funciona, y la pantalla no dice nada.

Casos reales, todos de producción:

- Un barbero sin permisos entraba con Google perfecto, el sistema lo trataba
  como cliente y lo mandaba a reservar un turno. Sin error. Los clientes
  reservaban y la barbería no se enteraba.
- Un mail cargado con una palabra de menos dejó a un dueño sin acceso durante
  días. No hay ningún error posible: el permiso queda anotado bajo una dirección
  que no existe.
- Un barbero con el vínculo roto veía la agenda **vacía**, sin un solo mensaje.
- Alguien entraba a `/admin` sin permiso y aparecía en la landing de venta.

**Entonces, cuando escribas código acá:**

- Si una acción no se puede hacer, **decilo en pantalla, con el motivo y qué
  hacer**. Un `catch` vacío o un redirect silencioso es un bug, aunque el código
  "funcione".
- Si algo se esconde, que haya una razón visible. Lo bloqueado por plan **no se
  esconde**: se muestra apagado, con desde qué plan está.
- Preferí fallar **cerrado y ruidoso** antes que abierto y mudo.

---

## Antes de decir que algo está listo

**No alcanza con que compile.** El orden es:

```bash
npm run build          # compila
npx eslint src/        # 3 errores conocidos en los contexts: esos están bien
```

Y después, según lo que tocaste:

```bash
# Sin emulador (son funciones puras, corren solas)
node scripts/test-intervalo.mjs
node scripts/test-ausencias.mjs
node scripts/test-orden.mjs
node scripts/test-whatsapp.mjs
node scripts/test-preview.mjs

# Con emulador
firebase emulators:start --only auth,firestore,functions
node scripts/auditar-rules-emulador.mjs     # aislamiento entre barberías
node scripts/test-claims-emulador.mjs       # permisos
node scripts/test-reservas-emulador.mjs     # validación de turnos
# …y las demás que lista CLAUDE.md
```

**Si tocaste Rules, Functions o permisos, correr las suites no es opcional.**
Son el contrato de seguridad del sistema escrito en casos.

**Y agregá casos nuevos** para lo que agregaste. La suite de Rules tiene una
proporción deliberada: por cada cosa que un rol SÍ puede, hay varias de lo que
NO puede. Esas son las que importan.

---

## Desplegar: la parte que rompe producción

```
Frontend  → Vercel lo despliega SOLO con cada push a `main`.
Rules     → NO se despliegan solas.  firebase deploy --only firestore:rules
Functions → NO se despliegan solas.  firebase deploy --only functions:<nombre>
```

**Esto ya rompió producción.** Si pusheás un frontend que usa una regla o una
function nueva y no las desplegás, el usuario recibe *permission denied* o un
error de la función. Después de un push que toca el servidor, desplegá.

Tres cosas que vas a necesitar saber:

- **La carpeta está anidada: `codesSYNC/BarberOS/BarberOS`.** `firebase.json`
  vive en la de adentro. Corrido desde la de afuera, cualquier deploy falla con
  *"Not in a Firebase app directory"*. Verificá con `ls firebase.json`.
- El deploy de Functions falla seguido en Windows con *"Cannot determine backend
  specification. Timeout after 10000"*. Es un flake. Se arregla con
  `FUNCTIONS_DISCOVERY_TIMEOUT=120 firebase deploy ...`.
- **Vite congela las variables `VITE_*` al compilar.** Cambiarlas en Vercel no
  hace nada sin un build nuevo.

---

## Verificá contra producción, no contra tu cabeza

Hay recetas listas en `CLAUDE.md` (sección "Verificación rápida sin abrir el
navegador"). La clave API es pública por diseño.

```bash
# Qué está realmente desplegado
B=$(curl -s https://barberos.sacia.tech/ | grep -o '/assets/index-[A-Za-z0-9_-]*\.js' | head -1)
curl -s "https://barberos.sacia.tech$B" | grep -c "TEXTO_A_BUSCAR"

# Las Rules, sin sesión: 404 = la regla permitió (el doc no existe) | 403 = denegó
```

Decir "debería andar" cuando se puede comprobar en treinta segundos es la forma
más barata de perder una tarde.

---

## Cosas que parecen terminadas y no lo están

Antes de usar un campo que ves en el modelo, **chequeá que alguien lo escriba y
alguien lo lea**. Este proyecto tiene varias piezas a medio construir:

- `customDuration` / `customPrice` en el vínculo barbero–servicio: existen, el
  motor del cliente los respeta, **pero no hay dónde cargarlos y
  `createAppointment` los ignora**. Si se cargaran a mano hoy, la grilla y el
  servidor usarían duraciones distintas.
- `displayOrder` estuvo así durante meses: se escribía al crear, y solo una de
  las cuatro pantallas lo miraba.

El patrón es siempre el mismo: **el dato existe, pero el circuito está cortado
en algún punto.** Seguilo entero antes de construir encima.

---

## Trampas técnicas que vas a pisar

Están todas en `CLAUDE.md` con detalle. Las que más aparecen:

- **Firestore reintenta el callback de una transacción.** Todo estado mutable
  declarado afuera tiene que volver a cero al principio de cada intento. Esto ya
  causó turnos guardados con precio de promoción sin consumir el cupón.
- **Los turnos guardan la fecha en `appointmentDate`, no en `date`.**
- **`new Date().toISOString()` es UTC.** A partir de las 21:00 en Argentina ya
  es mañana. Para fechas locales, `toDateString()` de `dateUtils`.
- **Los Timestamps de Firestore no son fechas de JS**: es `.toDate()`.
- **En las Functions, nunca `admin.firestore.FieldValue`**: usá los submódulos
  (`require('firebase-admin/firestore')`). Con el emulador llega `undefined` y
  revienta en runtime.
- **Dos `match` sobre la misma ruta en las Rules se SUMAN**: si cualquiera
  permite, pasa.
- **En las suites de Rules, un 404 cuenta como denegado.** Para probar lectura o
  borrado hay que sembrar el documento con el Admin SDK primero.
- **Las fechas de prueba tienen que caer en el día de la semana que el barbero
  trabaja**, o la prueba falla por "no trabaja ese día" y parece otro bug.
- **Varios archivos tienen finales de línea Windows (CRLF).** Los reemplazos por
  script fallan en silencio: verificá siempre el resultado.

---

## Cómo se escribe el código acá

El proyecto tiene una voz y conviene mantenerla.

- **Los comentarios explican el PORQUÉ, no el qué.** `// suma 1 al contador` no
  sirve. `// Se cuenta adentro de la transacción: afuera, dos clientes leen el
  mismo contador y pasan los dos` sí.
- Cuando arregles un bug, **dejá escrito qué pasaba**. Buena parte del valor de
  este código está en los comentarios que impiden volver a romperlo.
- **Español rioplatense** (vos, no tú), en comentarios y en la interfaz.
- Nombres en español cuando son del dominio (`ausencias`, `intervalo`,
  `cupones`); en inglés lo que ya estaba así (`appointments`, `professionals`).
- **Mobile-first, y en serio.** El panel se usa en el celular. Verificá a 375 px
  sin desborde horizontal. Medí (`scrollWidth` contra `clientWidth`), no mires
  una captura y supongas.

---

## Qué NO hacer

- ❌ Commitear `.env` ni `serviceAccountKey.json`.
- ❌ Leer Firestore desde un componente.
- ❌ Abrir `onSnapshot` fuera de `BusinessSync`.
- ❌ Presentar el filtro del frontend como aislamiento de seguridad.
- ❌ Inventar testimonios, logos de clientes o métricas en la landing: todavía
  no hay clientes para mostrar.
- ❌ Usar violeta ni azul. La paleta es naranja `#e03d00` sobre casi-blanco, y
  sale de las variables CSS en `:root` de `src/index.css` — se cambia ahí, no en
  los componentes.
- ❌ Construir un checkout de suscripción. El cobro a las barberías es a mano.
- ❌ Correr `firebase init` (es interactivo y reescribe la configuración) ni
  `firebase login` (necesita un humano).

---

## Cómo contestarle a Santiago

Es el dueño del producto y conoce a sus clientes mucho mejor que vos. Varias
veces en este proyecto tuvo razón contra lo que decía el código.

- **Si te corrige, chequealo antes de defenderte.** Y si tiene razón, decilo y
  seguí.
- **Separá lo que verificaste de lo que suponés.** "Lo probé contra el emulador
  y pasa" y "debería andar" son cosas distintas y hay que decir cuál es.
- **Si algo quedó sin terminar o sin probar, decilo.** Especialmente si lo
  vas a pushear igual.
- **Cuando algo toque permisos, plata o producción, mostrá el plan antes de
  construir.** Lo urgente también: cinco líneas de plan ahorran una tarde.
- No le expliques lo que ya sabe. Es técnico.

---

## Lo que queda pendiente

Está en `CLAUDE.md`, en "Próximos pasos, en orden". Si vas a empezar algo
grande, mirá primero si ya está anotado ahí y por qué no se hizo todavía:
muchas veces la razón sigue vigente.
