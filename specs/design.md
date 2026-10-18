# Strim · Backend — Diseño

> **SDD fase 2 de 3** (Requerimientos → Diseño → Tareas)
> Estado: **aprobado** · Fecha: 2026-10-18
> Parte de [requirements.md](requirements.md) v2, aprobado con D1 a D7.

---

## 1. Arquitectura

```
OBS ──RTMP :1935──► MediaMTX (Docker) ──HLS :8888──► Navegador (reproductor)
                      │          ▲
  pregunta si acepta  │          │  consulta señales activas
  la señal            │          │  y corta OBS (API :9997)
  POST /internal/...  ▼          │
Frontend ──REST /api──► Backend (Express + TS) ◄──► Supabase: Auth · Postgres · Storage
         ◄─Socket.IO──►
```

| Componente | Responsabilidad |
|---|---|
| API REST (Express 5) | Cuentas, perfil, dashboard del stream y canales públicos. |
| Socket.IO | Chat, avisos de estado del stream y contador de espectadores. |
| Monitor de streams | Consulta a MediaMTX cada 3 s y pasa los canales entre `waiting` y `live`. |
| MediaMTX | Recibe la señal RTMP de OBS, la sirve en HLS y pregunta al backend antes de aceptar una señal. |
| Supabase Auth | Cuentas, contraseñas, OTP por correo y tokens. |
| Supabase Postgres | Perfiles, canales y mensajes, a través de Sequelize. |
| Supabase Storage | Avatares. |

## 2. Decisiones técnicas

| Tema | Decisión | Motivo |
|---|---|---|
| Express | Versión 5 | Pasa al manejador de errores los fallos de funciones `async` sin envoltorios. |
| Módulos | CommonJS, TypeScript en modo estricto | Menos fricción con sequelize-typescript y Umzug. |
| Desarrollo | `tsx watch` | Arranque rápido. tsx no emite metadatos de decoradores, así que cada `@Column` declara su `DataType` explícito. |
| Validación | zod | Un esquema por ruta y por evento del socket, y de ahí salen los tipos de TS. |
| Migraciones | Umzug + QueryInterface de Sequelize, escritas en TS | `sequelize-cli` no trabaja bien con TS. |
| Verificar el JWT | `supabase.auth.getClaims(token)` | Verifica la firma localmente con las claves JWKS del proyecto, sin ir a Supabase en cada petición. Si el proyecto usa el secreto JWT antiguo, consulta a Supabase. |
| Usuario de la petición | Después de validar el token se carga el perfil desde la BD. Si no existe, 401. | Una cuenta borrada deja de funcionar aunque su token no haya vencido (RF-08.5). |
| Clientes de Supabase | Un cliente admin (secret key) compartido y un cliente público (publishable key) nuevo en cada petición | El cliente público guarda la sesión en memoria. Crear uno por petición evita mezclar usuarios. |
| Sesión en el frontend | Los tokens viajan en el JSON y el frontend los manda en `Authorization: Bearer` | El mismo token sirve para la API y para el socket. |
| Estado del stream | El monitor consulta la API de MediaMTX cada 3 s | Cubre RF-12 sin meter curl en el contenedor, y su primera consulta al arrancar hace la sincronización de RF-12.3. Retraso máximo: 3 s. |
| Datos para OBS | Servidor `rtmp://<host>:1935/live` y clave `<username>?key=<streamKey>` | La ruta pública de reproducción es `live/<username>`: la stream key nunca aparece en ella (RF-09.5). |
| Tiempo real | Socket.IO 4 | D5. |
| Pruebas | `requests.http` para probar a mano | D6. |
| MediaMTX | Imagen oficial con Docker Compose | D7. |

## 3. Estructura de carpetas

