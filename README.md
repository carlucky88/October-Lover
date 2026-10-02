# Octubre Juntos

31 días, 31 recuerdos. Un reto de octubre para pareja: cada día aparece un tema nuevo
(dibujo, escritura o foto/video), cada uno agrega su recuerdo y juntos van desbloqueando medallas.

Es una web app instalable (PWA): se abre desde Safari, se agrega a la pantalla de inicio del iPhone
y funciona como una app, también sin conexión. Con Supabase configurado, los dos teléfonos se sincronizan.

> `octubre-juntos.html` es el prototipo original. La app nueva empieza en `index.html`.

## Estructura

```
index.html              Estructura de la app
css/styles.css          Estilos (paleta verde olivo)
js/app.js               Interfaz, editor, medallas, sincronización
js/content.js           Temas diarios y medallas  ← aquí se edita el contenido
js/challenge.js         Fechas de octubre y reparto de temas
js/db.js                Almacenamiento local (IndexedDB)
js/cloud.js             Conexión con Supabase
js/config.js            Año del reto y credenciales de Supabase
sw.js                   Service worker (uso sin conexión)
supabase/schema.sql     Tablas, seguridad y almacenamiento en Supabase
```

## Probar en tu computadora

```bash
python3 -m http.server 5173
```

Abre <http://localhost:5173>. Para simular otra fecha agrega `?hoy=AAAA-MM-DD`,
por ejemplo <http://localhost:5173/?hoy=2026-10-05>.

## Activar la sincronización (Supabase, gratis)

1. Crea una cuenta y un proyecto en <https://supabase.com>.
2. **SQL Editor → New query**: pega todo `supabase/schema.sql` y presiona **Run**.
3. **Authentication → Emails → Templates → Magic Link**: agrega el código al cuerpo del correo
   para que llegue un código de 6 dígitos en lugar de solo un enlace. Por ejemplo:
   ```html
   <h2>Tu código para Octubre Juntos</h2>
   <p style="font-size:28px;letter-spacing:6px"><strong>{{ .Token }}</strong></p>
   ```
   (Se usa código y no enlace porque, en iPhone, el enlace abriría Safari y no la app instalada.)
4. **Project Settings → API**: copia la *Project URL* y la *anon public key* en `js/config.js`:
   ```js
   supabaseUrl: 'https://xxxx.supabase.co',
   supabaseAnonKey: 'eyJhbGciOi...',
   ```
   Estas dos claves son públicas por diseño. Los datos quedan protegidos por las reglas de
   seguridad (RLS) del esquema: solo los dos miembros de la pareja pueden ver sus recuerdos y archivos.

Después, en la app: **Ajustes → tu nombre → correo → código**. Uno de los dos toca
**Crear pareja** y comparte el código de 6 caracteres; el otro lo escribe en **Unirme**.

> El correo integrado de Supabase permite pocos envíos por hora. Para dos personas alcanza;
> si ves "Demasiados intentos", espera unos minutos.

## Publicarla (necesita HTTPS)

La opción más rápida es **Netlify Drop**: entra a <https://app.netlify.com/drop> y arrastra
la carpeta del proyecto. Te da una dirección `https://…netlify.app`. También sirven
GitHub Pages, Vercel o Cloudflare Pages: no hay que compilar nada.

Cada vez que publiques cambios, sube el número de `CACHE` en `sw.js` (`v1` → `v2`)
para que los teléfonos descarguen la versión nueva.

## Instalar en el iPhone

Abre la dirección en **Safari** → botón **Compartir** → **Agregar a inicio**.
Hazlo en ambos teléfonos.

## Cómo funciona

- **Temas.** El calendario reparte los 40 temas sin repetir y alternando tipos
  (dibujo → escritura → multimedia). Ambos ven los mismos temas porque se generan
  con la misma semilla de la pareja. "Otro tema" cambia el del día por otro del mismo tipo.
- **Días.** El día del reto sigue la fecha real. Los días futuros quedan como sorpresa;
  los días pasados sin recuerdo se pueden completar después.
- **Recuerdos.** Cada persona puede agregar uno o varios por día, con texto y una foto
  o video (máx. 30 s, 50 MB). Las fotos se reducen a 1800 px antes de guardarse.
- **Medallas.** Por tipo se cuentan los días completados con ese tipo de tema (2, 5, 7-8 y 10 días).
  Las medallas "Juntos" cuentan los días en que ambos agregaron un recuerdo.
  Al desbloquear una, aparece su frase.
- **Sin conexión.** Todo se guarda primero en el teléfono y se sube cuando hay internet.
  En Ajustes hay un respaldo descargable con todos los recuerdos, fotos y videos.

## Personalizar

- Temas y frases de las medallas: `js/content.js`. Agrega temas nuevos **al final** de la
  lista (el número de posición identifica cada tema en los recuerdos ya guardados).
- Año del reto: `year` en `js/config.js`.
