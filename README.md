# Strim · Backend

Backend de **Strim**, una app de streaming minimalista: un usuario transmite desde OBS, los espectadores ven el video en el navegador y comentan en un chat en vivo. Solo los usuarios con sesión iniciada pueden comentar.

Este backend incluye la **API REST**, el **chat en tiempo real** (Socket.IO), la **autenticación** con Supabase (registro con código OTP por correo) y el **control de las transmisiones** con MediaMTX en Docker.

La especificación con la que se construyó está en [`specs/`](specs/): [requerimientos](specs/requirements.md), [diseño](specs/design.md) y [tareas](specs/tasks.md).

## Contenido

1. [Qué hace](#1-qué-hace)
2. [Stack](#2-stack)
3. [Arquitectura](#3-arquitectura)
4. [Estructura del código (MVC)](#4-estructura-del-código-mvc)
5. [Base de datos](#5-base-de-datos)
6. [Autenticación con Supabase](#6-autenticación-con-supabase)
7. [Instalación y puesta en marcha](#7-instalación-y-puesta-en-marcha)
8. [MediaMTX: cómo se usa](#8-mediamtx-cómo-se-usa)
9. [API REST](#9-api-rest)
10. [Chat en tiempo real (Socket.IO)](#10-chat-en-tiempo-real-socketio)
11. [Errores](#11-errores)
12. [Seguridad](#12-seguridad)
13. [Scripts](#13-scripts)
14. [Pruebas](#14-pruebas)
15. [Problemas comunes](#15-problemas-comunes)

---

## 1. Qué hace

**Cuentas**
- Registro con correo, username y contraseña. Supabase envía al correo un **código OTP** de 6 dígitos para verificar la cuenta.
- Verificación del correo con el código, y reenvío del código (con 60 s de espera mínima entre envíos).
- Login, renovación de tokens (refresh) y cierre de sesión.
- Recuperación de contraseña con un código OTP enviado por correo.

**Perfil**
- Ver y editar nombre visible, bio y username.
- Subir un avatar (JPG, PNG o WebP de hasta 2 MB), que se guarda en Supabase Storage.
- Cambiar la contraseña confirmando la actual.
- Borrar la cuenta confirmando la contraseña. Se borran en cascada el perfil, el canal, los mensajes y el avatar.

**Streaming**
- Cada usuario tiene un canal con una **stream key** secreta.
- Dashboard con los datos para OBS (servidor y clave), botones para iniciar y finalizar el stream, cambio de título y regeneración de la clave.
- **MediaMTX** recibe la señal RTMP de OBS y la sirve en HLS para los navegadores. Antes de aceptar una señal, le pregunta al backend si la clave es correcta y el canal está iniciado.
- Un **monitor** consulta a MediaMTX cada 3 s y pasa el canal a "en vivo" cuando llega la señal, o a "esperando" cuando se corta.
- Canales públicos: datos de un canal por su username y lista de canales en vivo.

**Chat**
- Cualquiera, con o sin sesión, puede unirse al chat de un canal y leerlo en tiempo real. Al entrar recibe los últimos 50 mensajes.
- Solo los usuarios con sesión pueden escribir: 1 mensaje por segundo como máximo, de 1 a 300 caracteres.
- Contador de espectadores por canal, avisado cada 5 s.
- Avisos en vivo del estado del stream, del título y del borrado del canal.

## 2. Stack

| Pieza | Tecnología | Versión |
|---|---|---|
| Runtime | Node.js | 22 |
| Lenguaje | TypeScript (modo estricto, CommonJS) | 5.9 |
| Servidor HTTP | Express | 5 |
| ORM | Sequelize + sequelize-typescript | 6 / 2 |
| Base de datos | PostgreSQL de Supabase | 17 |
| Migraciones | Umzug | 3 |
| Autenticación | Supabase Auth (`@supabase/supabase-js`) | 2 |
| Archivos | Supabase Storage (bucket `avatars`) | — |
| Tiempo real | Socket.IO | 4 |
| Validación | zod (mensajes en español) | 4 |
| Servidor de video | MediaMTX en Docker | 1.21.2 |
| Seguridad HTTP | helmet, cors, express-rate-limit | — |
| Subida de archivos | multer | 2 |
| Logs | morgan | — |
| Desarrollo | tsx (recarga en caliente) | 4 |

## 3. Arquitectura

```
OBS ──RTMP :1935──► MediaMTX (Docker) ──HLS :8888──► Navegador (reproductor)
                      │          ▲
  pregunta si acepta  │          │  consulta señales activas
  la señal            │          │  y corta OBS (API :9997)
  POST /internal/...  ▼          │
Frontend ──REST /api──► Backend (Express + TS) ◄──► Supabase: Auth · Postgres · Storage
         ◄─Socket.IO──►
```

| Componente | Qué hace |
|---|---|
| API REST (Express 5) | Cuentas, perfil, dashboard del stream y canales públicos, en `/api`. |
| Socket.IO | Chat, avisos de estado del stream y contador de espectadores. Comparte el puerto de la API. |
| Monitor de streams | Cada 3 s compara lo que recibe MediaMTX con el estado de cada canal. |
| Ruta interna `/internal` | MediaMTX la llama para autorizar cada señal de OBS. Exige un secreto compartido. |
| MediaMTX | Recibe RTMP de OBS, sirve HLS y expone una API local para listar y cortar señales. |
| Supabase Auth | Cuentas, contraseñas, códigos OTP por correo y tokens JWT. |
| Supabase Postgres | Tablas `profiles`, `channels` y `chat_messages`, a través de Sequelize. |
| Supabase Storage | Avatares, en el bucket público `avatars`. |

### Estados de un canal

| Estado | Significado | El público lo ve como |
|---|---|---|
| `offline` | Sin transmisión. MediaMTX rechaza a OBS aunque la clave sea correcta. | Desconectado |
| `waiting` | El streamer pulsó "Iniciar stream" y se espera la señal de OBS. | Desconectado |
| `live` | MediaMTX está recibiendo la señal. | En vivo |

### Ciclo de una transmisión

1. El streamer pulsa **Iniciar stream** (`POST /api/stream/start`): el canal pasa de `offline` a `waiting`.
2. OBS se conecta a `rtmp://<host>:1935/live` con la clave `<username>?key=<streamKey>`.
3. MediaMTX llama a `POST /internal/mediamtx/auth`. El backend responde 200 solo si el canal existe, la clave coincide y el canal no está `offline`.
4. En 3 s o menos, el monitor ve la señal lista en MediaMTX, pasa el canal a `live` y avisa por Socket.IO (`stream:status` a la sala y `stream:state` al dueño).
5. Los espectadores reproducen `http://<host>:8888/live/<username>/index.m3u8`.
6. Si OBS se corta, el monitor devuelve el canal a `waiting`, y OBS puede reconectarse sin volver a pulsar "Iniciar".
7. **Finalizar stream** (`POST /api/stream/stop`) pasa el canal a `offline` y corta la conexión de OBS por la API de MediaMTX.

## 4. Estructura del código (MVC)

El backend sigue **MVC**, donde las **vistas son las rutas** de Express, que responden JSON:

- **Modelos** (`models/`): clases de sequelize-typescript, con métodos que arman las respuestas (`toMe()`, `toPublic()`, `toDashboard()`, `toMessage()`). No conocen Express ni Socket.IO.
- **Controladores** (`controllers/`): la lógica de cada caso de uso.
- **Vistas** (`routes/`): solo declaran el método, la URL, los middlewares y el controlador.

```
backend/
├── docker-compose.yml          MediaMTX en Docker
├── mediamtx/mediamtx.yml       configuración de MediaMTX
├── supabase/email-templates/   plantillas de correo con el código OTP
├── requests.http               pruebas manuales de la API
├── test/                       pruebas unitarias (Jest): unit/, helpers/ y setup-env.ts
├── jest.config.js              configuración de Jest (ts-jest, con tsconfig.test.json)
├── specs/                      requerimientos, diseño y tareas
├── .env.example
└── src/
    ├── server.ts               arranque: BD → bucket → HTTP + Socket.IO → monitor
    ├── app.ts                  Express: helmet, CORS, JSON, logs, rutas y errores
    ├── config/
    │   ├── env.ts              lee y valida el .env con zod
    │   ├── supabase.ts         cliente admin, cliente público y bucket de avatares
    │   └── mediamtx.ts         API de MediaMTX: listar señales y cortar OBS
    ├── database/
    │   ├── index.ts            instancia de Sequelize
    │   ├── migrate.ts          CLI de migraciones (Umzug)
    │   └── migrations/         001-profiles, 002-channels, 003-chat-messages
    ├── models/                 Profile, Channel, ChatMessage, AuthUser y DTOs
    ├── controllers/            auth, me, stream, channels, mediamtx, chat, health
    ├── routes/                 auth, me, stream, channels, internal e index
    ├── sockets/                servidor Socket.IO, tipos de eventos y avisos a salas
    ├── jobs/streamMonitor.ts   monitor de señales de MediaMTX
    ├── middlewares/            requireAuth, validate, rateLimits, upload, internalSecret, errorHandler
    ├── validators/             esquemas zod de cada ruta y evento
    └── utils/                  AppError, errores de Supabase, stream keys, usernames reservados
```

### Recorrido de una petición

`helmet` → `cors` → `express.json` (máx. 10 kB) → `morgan` → router → `validate` (zod) → `requireAuth` (si es privada) → controlador → `errorHandler`.

[`src/app.ts`](src/app.ts):

```ts
export function createApp() {
  const app = express();
  if (!isProduction) app.set('json spaces', 2);

  app.use(helmet());
  app.use(cors({ origin: env.FRONTEND_URL }));
  app.use(express.json({ limit: '10kb' }));
  app.use(morgan(':method :path :status :response-time ms', { skip: () => env.NODE_ENV === 'test' }));

  app.use('/api', apiRouter);
  app.use('/internal', internalRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
```

### Arranque

[`src/server.ts`](src/server.ts) conecta la base de datos, se asegura de que exista el bucket de avatares, levanta HTTP y Socket.IO en el mismo puerto y arranca el monitor. Si un paso falla, el error dice cuál fue y qué variable del `.env` revisar:

```ts
async function main() {
  await step('Conexión a la base de datos (DATABASE_URL)', connectDatabase);
  await step('Bucket de avatares en Supabase Storage (SUPABASE_URL / SUPABASE_SECRET_KEY)', ensureAvatarsBucket);

  const server = http.createServer(createApp());
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`El puerto ${env.PORT} ya está en uso: cierra el otro proceso o cambia PORT en .env.`);
    } else {
      console.error('Error del servidor HTTP:', err);
    }
    process.exit(1);
  });
  // Socket.IO comparte el puerto de la API.
  const io = initSockets(server);

  server.listen(env.PORT, () => {
    console.log(`Strim API escuchando en http://localhost:${env.PORT}`);
  });

  // Sincroniza los estados con MediaMTX al arrancar y cada 3 s (RF-12).
  const stopMonitor = startStreamMonitor();
```

Al recibir `SIGINT` o `SIGTERM` detiene el monitor, cierra Socket.IO (que también cierra el servidor HTTP) y luego la base de datos.

### Configuración validada

[`src/config/env.ts`](src/config/env.ts) valida todas las variables al arrancar. Si falta alguna o tiene un formato inválido, la API no inicia y la nombra:

```ts
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  FRONTEND_URL: z.url({ error: 'debe ser una URL válida' }).transform(withoutTrailingSlash),

  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/, error: 'debe ser una URL postgresql://' }),

  SUPABASE_URL: z.url({ error: 'debe ser una URL válida' }).transform(withoutTrailingSlash),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1, 'no puede estar vacía'),
  SUPABASE_SECRET_KEY: z.string().min(1, 'no puede estar vacía'),

  MEDIAMTX_API_URL: z.url({ error: 'debe ser una URL válida' }).transform(withoutTrailingSlash),
  MEDIAMTX_SECRET: z.string().min(32, 'debe tener al menos 32 caracteres'),
  RTMP_PUBLIC_URL: z.url({ protocol: /^rtmps?$/, error: 'debe ser una URL rtmp://' }).transform(withoutTrailingSlash),
  HLS_PUBLIC_URL: z.url({ error: 'debe ser una URL válida' }).transform(withoutTrailingSlash),
});
```

Ejemplo de salida cuando algo está mal:

```
Configuración inválida en .env:
  - DATABASE_URL: debe ser una URL postgresql://
  - MEDIAMTX_SECRET: debe tener al menos 32 caracteres
Revisa .env.example.
```

## 5. Base de datos

PostgreSQL de Supabase, a través de Sequelize. El esquema se crea con **migraciones** (Umzug), nunca con `sync()`.

### Tablas

**`profiles`**: datos públicos del usuario.

| Columna | Tipo | Reglas |
|---|---|---|
| `id` | uuid, PK | Igual a `auth.users.id`. FK con `ON DELETE CASCADE`. |
| `username` | varchar(20) | Único. `CHECK (username ~ '^[a-z0-9_]{3,20}$')`. |
| `display_name` | varchar(30) | No nulo. Al registrarse vale lo mismo que el username. |
| `bio` | varchar(200) | No nulo, por defecto `''`. |
| `avatar_url` | text | Nulo si no hay avatar. |
| `created_at`, `updated_at` | timestamptz | |

**`channels`**: un canal por usuario.

| Columna | Tipo | Reglas |
|---|---|---|
| `user_id` | uuid, PK | FK a `profiles.id` con `ON DELETE CASCADE`. |
| `stream_key` | varchar(64) | Única. 24 bytes aleatorios en base64url (32 caracteres). |
| `status` | enum `channel_status` | `offline`, `waiting` o `live`. Por defecto `offline`. |
| `title` | varchar(100) | Por defecto `''`. |
| `live_started_at` | timestamptz | Solo tiene valor en `live`. |
| `created_at`, `updated_at` | timestamptz | |

**`chat_messages`**: mensajes del chat.

| Columna | Tipo | Reglas |
|---|---|---|
| `id` | bigint identity, PK | En el JSON viaja como string. |
| `channel_id` | uuid | FK a `channels.user_id` con `ON DELETE CASCADE`. |
| `user_id` | uuid | Autor. FK a `profiles.id` con `ON DELETE CASCADE`. |
| `content` | varchar(300) | No nulo. |
| `created_at` | timestamptz | Por defecto `now()`. |

Índices: `(channel_id, id DESC)` para leer los últimos 50 mensajes de un canal, y `(user_id)` para que el borrado en cascada sea rápido.

**`auth.users`** (de Supabase, **solo lectura**): el modelo `AuthUser` lee `id`, `email` y `email_confirmed_at` para saber, al registrarse, si un correo ya existe y si está verificado.

### Relaciones y borrado

- Un Profile tiene un Channel. Un ChatMessage pertenece a un Channel y a un Profile (el autor).
- Al borrar un usuario de `auth.users`, Postgres borra en cascada su perfil, su canal, los mensajes de su canal y los que escribió en otros canales.

### RLS

Las cuatro tablas del esquema `public` (`profiles`, `channels`, `chat_messages` y `schema_migrations`, la tabla de control de las migraciones) tienen **RLS activado y ninguna política**. El backend entra como dueño de las tablas, así que RLS no le afecta, pero la API pública de Supabase (PostgREST) no puede leerlas.

Fragmento de [`src/database/migrations/002-channels.ts`](src/database/migrations/002-channels.ts):

```sql
CREATE TYPE public.channel_status AS ENUM ('offline', 'waiting', 'live');

CREATE TABLE public.channels (
  user_id uuid PRIMARY KEY REFERENCES public.profiles (id) ON DELETE CASCADE,
  stream_key varchar(64) NOT NULL UNIQUE,
  status public.channel_status NOT NULL DEFAULT 'offline',
  title varchar(100) NOT NULL DEFAULT '',
  live_started_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.channels ENABLE ROW LEVEL SECURITY;
```

### Conexión

[`src/database/index.ts`](src/database/index.ts) usa SSL con Supabase. Con una base local (`localhost` o `127.0.0.1`) no lo usa:

```ts
// Supabase exige SSL. Una base local (por ejemplo, en Docker) no lo usa.
const host = new URL(env.DATABASE_URL).hostname;
const isLocalDatabase = host === 'localhost' || host === '127.0.0.1';

export const sequelize = new Sequelize(env.DATABASE_URL, {
  dialect: 'postgres',
  dialectOptions: isLocalDatabase ? {} : { ssl: { require: true, rejectUnauthorized: false } },
  define: { underscored: true },
  logging: false,
  pool: { max: 5 },
  models: [Profile, Channel, ChatMessage, AuthUser],
});
```

### Migraciones

Están listadas en orden en [`src/database/migrations/index.ts`](src/database/migrations/index.ts), y Umzug guarda las aplicadas en la tabla `schema_migrations`:

```bash
npm run db:migrate    # aplica todas las pendientes
npm run db:rollback   # revierte la última
```

## 6. Autenticación con Supabase

Supabase Auth es la única fuente de verdad de las credenciales: el backend nunca guarda contraseñas. Los tokens viajan en el JSON y el cliente los manda en `Authorization: Bearer <accessToken>`. El mismo token sirve para la API y para el socket.

### Dos clientes de Supabase

[`src/config/supabase.ts`](src/config/supabase.ts):

```ts
// Sin sesión persistente: el servidor nunca guarda tokens entre peticiones.
const serverAuth = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

// Cliente admin (secret key): verificar tokens, administrar usuarios y Storage.
export const supabaseAdmin = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, serverAuth);

// Cliente público (publishable key), uno por petición: guarda la sesión del usuario en memoria
// y compartirlo mezclaría usuarios.
export const createPublicClient = () => createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, serverAuth);
```

- **Cliente admin:** `getClaims`, `admin.updateUserById`, `admin.deleteUser`, `admin.signOut` y Storage.
- **Cliente público:** `signUp`, `verifyOtp`, `resend`, `signInWithPassword`, `refreshSession` y `resetPasswordForEmail`.

Al arrancar, `ensureAvatarsBucket()` crea el bucket público `avatars` (2 MB, JPG/PNG/WebP) si todavía no existe.

### Verificación del token

[`src/middlewares/requireAuth.ts`](src/middlewares/requireAuth.ts). El token se valida con `getClaims`, que verifica la firma del JWT. Además se carga el perfil, así que una cuenta borrada deja de funcionar aunque su token no haya vencido:

```ts
export async function authenticateToken(token: string): Promise<AuthContext | null> {
  // getClaims lanza (en vez de devolver error) si el token ni siquiera tiene forma de JWT.
  const result = await supabaseAdmin.auth.getClaims(token).catch(() => null);
  if (!result || result.error || !result.data) return null;

  const { sub, email, exp } = result.data.claims;
  const profile = await Profile.findByPk(sub, { include: [Channel] });
  if (!profile?.channel) return null;

  return { userId: sub, email: email ?? '', accessToken: token, exp, profile };
}
```

`requireAuth` lee el header `Authorization: Bearer …`, llama a `authenticateToken` y deja el resultado en `req.auth`. Si falla, responde 401 `UNAUTHORIZED`. El socket usa la misma función.

### Flujos

| Flujo | Cómo funciona |
|---|---|
| **Registro** | Busca el correo en `auth.users`. Si está verificado responde `EMAIL_TAKEN`; si está sin verificar, reenvía el código. Si el username existe responde `USERNAME_TAKEN`. Si no, llama a `signUp` (Supabase envía el OTP) y crea el perfil y el canal en una transacción. Si esa transacción falla, borra el usuario recién creado en Supabase. |
| **Verificar correo** | `verifyOtp({ email, token, type: 'email' })`. Si funciona, devuelve tokens y los datos del usuario. |
| **Reenviar código** | Solo reenvía si el correo existe y no está verificado. Responde lo mismo en todos los casos. Supabase exige 60 s entre envíos (`TOO_MANY_REQUESTS`). |
| **Login** | `signInWithPassword`. El error `invalid_credentials` se responde como `INVALID_CREDENTIALS` y `email_not_confirmed` como `EMAIL_NOT_VERIFIED`. |
| **Refresh** | `refreshSession({ refresh_token })` devuelve tokens nuevos. |
| **Logout** | `admin.signOut(accessToken, 'local')` invalida el refresh token de esa sesión. |
| **Olvidé mi contraseña** | `resetPasswordForEmail(email)` envía un código. Responde lo mismo exista o no el correo. |
| **Restablecer** | `verifyOtp({ type: 'recovery' })`, guarda la contraseña nueva con `admin.updateUserById` y cierra todas las sesiones con `admin.signOut(…, 'global')`. |
| **Cambiar contraseña** | Comprueba la actual, rechaza que la nueva sea igual (`SAME_PASSWORD`) y guarda la nueva. |
| **Borrar cuenta** | Comprueba la contraseña y borra el usuario en Supabase. El detalle está más abajo. |

Núcleo del registro, en [`src/controllers/auth.controller.ts`](src/controllers/auth.controller.ts):

```ts
  if (await Profile.findOne({ where: { username } })) throw new AppError('USERNAME_TAKEN');

  const { data, error } = await createPublicClient().auth.signUp({
    email,
    password,
    options: { data: { username } },
  });
  if (error) throw fromAuthError(error);
  const user = data.user;
  if (!user) throw new Error('Supabase no devolvió el usuario creado');
  // Supabase responde sin identidades cuando el correo ya existía.
  if (user.identities?.length === 0) throw new AppError('EMAIL_TAKEN');

  try {
    await sequelize.transaction(async (transaction) => {
      await Profile.create({ id: user.id, username, displayName: username }, { transaction });
      await Channel.create({ userId: user.id, streamKey: generateStreamKey() }, { transaction });
    });
  } catch (err) {
    // Sin perfil la cuenta no sirve: se deshace en Supabase.
    await supabaseAdmin.auth.admin.deleteUser(user.id);
    if (err instanceof UniqueConstraintError) throw new AppError('USERNAME_TAKEN');
    throw err;
  }
```

Para cambiar la contraseña o borrar la cuenta, la contraseña actual se comprueba con una sesión de prueba que se cierra enseguida. Está en [`src/controllers/me.controller.ts`](src/controllers/me.controller.ts):

```ts
export async function verifyCurrentPassword(email: string, password: string) {
  const { data, error } = await createPublicClient().auth.signInWithPassword({ email, password });
  if (error && isRateLimited(error)) throw new AppError('TOO_MANY_REQUESTS');
  if (error || !data.session) throw new AppError('INVALID_CURRENT_PASSWORD');
  await supabaseAdmin.auth.admin.signOut(data.session.access_token, 'local');
}
```

### Borrado de cuenta

```ts
export const deleteMe: RequestHandler = async (req, res) => {
  const { userId, email, profile } = authOf(req);
  const { password } = req.body as DeleteMeBody;
  await verifyCurrentPassword(email, password);

  // Si estaba transmitiendo: offline primero (MediaMTX rechaza la reconexión de OBS) y luego se corta la señal.
  const channel = profile.channel!;
  if (channel.status !== 'offline') {
    await channel.update({ status: 'offline', liveStartedAt: null });
    await kickQuietly(profile.username);
  }
  closeChannelRoom(profile.id);

  // El avatar se intenta borrar, pero un fallo de Storage no impide borrar la cuenta.
  try {
    await removeAvatars(userId);
  } catch (err) {
    console.warn(`[me] no se pudo borrar el avatar de ${userId}: ${err instanceof Error ? err.message : err}`);
  }

  // Postgres borra en cascada el perfil, el canal y los mensajes (RF-08.1).
  const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
  if (error) throw fromAuthError(error);

  disconnectUser(userId);
  res.status(204).end();
};
```

`closeChannelRoom` avisa `channel:deleted` a la sala del chat y saca a todos de ella. `disconnectUser` cierra todas las conexiones del usuario.

### Errores de Supabase

[`src/utils/authErrors.ts`](src/utils/authErrors.ts) traduce los errores de Supabase que tienen sentido para el cliente:

| Error de Supabase | Respuesta |
|---|---|
| status 429 o código `over_*` | `TOO_MANY_REQUESTS` |
| "Error sending … email" (falla el SMTP) | `EMAIL_NOT_SENT` (503) |
| `weak_password` | `VALIDATION_ERROR` |
| `email_address_invalid`, `validation_failed` | `VALIDATION_ERROR` |
| `email_address_not_authorized` | `VALIDATION_ERROR`, con un mensaje que indica configurar un SMTP propio |

### Plantillas de correo

[`supabase/email-templates/`](supabase/email-templates/) tiene las dos plantillas que se pegan en Supabase, con el código `{{ .Token }}` en lugar de un enlace:

- `confirm-signup.html`: el código para activar la cuenta.
- `reset-password.html`: el código para cambiar la contraseña.

## 7. Instalación y puesta en marcha

### Requisitos

- **Node.js 22**
- **Docker Desktop**, para MediaMTX
- Un **proyecto de Supabase**
- **OBS Studio**, para transmitir

### Pasos

```bash
npm install
cp .env.example .env     # y completa los valores
npm run db:migrate       # crea las tablas en Supabase
npm run media:up         # levanta MediaMTX en Docker
npm run dev              # API y chat en http://localhost:4000
```

Comprueba que responda: `GET http://localhost:4000/api/health` → `{ "ok": true }`.

### Variables de entorno (`.env`)

| Variable | Valor |
|---|---|
| `NODE_ENV` | `development` |
| `PORT` | Puerto de la API y de Socket.IO. Por defecto `4000`. `docker-compose.yml` también lo usa. |
| `FRONTEND_URL` | Origen del frontend permitido por CORS, por ejemplo `http://localhost:5173`. |
| `DATABASE_URL` | Supabase → **Connect** → **Session pooler** (puerto 5432), con la contraseña de la base. La conexión directa (`db.<ref>.supabase.co`) solo funciona por IPv6. |
| `SUPABASE_URL` | `https://<ref>.supabase.co` |
| `SUPABASE_PUBLISHABLE_KEY` | Supabase → Project Settings → API Keys (`sb_publishable_…`). |
| `SUPABASE_SECRET_KEY` | Supabase → Project Settings → API Keys → Secret keys (`sb_secret_…`). Solo vive en el backend. |
| `MEDIAMTX_API_URL` | `http://127.0.0.1:9997` |
| `MEDIAMTX_SECRET` | Valor aleatorio de 32 caracteres o más. Lo comparten el backend y MediaMTX. |
| `RTMP_PUBLIC_URL` | `rtmp://localhost:1935/live`: el servidor que se muestra para OBS. |
| `HLS_PUBLIC_URL` | `http://localhost:8888`: la base de la URL de reproducción. |

Para generar `MEDIAMTX_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

### Configuración de Supabase (una sola vez)

1. **Authentication → Sign In / Providers → Email:**
   - Confirm email: activado.
   - Email OTP Length: `6`.
   - Email OTP Expiration: `600`.
   - Minimum password length: `8`.
2. **Authentication → Emails → SMTP Settings:** activa un SMTP propio. Sin él, Supabase no deja editar las plantillas. Con Gmail se usa:
   - **Host:** `smtp.gmail.com`.
   - **Puerto:** `465`.
   - **Usuario:** tu Gmail.
   - **Contraseña:** una [contraseña de aplicación](https://myaccount.google.com/apppasswords).
3. **Authentication → Emails → Templates:** en **Confirm sign up** y **Reset password**, pega en la vista *Source* el contenido de los archivos de `supabase/email-templates/`.
4. **Storage:** no hace falta crear nada a mano, el backend crea el bucket `avatars` al arrancar.

## 8. MediaMTX: cómo se usa

[MediaMTX](https://github.com/bluenviron/mediamtx) es el servidor de video:
- **Entrada:** recibe la señal de OBS por **RTMP** (puerto 1935).
- **Salida:** la sirve a los navegadores en **HLS** (puerto 8888).
- **API:** el backend la usa para saber qué canales tienen señal y para cortar a OBS (puerto 9997, solo local).

### Docker Compose

[`docker-compose.yml`](docker-compose.yml):

```yaml
# MediaMTX: recibe la señal RTMP de OBS y la sirve en HLS (diseño §8.1).
# Lee PORT y MEDIAMTX_SECRET del mismo backend/.env.
name: strim

services:
  mediamtx:
    image: bluenviron/mediamtx:1.21.2
    restart: unless-stopped
    ports:
      - "1935:1935" # RTMP para OBS
      - "8888:8888" # HLS para los navegadores
      - "127.0.0.1:9997:9997" # API sin autenticación: solo accesible desde esta máquina
    volumes:
      - ./mediamtx/mediamtx.yml:/mediamtx.yml:ro
    environment:
      # Antes de aceptar una señal, MediaMTX le pregunta al backend (RF-11).
      MTX_AUTHHTTPADDRESS: http://host.docker.internal:${PORT:-4000}/internal/mediamtx/auth?secret=${MEDIAMTX_SECRET:?falta MEDIAMTX_SECRET en backend/.env}
    extra_hosts:
      - "host.docker.internal:host-gateway"
```

- Docker Compose lee `PORT` y `MEDIAMTX_SECRET` del mismo `backend/.env`, así el secreto se define en un solo lugar.
- Desde el contenedor, el backend está en `host.docker.internal`.
- La API de MediaMTX no tiene autenticación, por eso solo se publica en `127.0.0.1`.

### Configuración

[`mediamtx/mediamtx.yml`](mediamtx/mediamtx.yml):

```yaml
# Configuración de MediaMTX 1.21 para Strim (diseño §8.2).
# Lo que no aparece aquí usa el valor por defecto de MediaMTX.

logLevel: info

# Antes de aceptar una señal, MediaMTX llama al backend (RF-11).
# authHTTPAddress llega desde docker-compose.yml (MTX_AUTHHTTPADDRESS) con el secreto del .env.
authMethod: http
authHTTPExclude:
  - action: read # ver es público (RF-11.2)
  - action: playback
  - action: api # la API solo se publica en 127.0.0.1
  - action: metrics
  - action: pprof

api: true
apiAddress: :9997

rtmp: true
rtmpAddress: :1935

hls: true
hlsAddress: :8888
hlsAllowOrigins: ["*"] # los streams son públicos

# Strim solo usa RTMP de entrada y HLS de salida.
rtsp: false
webrtc: false
srt: false
moq: false

paths:
  # Solo se acepta live/<username>: cualquier otra ruta se rechaza.
  "~^live/[a-z0-9_]{3,20}$": {}
```

### Comandos

```bash
npm run media:up      # levanta MediaMTX (docker compose up -d)
npm run media:down    # lo apaga (docker compose down)
```

Para ver los logs de MediaMTX:

```bash
docker compose logs -f mediamtx
```

Para ver las señales que está recibiendo, desde la misma máquina:

```bash
curl http://127.0.0.1:9997/v3/paths/list
```

### Configurar OBS

1. Con sesión iniciada, pulsa **Iniciar stream** (`POST /api/stream/start`).
2. `GET /api/stream` devuelve, por ejemplo:
   ```json
   {
     "status": "waiting",
     "title": "Mi primer stream",
     "liveStartedAt": null,
     "obs": { "server": "rtmp://localhost:1935/live", "streamKey": "streamer1?key=…" }
   }
   ```
3. En OBS → **Ajustes → Emisión**, configura:
   - **Servicio:** Personalizado.
   - **Servidor:** el valor de `obs.server`.
   - **Clave de retransmisión:** el valor de `obs.streamKey`.
4. Recomendado: en **Salida**, un intervalo de fotogramas clave de `2` s, para que el HLS tenga menos retraso.
5. Al pulsar "Iniciar transmisión" en OBS, el canal pasa a `live` en unos segundos.

Con esa clave, MediaMTX recibe la ruta `live/<username>` y la query `key=<streamKey>`. Así la URL pública de reproducción nunca contiene la clave.

### Ver el stream

| Qué | URL |
|---|---|
| Playlist HLS, para el reproductor del frontend (por ejemplo hls.js) | `http://localhost:8888/live/<username>/index.m3u8` |
| Reproductor que trae MediaMTX, para probar | `http://localhost:8888/live/<username>` |

`GET /api/channels/:username` devuelve la playlist en `playbackUrl` cuando el canal está en vivo, y `null` cuando no.

### Autorización de la señal

Cada vez que OBS intenta publicar, MediaMTX hace `POST /internal/mediamtx/auth?secret=…`. Primero, [`src/middlewares/internalSecret.ts`](src/middlewares/internalSecret.ts) compara el secreto en tiempo constante. Después, [`src/controllers/mediamtx.controller.ts`](src/controllers/mediamtx.controller.ts) decide:

```ts
export const authorizeMediaMtx: RequestHandler = async (req, res) => {
  const { action, path, query } = authRequest.parse(req.body);

  // Ver es público (RF-11.2). MediaMTX ya no pregunta por estas acciones, pero se aceptan igual.
  if (action === 'read' || action === 'playback') {
    res.status(200).end();
    return;
  }
  if (action !== 'publish') throw new AppError('UNAUTHORIZED');

  // OBS: servidor rtmp://<host>:1935/live y clave "<username>?key=<streamKey>" → path live/<username>, query key=…
  const username = usernameFromPath(path);
  const key = new URLSearchParams(query).get('key') ?? '';
  const profile = username ? await Profile.findOne({ where: { username }, include: [Channel] }) : null;
  const channel = profile?.channel;

  if (!channel || !key || !safeEqual(channel.streamKey, key) || channel.status === 'offline') {
    const reason = !channel ? 'canal inexistente' : channel.status === 'offline' ? 'canal offline' : 'clave incorrecta';
    console.warn(`[mediamtx] señal rechazada en "${path}": ${reason}`);
    throw new AppError('UNAUTHORIZED');
  }

  res.status(200).end();
};
```

Cada rechazo queda en el log del backend con su motivo, por ejemplo: `[mediamtx] señal rechazada en "live/streamer1": canal offline`.

### Monitor de señales

[`src/jobs/streamMonitor.ts`](src/jobs/streamMonitor.ts) corre al arrancar y cada 3 s:

```ts
async function tick() {
  if (running) return;
  running = true;
  try {
    const signals = await readSignals();
    if (!signals) return;
    const isReady = (username: string) => signals.get(username)?.ready === true;

    // live sin señal → waiting: OBS se detuvo o se cayó y puede reconectarse (RF-12.2).
    const live = await Profile.findAll({ include: [{ model: Channel, where: { status: 'live' } }] });
    for (const profile of live) {
      if (!isReady(profile.username)) await transition(profile, 'live', 'waiting', null);
    }

    const readyUsernames = [...signals.keys()].filter(isReady);
    if (readyUsernames.length === 0) return;

    const withSignal = await Profile.findAll({ where: { username: readyUsernames }, include: [Channel] });
    for (const profile of withSignal) {
      const status = profile.channel?.status;
      // waiting con señal → live (RF-12.1).
      if (status === 'waiting') {
        await transition(profile, 'waiting', 'live', signals.get(profile.username)?.readyTime ?? new Date());
      }
      // offline con señal: falló el corte al finalizar, se vuelve a intentar.
      if (status === 'offline') await kickQuietly(profile.username);
    }
  } catch (err) {
    console.error('[monitor] error al revisar las señales', err);
  } finally {
    running = false;
  }
}
```

- **Cambios de estado condicionados:** el UPDATE solo se aplica si el canal sigue en el estado esperado. Así el monitor no pisa un "Finalizar stream" que llegó mientras leía:

  ```ts
  async function transition(profile: Profile, from: ChannelStatus, to: ChannelStatus, liveStartedAt: Date | null) {
    const [changed] = await Channel.update(
      { status: to, liveStartedAt },
      { where: { userId: profile.id, status: from } },
    );
    if (!changed) return;
    profile.channel!.set({ status: to, liveStartedAt });
    notifyStreamChange(profile);
  }
  ```

- **MediaMTX caído:** si no responde, el monitor no cambia ningún estado. Lo registra una sola vez (`[monitor] MediaMTX no responde…`) y avisa cuando vuelve (`[monitor] MediaMTX volvió a responder.`).
- **Al reiniciar el backend:** la primera pasada sincroniza los estados. Si OBS sigue transmitiendo, el canal sigue `live`; si OBS se cortó mientras el backend estaba apagado, pasa a `waiting`.

### Cortar a OBS

[`src/config/mediamtx.ts`](src/config/mediamtx.ts) busca la conexión RTMP del canal y la corta con la API de MediaMTX:

```ts
export async function kickPublisher(username: string): Promise<boolean> {
  const source = (await listLiveSignals()).get(username)?.source;
  const resource = source && KICK_RESOURCES[source.type];
  if (!source || !resource) return false;
  await call(`/v3/${resource}/kick/${source.id}`, { method: 'POST' });
  return true;
}
```

**Finalizar stream** pasa primero el canal a `offline`, así MediaMTX rechaza la reconexión automática de OBS, y después corta. Está en [`src/controllers/stream.controller.ts`](src/controllers/stream.controller.ts):

```ts
export const stopStream: RequestHandler = async (req, res) => {
  const { profile } = authOf(req);
  await profile.channel!.update({ status: 'offline', liveStartedAt: null });
  notifyStreamChange(profile);
  await kickQuietly(profile.username);
  res.json(profile.toDashboard());
};
```

## 9. API REST

- Todas las rutas públicas van bajo `/api` y responden JSON, con camelCase y fechas ISO 8601 en UTC.
- 🔒 = exige `Authorization: Bearer <accessToken>`.

| Método | Ruta | Auth | Body | Respuesta |
|---|---|---|---|---|
| GET | `/api/health` | | | 200 `{ ok: true }` |
| POST | `/api/auth/register` | | `email`, `username`, `password` | 201 `{ status: 'verification_pending', email }`. Si la cuenta ya existía sin verificar: 200 con lo mismo, y reenvía el código. |
| POST | `/api/auth/verify-email` | | `email`, `otp` | 200 `AuthSession` |
| POST | `/api/auth/resend-otp` | | `email` | 200 `{ message }` |
| POST | `/api/auth/login` | | `email`, `password` | 200 `AuthSession` |
| POST | `/api/auth/refresh` | | `refreshToken` | 200 `Tokens` |
| POST | `/api/auth/logout` | 🔒 | | 204 |
| POST | `/api/auth/password/forgot` | | `email` | 200 `{ message }` |
| POST | `/api/auth/password/reset` | | `email`, `otp`, `newPassword` | 200 `{ message }` |
| GET | `/api/me` | 🔒 | | 200 `Me` |
| PATCH | `/api/me` | 🔒 | `username?`, `displayName?`, `bio?` | 200 `Me` |
| PUT | `/api/me/avatar` | 🔒 | multipart, campo `avatar` | 200 `Me` |
| PUT | `/api/me/password` | 🔒 | `currentPassword`, `newPassword` | 204 |
| DELETE | `/api/me` | 🔒 | `password` | 204 |
| GET | `/api/stream` | 🔒 | | 200 `StreamDashboard` |
| PATCH | `/api/stream` | 🔒 | `title` | 200 `StreamDashboard` |
| POST | `/api/stream/start` | 🔒 | `title?` | 200 `StreamDashboard` |
| POST | `/api/stream/stop` | 🔒 | | 200 `StreamDashboard` |
| POST | `/api/stream/key` | 🔒 | | 200 `StreamDashboard` |
| GET | `/api/channels/live` | | | 200 `PublicChannel[]`, los más vistos primero |
| GET | `/api/channels/:username` | | | 200 `PublicChannel` o 404 |
| POST | `/internal/mediamtx/auth` | secreto | lo envía MediaMTX | 200 o 401. No es parte de la API pública. |

### Formas de las respuestas

[`src/models/dto.ts`](src/models/dto.ts):

```ts
export type ProfileDTO = {
  username: string;
  displayName: string;
  bio: string;
  avatarUrl: string | null;
};

export type MeDTO = {
  id: string;
  email: string;
  profile: ProfileDTO;
  channel: { status: ChannelStatus; title: string; liveStartedAt: string | null };
};

export type StreamDashboardDTO = {
  status: ChannelStatus;
  title: string;
  liveStartedAt: string | null;
  obs: { server: string; streamKey: string };
};

export type PublicChannelDTO = ProfileDTO & {
  title: string;
  isLive: boolean;
  liveStartedAt: string | null;
  viewers: number;
  playbackUrl: string | null;
};

export type ChatMessageDTO = {
  id: string;
  content: string;
  createdAt: string;
  author: { username: string; displayName: string; avatarUrl: string | null };
};
```

- `Tokens` es `{ accessToken, refreshToken, expiresAt }`.
- `AuthSession` es `Tokens` más `user: Me`.

**La stream key solo sale en `StreamDashboard`.** `Me` y `PublicChannel` nunca la incluyen, y `PublicChannel` tampoco incluye el correo. Las arman estos métodos de [`src/models/Profile.ts`](src/models/Profile.ts):

```ts
  toDashboard(): StreamDashboardDTO {
    const channel = this.loadedChannel();
    return {
      status: channel.status,
      title: channel.title,
      liveStartedAt: channel.liveStartedAt?.toISOString() ?? null,
      obs: {
        server: env.RTMP_PUBLIC_URL,
        streamKey: `${this.username}?key=${channel.streamKey}`,
      },
    };
  }

  toPublic(viewers: number): PublicChannelDTO {
    const channel = this.loadedChannel();
    const isLive = channel.status === 'live';
    return {
      ...this.toProfile(),
      title: channel.title,
      isLive,
      liveStartedAt: isLive ? (channel.liveStartedAt?.toISOString() ?? null) : null,
      viewers,
      playbackUrl: isLive ? `${env.HLS_PUBLIC_URL}/live/${this.username}/index.m3u8` : null,
    };
  }
```

### Reglas de validación

Todas las entradas se validan con zod antes de llegar al controlador. Los esquemas están en [`src/validators/`](src/validators/) y los mensajes, en español.

| Dato | Regla |
|---|---|
| Correo | Formato válido, máx. 254 caracteres. Se guarda en minúsculas. |
| Username | De 3 a 20 caracteres `a-z`, `0-9` o `_`. Se guarda en minúsculas y no puede ser una palabra reservada (`admin`, `api`, `auth`, `dashboard`, `help`, `internal`, `live`, `login`, `logout`, `me`, `register`, `reset`, `settings`, `signup`, `stream`, `strim`, `support`, `verify`). |
| Contraseña nueva | De 8 a 72 caracteres, con al menos una letra y un número. |
| Código OTP | Solo dígitos, de 6 a 10. |
| Nombre visible | De 1 a 30 caracteres. |
| Bio | Máx. 200 caracteres. |
| Título del stream | Máx. 100 caracteres. |
| Avatar | JPG, PNG o WebP, máx. 2 MB. Además del tipo declarado, se comprueban los primeros bytes del archivo. |
| Mensaje del chat | De 1 a 300 caracteres, sin los espacios de los extremos. |

Comprobación del formato real del avatar, en [`src/controllers/me.controller.ts`](src/controllers/me.controller.ts):

```ts
// Firma de los primeros bytes de cada formato: el tipo que manda el cliente no basta.
const AVATAR_FORMATS = {
  'image/jpeg': { ext: 'jpg', matches: (b: Buffer) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/png': { ext: 'png', matches: (b: Buffer) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/webp': { ext: 'webp', matches: (b: Buffer) => b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' },
} as const;
```

Cada avatar se guarda en `avatars/<userId>/<timestamp>.<ext>` con un nombre nuevo en cada subida, para que el navegador no muestre la imagen vieja desde caché. Los anteriores se borran.

### Reglas de negocio

- **Username:** cambiarlo con el canal en `waiting` o `live` responde `CHANNEL_LIVE`, porque la ruta del stream depende de él.
- **Stream key:** regenerarla con el canal en `waiting` o `live` responde `CHANNEL_LIVE`.
- **`start`:** pasa de `offline` a `waiting`. Si el canal ya estaba iniciado solo cambia el título, así que llamarlo dos veces no rompe nada.
- **`stop`:** desde cualquier estado pasa a `offline`, borra `liveStartedAt` y corta a OBS.

### Límites de intentos

[`src/middlewares/rateLimits.ts`](src/middlewares/rateLimits.ts):

| Dónde | Límite |
|---|---|
| Todas las rutas `/api/auth/*` | 10 peticiones por minuto por IP. |
| `PUT /api/me/password` y `DELETE /api/me` | 5 fallos cada 15 min por usuario. Los dos comparten el mismo contador y las respuestas exitosas no cuentan. |
| `chat:send` | 1 mensaje por segundo por usuario. |

```ts
// Cambiar la contraseña y borrar la cuenta: 5 fallos cada 15 min por usuario (RF-07.4, RF-08.2).
// Va después de requireAuth. Las respuestas exitosas no cuentan.
export const sensitiveLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 5,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req) => req.auth?.userId ?? 'anonymous',
  handler,
});
```

## 10. Chat en tiempo real (Socket.IO)

Socket.IO corre en el **mismo puerto que la API** (`4000`), con CORS limitado a `FRONTEND_URL`.

### Conexión

- **Sin token:** el socket es anónimo y solo puede leer.
- **Con token:** `io('http://localhost:4000', { auth: { token: accessToken } })`.
- **Token inválido**, que no es texto o de una cuenta borrada: la conexión se rechaza con `connect_error`, con `err.message = 'UNAUTHORIZED'` y `err.data = { code, message }`.

[`src/sockets/index.ts`](src/sockets/index.ts):

```ts
  io.use(async (socket, next) => {
    socket.data.userId = null;
    socket.data.exp = null;
    socket.data.channelId = null;

    const token: unknown = socket.handshake.auth?.token;
    if (token === undefined || token === null || token === '') return next();
    if (typeof token !== 'string') return next(connectionError('UNAUTHORIZED'));

    try {
      const auth = await authenticateToken(token);
      if (!auth) return next(connectionError('UNAUTHORIZED'));
      socket.data.userId = auth.userId;
      socket.data.exp = auth.exp;
      next();
    } catch (err) {
      console.error('[socket] error al autenticar la conexión', err);
      next(connectionError('INTERNAL_ERROR'));
    }
  });
```

### Salas

| Sala | Quién está |
|---|---|
| `channel:<id del canal>` | Los sockets que ven el chat de ese canal. Un socket está en una sola a la vez. |
| `user:<id del usuario>` | Todas las conexiones de un mismo usuario con sesión. |

### Eventos del cliente al servidor

Todos responden con un ack: `{ ok: true, … }` o `{ ok: false, error: { code, message, details? } }`.

| Evento | Payload | Ack si sale bien | Errores posibles |
|---|---|---|---|
| `chat:join` | `{ username }` | `{ channel: PublicChannel, messages: ChatMessage[] }`, con los últimos 50 mensajes del más antiguo al más reciente | `VALIDATION_ERROR`, `NOT_FOUND` |
| `chat:leave` | — | `{}` | — |
| `chat:send` | `{ content }` | `{ message: ChatMessage }` | `AUTH_REQUIRED`, `UNAUTHORIZED`, `NOT_IN_ROOM`, `RATE_LIMITED`, `VALIDATION_ERROR` |

### Eventos del servidor al cliente

| Evento | Destino | Payload |
|---|---|---|
| `chat:message` | Sala del canal, incluido el autor | `ChatMessage` |
| `stream:status` | Sala del canal | `{ isLive, liveStartedAt, playbackUrl }` |
| `stream:title` | Sala del canal | `{ title }` |
| `stream:state` | Sala `user:<id>` del dueño | `{ status, title, liveStartedAt }` |
| `viewers:count` | Sala del canal, cada 5 s y solo si cambió | `{ viewers }` |
| `channel:deleted` | Sala del canal | `{}` |

### Envío de un mensaje

[`src/controllers/chat.controller.ts`](src/controllers/chat.controller.ts) aplica las reglas en este orden:

```ts
export async function sendMessage(socket: StrimSocket, payload: unknown): Promise<{ message: ChatMessageDTO }> {
  const { userId, exp, channelId } = socket.data;
  if (!userId) throw new AppError('AUTH_REQUIRED');
  if (!exp || exp * 1000 <= Date.now()) throw new AppError('UNAUTHORIZED');
  if (!channelId) throw new AppError('NOT_IN_ROOM');

  const now = Date.now();
  if (now - (lastMessageAt.get(userId) ?? 0) < MIN_INTERVAL_MS) throw new AppError('RATE_LIMITED');

  const { content } = sendPayload.parse(payload);
  lastMessageAt.set(userId, now);
  pruneRateLimits(now);
```

Después guarda el mensaje, lo emite con `chat:message` a toda la sala y lo devuelve en el ack. Si el canal se borró justo mientras se enviaba, responde `NOT_IN_ROOM`.

### Respuesta de los eventos

Los eventos usan la misma conversión de errores que las rutas HTTP (`toAppError`):

```ts
async function respond<T extends object>(ack: Ack<T> | undefined, run: () => Promise<T> | T) {
  try {
    const result = await run();
    if (typeof ack === 'function') ack({ ok: true, ...result });
  } catch (err) {
    let appError = toAppError(err);
    if (!appError) {
      console.error('[socket] error inesperado', err);
      appError = new AppError('INTERNAL_ERROR');
    }
    if (typeof ack === 'function') ack({ ok: false, error: appError.toJSON() });
  }
}
```

### Espectadores

- **Qué cuenta:** el número de espectadores es el tamaño de la sala `channel:<id>`, con o sin sesión. `GET /api/channels/:username` devuelve ese mismo número.
- **Cuándo avisa:** cada vez que alguien se une, sale o se desconecta, la sala queda marcada. Cada 5 s se avisa solo a las salas marcadas.

[`src/sockets/emit.ts`](src/sockets/emit.ts):

```ts
// Salas cuyo número de espectadores cambió desde el último aviso.
const changedChannels = new Set<string>();

export function markViewersChanged(channelId: string) {
  changedChannels.add(channelId);
}

// Avisa el número de espectadores solo a las salas que cambiaron (RF-16.2). Corre cada 5 s.
export function flushViewerCounts() {
  for (const channelId of changedChannels) {
    emitToChannel(channelId, 'viewers:count', { viewers: getViewers(channelId) });
  }
  changedChannels.clear();
}
```

Los controladores HTTP y el monitor avisan a las salas con `emitToChannel` y `emitToUser`, del mismo archivo.

### Ejemplo de cliente

```js
const socket = io('http://localhost:4000', { auth: { token: accessToken } }); // sin auth = anónimo

socket.on('chat:message', (message) => console.log(message));
socket.on('viewers:count', ({ viewers }) => console.log(viewers));

socket.emit('chat:join', { username: 'streamer1' }, (res) => console.log(res.messages));
socket.emit('chat:send', { content: 'hola' }, (res) => console.log(res));
```

## 11. Errores

Todas las respuestas de error tienen la misma forma:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Hay datos inválidos.", "details": { "email": "Correo inválido." } } }
```

[`src/middlewares/errorHandler.ts`](src/middlewares/errorHandler.ts) convierte cada error así:

| Error | Respuesta |
|---|---|
| `AppError` | Su código y su HTTP. |
| `ZodError` | `VALIDATION_ERROR`, con `details` de la forma `{ campo: mensaje }`. |
| `MulterError` (por ejemplo, archivo de más de 2 MB) | `INVALID_FILE` |
| Username repetido en la base | `USERNAME_TAKEN` |
| JSON mal formado | `VALIDATION_ERROR` |
| Body de más de 10 kB | `PAYLOAD_TOO_LARGE` |
| Cualquier otro | `INTERNAL_ERROR` (500). La traza va al log, y en desarrollo también a `details.stack`. |

Catálogo, en [`src/utils/AppError.ts`](src/utils/AppError.ts):

| Código | HTTP | Mensaje |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Hay datos inválidos. |
| `INVALID_OTP` | 400 | El código es incorrecto o venció. |
| `INVALID_CURRENT_PASSWORD` | 400 | La contraseña actual no es correcta. |
| `SAME_PASSWORD` | 400 | La nueva contraseña debe ser distinta de la actual. |
| `INVALID_FILE` | 400 | El avatar debe ser JPG, PNG o WebP de hasta 2 MB. |
| `NOT_IN_ROOM` | 400 | Únete a un canal antes de escribir. |
| `UNAUTHORIZED` | 401 | Tu sesión no es válida o venció. |
| `INVALID_CREDENTIALS` | 401 | Correo o contraseña incorrectos. |
| `AUTH_REQUIRED` | 401 | Inicia sesión para comentar. |
| `EMAIL_NOT_VERIFIED` | 403 | Verifica tu correo para iniciar sesión. |
| `NOT_FOUND` | 404 | No encontrado. |
| `EMAIL_TAKEN` | 409 | Ese correo ya está registrado. |
| `USERNAME_TAKEN` | 409 | Ese nombre de usuario ya está en uso. |
| `CHANNEL_LIVE` | 409 | No puedes hacer esto mientras tu stream está activo. |
| `PAYLOAD_TOO_LARGE` | 413 | La petición es demasiado grande. |
| `TOO_MANY_REQUESTS` | 429 | Demasiados intentos. Espera un momento. |
| `RATE_LIMITED` | 429 | Vas muy rápido. |
| `INTERNAL_ERROR` | 500 | Algo salió mal. |
| `EMAIL_NOT_SENT` | 503 | No pudimos enviar el correo. Intenta de nuevo en unos minutos. |

`AUTH_REQUIRED`, `NOT_IN_ROOM` y `RATE_LIMITED` solo aparecen en el socket.

## 12. Seguridad

- **Contraseñas:** las guarda Supabase Auth. El backend nunca las almacena.
- **Secretos:** la secret key de Supabase y `MEDIAMTX_SECRET` solo están en el `.env` del backend, que no se versiona.
- **Tokens:** cada token se verifica en cada petición privada y en cada conexión del socket. Una cuenta borrada deja de autenticar aunque su token no haya vencido.
- **Base de datos:** RLS activado sin políticas en todas las tablas de `public`.
- **Stream key:**
  - Son 192 bits aleatorios y solo se entregan al dueño, en `/api/stream`.
  - No aparece en la URL pública de reproducción.
  - Se compara en tiempo constante con `safeEqual`:

  ```ts
  // Comparación en tiempo constante, para la stream key y el secreto de MediaMTX:
  // así el tiempo de respuesta no filtra cuántos caracteres coinciden.
  export function safeEqual(expected: string, received: string): boolean {
    const a = Buffer.from(expected);
    const b = Buffer.from(received);
    return a.length === b.length && timingSafeEqual(a, b);
  }
  ```

- **Rutas internas:**
  - `/internal` está fuera de `/api` y exige el secreto compartido.
  - Los logs muestran la ruta sin la query string, así el secreto nunca queda escrito.
- **MediaMTX:**
  - Su API solo se publica en `127.0.0.1`.
  - Solo acepta rutas `live/<username>`.
- **HTTP:** helmet, CORS limitado al frontend y body JSON de hasta 10 kB.
- **Avatares:** se valida el tipo declarado y los primeros bytes del archivo.
- **Chat:** el texto se guarda y se envía como texto plano, sin interpretarlo.

## 13. Scripts

| Comando | Qué hace |
|---|---|
| `npm run dev` | API con recarga en caliente (`tsx watch src/server.ts`). |
| `npm run build` | Compila a `dist/` con `tsc`. |
| `npm start` | Ejecuta `dist/server.js`. |
| `npm run typecheck` | Revisa los tipos sin compilar. |
| `npm test` | Corre las pruebas unitarias con Jest. |
| `npm run test:watch` | Las vuelve a correr con cada cambio. |
| `npm run test:coverage` | Las corre y muestra la cobertura (genera `coverage/`, que git ignora). |
| `npm run db:migrate` | Aplica las migraciones pendientes. |
| `npm run db:rollback` | Revierte la última migración. |
| `npm run media:up` | Levanta MediaMTX (`docker compose up -d`). |
| `npm run media:down` | Apaga MediaMTX (`docker compose down`). |

## 14. Pruebas

### Pruebas unitarias (Jest)

- **Dónde están:** en [`test/unit/`](test/unit/), con el mismo árbol que `src/`. Cubren utilidades, validadores, middlewares, modelos, controladores, el cliente de MediaMTX, el monitor de señales y el chat.
- **Sin servicios externos:** no usan red, ni Supabase, ni Postgres, ni MediaMTX. Supabase, los modelos de Sequelize, `fetch` y los avisos del socket se reemplazan con mocks.
- **Entorno:** [`test/setup-env.ts`](test/setup-env.ts) define variables de entorno falsas antes de importar el código, así nunca se usa el `.env` real.
- **Ayudas:** [`test/helpers/`](test/helpers/) tiene peticiones, sockets y modelos falsos, y dobles de Supabase.
- **Configuración:** [`jest.config.js`](jest.config.js) y [`tsconfig.test.json`](tsconfig.test.json), con ts-jest.

```bash
npm test                                                  # todas
npx jest test/unit/controllers/auth.controller.test.ts    # un archivo
npm run test:coverage                                     # con cobertura
```

### Pruebas manuales

[`requests.http`](requests.http) tiene todas las rutas en el orden de un uso real: cuenta, perfil, transmitir, ver, terminar el stream, contraseña y sesión, y borrar la cuenta. Se usa con la extensión **REST Client** de VS Code:

1. Cambia las variables de arriba (`@email`, `@password`, `@username`…).
2. Pulsa **Send Request** encima de cada petición.
3. El `accessToken` se toma solo de la respuesta de **Login**.

El chat no se prueba desde ese archivo. El archivo trae al final un ejemplo para probarlo desde la consola del navegador con `socket.io-client`.

## 15. Problemas comunes

| Síntoma | Causa y solución |
|---|---|
| `getaddrinfo ENOTFOUND db.<ref>.supabase.co` | Es la conexión directa, que solo funciona por IPv6. Usa la URI del **Session pooler** en `DATABASE_URL`. |
| El registro responde `EMAIL_NOT_SENT` | Supabase no pudo enviar el correo. Con Gmail, el error `535` en los logs de Supabase significa que hay que usar una contraseña de aplicación. |
| El correo trae un enlace en vez de un código | Faltan las plantillas de `supabase/email-templates/` en Supabase. |
| El código que llega tiene 8 dígitos | Pon **Email OTP Length** en `6` en Supabase. |
| `El puerto 4000 ya está en uso` | Ya hay otra instancia de la API corriendo: ciérrala o cambia `PORT`. |
| OBS no conecta | El canal no está iniciado (pulsa **Iniciar stream**), la clave se regeneró, MediaMTX está apagado (`npm run media:up`) o la API está apagada: MediaMTX le pregunta a la API antes de aceptar la señal. El motivo del rechazo aparece en el log de la API como `[mediamtx] señal rechazada…`. |
| `failed to connect to the docker API` | Docker Desktop no está abierto. |