```
backend/
├── specs/                      requirements.md · design.md · tasks.md
├── docker-compose.yml          MediaMTX
├── mediamtx/mediamtx.yml       configuración de MediaMTX
├── requests.http               pruebas manuales (D6)
├── .env.example
├── package.json · tsconfig.json
└── src/
    ├── server.ts               arranque: HTTP + Express + Socket.IO + monitor
    ├── app.ts                  Express: middlewares globales, rutas y manejador de errores
    ├── config/
    │   ├── env.ts              lee y valida .env con zod
    │   ├── supabase.ts         cliente admin y fábrica del cliente público
    │   └── mediamtx.ts         llamadas a la API de MediaMTX (listar señales, cortar OBS)
    ├── database/
    │   ├── index.ts            instancia de Sequelize y registro de modelos
    │   ├── migrate.ts          CLI de Umzug (up / down)
    │   └── migrations/
    ├── models/                 M · Profile, Channel, ChatMessage, AuthUser (solo lectura)
    ├── controllers/            C · auth, me, stream, channels, mediamtx, chat
    ├── routes/                 V · auth, me, stream, channels, internal e index
    ├── sockets/                Socket.IO: conexión, eventos del chat y avisos a las salas
    ├── jobs/streamMonitor.ts   monitor de señales de MediaMTX
    ├── middlewares/            requireAuth, validate, rateLimits, upload, internalSecret, errorHandler
    ├── validators/             esquemas zod
    └── utils/                  AppError, generador de stream keys, usernames reservados
```

**Reglas MVC**
- **Rutas (vistas):** solo declaran método, URL, middlewares y controlador.
- **Controladores:** tienen la lógica y responden JSON usando métodos de los modelos (`toPublic()`, `toDashboard()`, …).
- **Modelos:** no conocen Express ni Socket.IO.
- Los manejadores del socket viven en `sockets/` y llaman a `controllers/chat.controller.ts`, igual que las rutas.

## 4. Modelo de datos

### `profiles`

| Columna | Tipo | Reglas |
|---|---|---|
| `id` | uuid, PK | Igual a `auth.users.id`. FK con `ON DELETE CASCADE`. |
| `username` | varchar(20) | Único. `CHECK (username ~ '^[a-z0-9_]{3,20}$')`. |
| `display_name` | varchar(30) | No nulo. Al registrarse vale lo mismo que el username. |
| `bio` | varchar(200) | No nulo, por defecto `''`. |
| `avatar_url` | text | Nulo si no tiene avatar. |
| `created_at`, `updated_at` | timestamptz | |

### `channels`

| Columna | Tipo | Reglas |
|---|---|---|
| `user_id` | uuid, PK | FK a `profiles.id` con `ON DELETE CASCADE`. Un canal por usuario. |
| `stream_key` | varchar(64) | Única. `randomBytes(24)` en base64url: 32 caracteres, 192 bits. |
| `status` | enum `channel_status`: `offline`, `waiting`, `live` | Por defecto `offline`. |
| `title` | varchar(100) | No nulo, por defecto `''`. |
| `live_started_at` | timestamptz | Solo tiene valor en `live`. |
| `created_at`, `updated_at` | timestamptz | |

### `chat_messages`

| Columna | Tipo | Reglas |
|---|---|---|
| `id` | bigint identity, PK | En el JSON viaja como string. |
| `channel_id` | uuid | FK a `channels.user_id` con `ON DELETE CASCADE`. |
| `user_id` | uuid | Autor. FK a `profiles.id` con `ON DELETE CASCADE`. |
| `content` | varchar(300) | No nulo. |
| `created_at` | timestamptz | Por defecto `now()`. |

Índice `(channel_id, id DESC)` para leer rápido los últimos 50 mensajes de un canal.

### `auth.users` (solo lectura)

El modelo `AuthUser` apunta a la tabla de usuarios de Supabase con tres columnas: `id`, `email` y `email_confirmed_at`. Solo se usa en el registro, para saber si un correo ya existe y si está verificado. Nunca se escribe en ella.

### Relaciones y borrado

- Un Profile tiene un Channel. Un Profile tiene muchos ChatMessage como autor. Un Channel tiene muchos ChatMessage.
- Al borrar un usuario de `auth.users`, Postgres borra en cascada su perfil, su canal, los mensajes de su canal y los que escribió en otros canales (RF-08.1).

### Migraciones

1. `001-profiles`: tabla, FK a `auth.users`, CHECK del username y RLS.
2. `002-channels`: enum, tabla y RLS.
3. `003-chat-messages`: tabla, índice y RLS.

Cada tabla ejecuta `ALTER TABLE … ENABLE ROW LEVEL SECURITY` sin crear políticas (RNF-02). El backend entra como dueño de las tablas, así que RLS no le afecta, pero la API pública de Supabase no puede leerlas.

## 5. Autenticación

### 5.1 Clientes de Supabase (`config/supabase.ts`)

- **`supabaseAdmin`** (secret key): `getClaims`, `admin.updateUserById`, `admin.deleteUser`, `admin.signOut` y Storage.
- **`createPublicClient()`** (publishable key, con `persistSession: false` y `autoRefreshToken: false`): `signUp`, `verifyOtp`, `resend`, `signInWithPassword`, `refreshSession` y `resetPasswordForEmail`.

### 5.2 Middleware `requireAuth`

1. Lee `Authorization: Bearer <token>`. Si falta, responde 401 `UNAUTHORIZED`.
2. Valida el token con `getClaims(token)`. Si falla, 401.
3. Carga el Profile con su Channel usando `claims.sub`. Si no existe, 401.
4. Guarda `req.auth = { userId, email, accessToken, profile, channel }` para el controlador.

### 5.3 Flujos

**Registro (RF-01)** · `POST /api/auth/register`
1. Valida el body y comprueba que el username no esté reservado.
2. Busca el correo en `AuthUser`:
   - Si está verificado, responde 409 `EMAIL_TAKEN`.
   - Si no está verificado, llama a `resend({ type: 'signup' })` y responde 200 `{ status: 'verification_pending' }` (RF-01.4).
3. Si el username ya existe en `profiles`, responde 409 `USERNAME_TAKEN`.
4. Llama a `signUp({ email, password, options: { data: { username } } })`. Supabase envía el OTP.
5. En una transacción crea el Profile (con `display_name` igual al username) y el Channel (con stream key nueva).
6. Si el paso 5 falla, por ejemplo porque otro registro tomó el mismo username un instante antes, borra el usuario recién creado en Supabase y responde 409 `USERNAME_TAKEN`.
7. Responde 201 `{ status: 'verification_pending', email }`.

**Verificar el correo (RF-02.1, RF-02.2)** · `POST /api/auth/verify-email`
- Llama a `verifyOtp({ email, token, type: 'email' })`.
- Si falla, 400 `INVALID_OTP`. Si funciona, 200 con `AuthSession`.

**Reenviar el OTP (RF-02.3, RF-02.4)** · `POST /api/auth/resend-otp`
- Si el correo existe y no está verificado, llama a `resend({ type: 'signup' })`.
- Supabase rechaza con 429 si no pasaron 60 s desde el último envío; el backend responde `TOO_MANY_REQUESTS`.
- En los demás casos responde 200 con el mismo mensaje.

**Login (RF-03)** · `POST /api/auth/login`
- Llama a `signInWithPassword`.
- El error `invalid_credentials` se responde como 401 `INVALID_CREDENTIALS`, y `email_not_confirmed` como 403 `EMAIL_NOT_VERIFIED`.
- Si funciona, 200 con `AuthSession`.

**Renovar tokens (RF-04.3)** · `POST /api/auth/refresh`
- Llama a `refreshSession({ refresh_token })` y responde 200 con `Tokens`. Si falla, 401.

**Cerrar sesión (RF-04.4)** · `POST /api/auth/logout`
- Llama a `admin.signOut(accessToken, 'local')` y responde 204.

**Recuperar la contraseña (RF-05)**
- `POST /api/auth/password/forgot`: llama a `resetPasswordForEmail(email)` y responde siempre 200. Supabase no revela si el correo existe.
- `POST /api/auth/password/reset`:
  1. Llama a `verifyOtp({ email, token, type: 'recovery' })`. Si falla, 400 `INVALID_OTP`.
  2. Guarda la contraseña nueva con `admin.updateUserById`.
  3. Cierra todas las sesiones con `admin.signOut(<token de la verificación>, 'global')`.
  4. Responde 200.

**Comprobar la contraseña actual (para RF-07 y RF-08)**
- El controlador intenta `signInWithPassword` con el correo del usuario. Si falla, 400 `INVALID_CURRENT_PASSWORD`.
- Si funciona, cierra esa sesión de prueba con `admin.signOut(…, 'local')` para no dejar una sesión extra abierta.

**Cambiar la contraseña (RF-07)** · `PUT /api/me/password`
1. Si la nueva es igual a la actual, 400 `SAME_PASSWORD`.
2. Comprueba la contraseña actual.
3. Guarda la nueva con `admin.updateUserById` y responde 204.

**Borrar la cuenta (RF-08)** · `DELETE /api/me`
1. Comprueba la contraseña. El límite de intentos se comparte con RF-07 (sección 10).
2. Si el canal no está `offline`, corta la señal de OBS en MediaMTX.
3. Avisa `channel:deleted` a la sala del canal y saca a todos de ella.
4. Borra los archivos de `avatars/<userId>/` en Storage.
5. Borra el usuario con `admin.deleteUser`. La BD borra en cascada el perfil, el canal y los mensajes.
6. Desconecta todos los sockets del usuario (sala `user:<id>`).
7. Responde 204.

## 6. API REST

Todas las rutas públicas van bajo `/api` y responden JSON. "Auth" significa que exige `Authorization: Bearer <accessToken>`.

| Método | Ruta | Auth | Body | Respuesta | RF |
|---|---|---|---|---|---|
| GET | `/api/health` | — | — | 200 `{ ok: true }` | — |
| POST | `/api/auth/register` | — | `email`, `username`, `password` | 201 o 200 pendiente de verificar | RF-01 |
| POST | `/api/auth/verify-email` | — | `email`, `otp` | 200 `AuthSession` | RF-02.1–2 |
| POST | `/api/auth/resend-otp` | — | `email` | 200 | RF-02.3–4 |
| POST | `/api/auth/login` | — | `email`, `password` | 200 `AuthSession` | RF-03 |
| POST | `/api/auth/refresh` | — | `refreshToken` | 200 `Tokens` | RF-04.3 |
| POST | `/api/auth/logout` | ✓ | — | 204 | RF-04.4 |
| POST | `/api/auth/password/forgot` | — | `email` | 200 | RF-05.1 |
| POST | `/api/auth/password/reset` | — | `email`, `otp`, `newPassword` | 200 | RF-05.2–4 |
| GET | `/api/me` | ✓ | — | 200 `Me` | RF-04.5 |
| PATCH | `/api/me` | ✓ | `username?`, `displayName?`, `bio?` | 200 `Me` | RF-06.1–3 |
| PUT | `/api/me/avatar` | ✓ | multipart, campo `avatar` | 200 `Me` | RF-06.4–5 |
| PUT | `/api/me/password` | ✓ | `currentPassword`, `newPassword` | 204 | RF-07 |
| DELETE | `/api/me` | ✓ | `password` | 204 | RF-08 |
| GET | `/api/stream` | ✓ | — | 200 `StreamDashboard` | RF-09.2 |
| POST | `/api/stream/key` | ✓ | — | 200 `StreamDashboard` | RF-09.3–4 |
| POST | `/api/stream/start` | ✓ | `title?` | 200 `StreamDashboard` | RF-10.1 |
| POST | `/api/stream/stop` | ✓ | — | 200 `StreamDashboard` | RF-10.3 |
| PATCH | `/api/stream` | ✓ | `title` | 200 `StreamDashboard` | RF-10.4 |
| GET | `/api/channels/live` | — | — | 200 `PublicChannel[]` | RF-17 |
| GET | `/api/channels/:username` | — | — | 200 `PublicChannel` | RF-13 |
| POST | `/internal/mediamtx/auth` | secreto | lo envía MediaMTX | 200 o 401 | RF-11 |

**Reglas del stream**
- `start`: pasa de `offline` a `waiting`. Si ya está en `waiting` o `live`, solo actualiza el título, así que llamarlo dos veces no rompe nada.
- `stop`: desde cualquier estado pasa a `offline`, borra `live_started_at`, corta OBS y avisa a la sala.

**Formas de las respuestas**

```ts
type Tokens = { accessToken: string; refreshToken: string; expiresAt: string }
type AuthSession = Tokens & { user: Me }

type Profile = { username: string; displayName: string; bio: string; avatarUrl: string | null }
type ChannelStatus = 'offline' | 'waiting' | 'live'

type Me = {
  id: string
  email: string
  profile: Profile
  channel: { status: ChannelStatus; title: string; liveStartedAt: string | null }
}

type StreamDashboard = {
  status: ChannelStatus
  title: string
  liveStartedAt: string | null
  obs: { server: string; streamKey: string }   // streamKey = "<username>?key=<clave>"
}

type PublicChannel = Profile & {
  title: string
  isLive: boolean
  liveStartedAt: string | null
  viewers: number
  playbackUrl: string | null   // `${HLS_PUBLIC_URL}/live/<username>/index.m3u8`, solo si isLive
}

type ChatMessage = {
  id: string
  content: string
  createdAt: string
  author: { username: string; displayName: string; avatarUrl: string | null }
}
```

**Avatar (RF-06.4)**
- multer guarda el archivo en memoria, con un máximo de 2 MB y solo `image/jpeg`, `image/png` o `image/webp`.
- Se sube a `avatars/<userId>/<timestamp>.<ext>`, se guarda su URL pública y se borran los archivos anteriores de esa carpeta.
- El nombre cambia en cada subida para que el navegador no muestre la imagen vieja desde su caché.
- Al arrancar, el backend crea el bucket público `avatars` si no existe, con el mismo límite de tamaño y de tipos.

**Usernames reservados** (`utils/usernames.ts`): `admin`, `api`, `auth`, `dashboard`, `help`, `internal`, `live`, `login`, `logout`, `me`, `register`, `reset`, `settings`, `signup`, `stream`, `strim`, `support` y `verify`. `live` está reservado porque `/api/channels/live` comparte ruta con `/api/channels/:username`.

## 7. WebSocket (Socket.IO)

**Conexión**
- Usa el mismo puerto que la API, con CORS limitado a `FRONTEND_URL`.
- El token es opcional y se manda en `io(url, { auth: { token } })`.
- Sin token, el socket queda como anónimo, de solo lectura.
- Con token, el servidor lo valida con `getClaims` y carga el perfil:
  - Si falla, rechaza la conexión. El cliente recibe `connect_error` con el mensaje `UNAUTHORIZED` (RF-14.5).
  - Si funciona, guarda `socket.data.user` (incluido el vencimiento `exp` del token) y une el socket a la sala `user:<id>`.

**Salas**
- `channel:<userId del canal>`: el chat de un canal.
- `user:<userId>`: todas las conexiones de un mismo usuario.

**Eventos del cliente al servidor.** Todos responden con un ack `{ ok: true, … }` o `{ ok: false, error: { code, message } }`.

| Evento | Payload | Ack si sale bien | Errores | RF |
|---|---|---|---|---|
| `chat:join` | `{ username }` | `{ channel: PublicChannel, messages: ChatMessage[] }` | `VALIDATION_ERROR`, `NOT_FOUND` | RF-14.1–3 |
| `chat:leave` | — | `{}` | — | RF-14.3 |
| `chat:send` | `{ content }` | `{ message: ChatMessage }` | `AUTH_REQUIRED`, `UNAUTHORIZED`, `NOT_IN_ROOM`, `RATE_LIMITED`, `VALIDATION_ERROR` | RF-15 |

**Eventos del servidor al cliente**

| Evento | Destino | Payload | RF |
|---|---|---|---|
| `chat:message` | Sala del canal | `ChatMessage` | RF-15.1 |
| `stream:status` | Sala del canal | `{ isLive, liveStartedAt, playbackUrl }` | RF-10.3, RF-12 |
| `stream:title` | Sala del canal | `{ title }` | RF-10.4 |
| `stream:state` | Sala `user:<id>` del dueño | `{ status, title, liveStartedAt }` | Dashboard al día |
| `viewers:count` | Sala del canal | `{ viewers }` | RF-16 |
| `channel:deleted` | Sala del canal | `{}` | RF-08.4 |

**Reglas de `chat:join`**
- Saca al socket de la sala anterior, lo une a la nueva y devuelve los últimos 50 mensajes, del más antiguo al más reciente (RF-14.2).

**Reglas de `chat:send`**, en este orden:
1. Si el socket es anónimo, responde `AUTH_REQUIRED`.
2. Si el token venció (`exp`), responde `UNAUTHORIZED`. El cliente debe renovar el token y reconectarse.
3. Si el socket no está en ninguna sala, responde `NOT_IN_ROOM`.
4. Si pasó menos de 1 s desde el último mensaje de ese usuario, responde `RATE_LIMITED`. El control vive en memoria, por usuario.
5. Valida el texto con zod: string, sin espacios en los extremos, de 1 a 300 caracteres.
6. Guarda el mensaje, emite `chat:message` a toda la sala (incluido el autor) y responde el ack.

**Espectadores (RF-16)**
- El número de espectadores es el tamaño de la sala `channel:<id>`, con o sin sesión.
- Cada `join`, `leave` o desconexión marca la sala como cambiada. Cada 5 s se emite `viewers:count` solo a las salas cambiadas.
- Los endpoints REST leen ese mismo número.

**Notas para el frontend**
- Al renovar el access token, reconectar el socket con el token nuevo y volver a emitir `chat:join`.
- Pintar el texto del chat como texto, nunca como HTML.

## 8. Streaming con MediaMTX

### 8.1 Docker Compose

```yaml
services:
  mediamtx:
    image: bluenviron/mediamtx:<versión 1.x fijada al implementar>
    restart: unless-stopped
    ports:
      - "1935:1935"             # RTMP para OBS
      - "8888:8888"             # HLS para los navegadores
      - "127.0.0.1:9997:9997"   # API, solo accesible desde esta máquina
    volumes:
      - ./mediamtx/mediamtx.yml:/mediamtx.yml:ro
    environment:
      MTX_AUTHHTTPADDRESS: http://host.docker.internal:${PORT}/internal/mediamtx/auth?secret=${MEDIAMTX_SECRET}
    extra_hosts:
      - "host.docker.internal:host-gateway"
```

Docker Compose lee `PORT` y `MEDIAMTX_SECRET` del mismo `backend/.env`, así el secreto se define en un solo lugar. La API de MediaMTX no tiene autenticación, por eso solo escucha en `127.0.0.1`.

### 8.2 `mediamtx.yml`

```yaml
rtmp: yes        # :1935
hls: yes         # :8888, con CORS para el origen del frontend
api: yes         # :9997
rtsp: no
webrtc: no
srt: no

authMethod: http
# authHTTPAddress llega por la variable MTX_AUTHHTTPADDRESS
authHTTPExclude:
  - action: read       # ver es público (RF-11.2)
  - action: playback
  - action: api
  - action: metrics
  - action: pprof

paths:
  "~^live/[a-z0-9_]{3,20}$": {}   # cualquier otra ruta se rechaza
```

Los nombres exactos de las claves se confirman con la versión de MediaMTX que se fije al implementar.

### 8.3 Autorizar la señal (RF-11)

MediaMTX hace `POST /internal/mediamtx/auth?secret=…` con un JSON que trae `action`, `path`, `query`, `protocol` e `ip`.

1. Si el secreto no coincide, el middleware `internalSecret` responde 401.
2. Si `action` es `read` o `playback`, responde 200.
3. Si `action` es `publish`, toma el username de `path` (`live/<username>`) y la clave de `query` (`key=<streamKey>`). Responde 200 solo si el canal existe, la clave coincide (comparación en tiempo constante) y el estado es `waiting` o `live`. Si no, 401.
4. Cualquier otra acción recibe 401.

### 8.4 Monitor de señales (RF-12)

Corre cada 3 s, y una vez al arrancar el backend (RF-12.3):

1. Pide `GET /v3/paths/list` y se queda con las rutas `live/<username>` que tienen `ready: true`.
2. Un canal en `waiting` que tiene señal pasa a `live` con `live_started_at` igual a la hora actual. Se avisa `stream:status` y `stream:state`.
3. Un canal en `live` sin señal vuelve a `waiting` y se borra `live_started_at`. Se avisa igual (RF-12.2).
4. Un canal en `offline` que tiene señal (por ejemplo, porque falló el corte al finalizar) recibe otro corte.
5. Si MediaMTX no responde, se registra en el log y no se cambia ningún estado.

### 8.5 Cortar OBS (RF-10.3, RF-08.4)

`kickPublisher(username)` busca la ruta `live/<username>` en `/v3/paths/list`. Si su fuente es una conexión RTMP, llama a `POST /v3/rtmpconns/kick/<id>`. OBS intentará reconectarse, pero se le rechazará porque el canal ya está `offline`.

### 8.6 Datos para OBS (RF-09.2)

El dashboard muestra:
- **Servicio:** Personalizado.
- **Servidor:** `RTMP_PUBLIC_URL`, que en local es `rtmp://localhost:1935/live`.
- **Clave de retransmisión:** `<username>?key=<streamKey>`.

Se recomienda un intervalo de fotogramas clave de 2 s en OBS: reduce el retraso del HLS.

## 9. Errores

Todas las respuestas de error tienen la forma `{ "error": { "code", "message", "details"? } }`.

Los controladores lanzan `AppError(status, code, message?, details?)`, y `errorHandler` convierte cada error así:
- **`AppError`:** se responde tal cual.
- **`ZodError`:** 400 `VALIDATION_ERROR`, con `details` como `{ campo: mensaje }`.
- **`MulterError` por tamaño:** 400 `INVALID_FILE`.
- **`UniqueConstraintError` de Sequelize:** 409 (`USERNAME_TAKEN` si el campo es el username).
- **Cualquier otro error:** 500 `INTERNAL_ERROR`. La traza va al log y solo se incluye en la respuesta en desarrollo.

| Código | HTTP | Mensaje |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Hay datos inválidos. |
| `INVALID_OTP` | 400 | El código es incorrecto o venció. |
| `INVALID_CURRENT_PASSWORD` | 400 | La contraseña actual no es correcta. |
| `SAME_PASSWORD` | 400 | La nueva contraseña debe ser distinta de la actual. |
| `INVALID_FILE` | 400 | El avatar debe ser JPG, PNG o WebP de hasta 2 MB. |
| `UNAUTHORIZED` | 401 | Tu sesión no es válida o venció. |
| `INVALID_CREDENTIALS` | 401 | Correo o contraseña incorrectos. |
| `EMAIL_NOT_VERIFIED` | 403 | Verifica tu correo para iniciar sesión. |
| `NOT_FOUND` | 404 | No encontrado. |
| `EMAIL_TAKEN` | 409 | Ese correo ya está registrado. |
| `USERNAME_TAKEN` | 409 | Ese nombre de usuario ya está en uso. |
| `CHANNEL_LIVE` | 409 | No puedes hacer esto mientras tu stream está activo. |
| `PAYLOAD_TOO_LARGE` | 413 | La petición es demasiado grande. |
| `TOO_MANY_REQUESTS` | 429 | Demasiados intentos. Espera un momento. |
| `INTERNAL_ERROR` | 500 | Algo salió mal. |
| `EMAIL_NOT_SENT` | 503 | No pudimos enviar el correo. Intenta de nuevo en unos minutos. |

Errores que solo aparecen en el socket:
- `AUTH_REQUIRED`: Inicia sesión para comentar.
- `RATE_LIMITED`: Vas muy rápido.
- `NOT_IN_ROOM`: Únete a un canal antes de escribir.

## 10. Seguridad

- **HTTP:** helmet, CORS limitado a `FRONTEND_URL` y body JSON de hasta 10 kB.
- **Límites de intentos** (express-rate-limit):
  - Rutas `/api/auth/*`: 10 peticiones por minuto por IP.
  - Cambiar la contraseña y borrar la cuenta comparten la misma instancia del limitador: 5 fallos cada 15 min por usuario. Usa el id del usuario como clave y no cuenta las peticiones exitosas.
- **Secretos:** la secret key de Supabase y `MEDIAMTX_SECRET` solo existen en el `.env` del backend. El frontend no habla con Supabase directamente.
- **Base de datos:** RLS activado sin políticas en las tres tablas.
- **Stream key:** solo sale en las respuestas de `/api/stream`. Se compara en tiempo constante.
- **Rutas internas:** `/internal` no está bajo `/api` y exige el secreto. En producción el proxy no debe exponerla.

## 11. Variables de entorno

| Variable | Ejemplo | Uso |
|---|---|---|
| `NODE_ENV` | `development` | Modo de ejecución. |
| `PORT` | `4000` | API y Socket.IO. |
| `FRONTEND_URL` | `http://localhost:5173` | CORS. |
| `DATABASE_URL` | `postgresql://postgres.<ref>:<pass>@aws-0-<región>.pooler.supabase.com:5432/postgres` | Sequelize, por el Session pooler con SSL. |
| `SUPABASE_URL` | `https://<ref>.supabase.co` | Clientes de Supabase. |
| `SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_…` | Cliente público. |
| `SUPABASE_SECRET_KEY` | `sb_secret_…` | Cliente admin. |
| `MEDIAMTX_API_URL` | `http://127.0.0.1:9997` | Monitor y cortes. |
| `MEDIAMTX_SECRET` | valor aleatorio largo | Rutas internas. |
| `RTMP_PUBLIC_URL` | `rtmp://localhost:1935/live` | Dato para OBS. |
| `HLS_PUBLIC_URL` | `http://localhost:8888` | URL de reproducción. |

- Las claves antiguas `anon` y `service_role` también sirven en las dos variables de claves.
- Se usa el Session pooler porque la conexión directa de Supabase solo funciona por IPv6.
- Si falta una variable o tiene un formato inválido, `config/env.ts` detiene el arranque con un mensaje claro (RNF-08).

## 12. Configuración de Supabase (una sola vez)

Los nombres de los menús pueden variar un poco según la versión del panel.

1. Crear el proyecto y copiar la URL, las dos claves y la cadena de conexión del Session pooler.
2. **Authentication → Providers → Email:** proveedor activado, "Confirm email" activado, contraseña mínima de 8 caracteres, OTP de 6 dígitos y vencimiento de 600 s.
3. **Authentication → Email Templates:** en "Confirm signup" y "Reset password", reemplazar el enlace por el código `{{ .Token }}`.
4. **Authentication → Emails → SMTP Settings:** configurar un SMTP propio (por ejemplo Resend con dominio propio, o Gmail con contraseña de aplicación). Es obligatorio: sin él Supabase no deja editar las plantillas del paso 3.
5. **Storage:** no hace falta crear nada a mano; el backend crea el bucket `avatars` al arrancar.

## 13. Scripts y dependencias

| Script | Comando |
|---|---|
| `dev` | `tsx watch src/server.ts` |
| `build` | `tsc` |
| `start` | `node dist/server.js` |
| `typecheck` | `tsc --noEmit` |
| `db:migrate` | `tsx src/database/migrate.ts up` |
| `db:rollback` | `tsx src/database/migrate.ts down` |
| `media:up` | `docker compose up -d` |
| `media:down` | `docker compose down` |

- **Dependencias:** `express@5`, `cors`, `helmet`, `morgan`, `express-rate-limit`, `multer`, `zod`, `socket.io`, `@supabase/supabase-js`, `sequelize`, `sequelize-typescript`, `reflect-metadata`, `pg`, `umzug` y `dotenv`.
- **Desarrollo:** `typescript`, `tsx`, `@types/node`, `@types/express`, `@types/cors`, `@types/morgan` y `@types/multer`.
- Las llamadas a MediaMTX usan el `fetch` que ya trae Node 22.

## 14. Riesgos y limitaciones conocidas

| Tema | Detalle |
|---|---|
| Tokens ya emitidos | Después de cerrar sesión o restablecer la contraseña, el access token ya emitido sigue sirviendo hasta que vence (1 h por defecto en Supabase). Los refresh tokens sí se invalidan al instante. Si molesta, se puede bajar el vencimiento del JWT a 15 min en Supabase. |
| Límites en memoria | Los contadores de intentos y de mensajes se reinician si el backend se reinicia. Alcanza para una sola instancia (RNF-11). |
| Stream key en texto plano | Se guarda así porque el dashboard tiene que mostrarla. La protegen RLS y que solo se entrega a su dueño. |
| Retraso del estado | El paso a `live` puede tardar hasta 3 s en verse, más el retraso propio del HLS. |
| Espectadores | Se cuentan conexiones: dos pestañas abiertas son dos espectadores. |
| Calidad | MediaMTX no transcodifica: todos ven la calidad que envía OBS. |

## 15. Cobertura de los requerimientos no funcionales

| RNF | Cómo se cumple |
|---|---|
| RNF-01 · MVC | Estructura y reglas de la sección 3. |
| RNF-02 · Datos | Migraciones con Umzug, RLS sin políticas y borrado en cascada (sección 4). |
| RNF-03 · Autenticación y secretos | Supabase Auth, `requireAuth` y validación del socket (secciones 5 y 7). Los secretos solo están en el `.env` del backend (sección 10). |
| RNF-04 · Contraseñas | Un esquema zod compartido, `passwordSchema`: de 8 a 72 caracteres, con al menos una letra y un número. Lo usan el registro, el reset y el cambio de contraseña. Supabase también exige 8 como mínimo (sección 12). |
| RNF-05 · Validación | Middleware `validate` con zod para body, params y query, y el mismo enfoque en cada evento del socket. |
| RNF-06 · Errores | `AppError`, `errorHandler` y el catálogo de la sección 9. |
| RNF-07 · Seguridad HTTP | helmet, CORS, límites de intentos y tamaño de body (sección 10). |
| RNF-08 · Configuración | `config/env.ts` valida el `.env` al arrancar. `.env.example` se versiona. |
| RNF-09 · Formato de la API | Prefijo `/api`, DTOs en camelCase y fechas con `toISOString()` (UTC). |
| RNF-10 · Desarrollo local | `npm run dev` para la API y `npm run media:up` para MediaMTX (sección 13). |
| RNF-11 · Escala | Una instancia, sin Redis. Límites y espectadores en memoria (sección 14). |
| RNF-12 · Logs | `morgan` escribe una línea por petición, y `errorHandler` registra cada error 500 con su traza. |
