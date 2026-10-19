# Strim · Backend

API REST, chat en tiempo real y control de streams de **Strim**, una app de streaming minimalista: se transmite desde OBS y solo los usuarios con sesión pueden comentar.

**Stack:** Express 5 + TypeScript · Sequelize sobre PostgreSQL de Supabase · Supabase Auth (OTP por correo) · Socket.IO · MediaMTX en Docker (RTMP de entrada, HLS de salida).

La especificación completa está en [`specs/`](specs/): [requerimientos](specs/requirements.md), [diseño](specs/design.md) y [tareas](specs/tasks.md).

## Requisitos

- Node.js 22
- Docker Desktop
- Un proyecto de Supabase configurado como se explica abajo
- OBS Studio, para transmitir

## Puesta en marcha

```bash
npm install
cp .env.example .env    # y completa los valores
npm run db:migrate      # crea las tablas en Supabase
npm run media:up        # levanta MediaMTX
npm run dev             # API y chat en http://localhost:4000
```

Comprueba que responda: `GET http://localhost:4000/api/health` → `{ "ok": true }`.

### Variables de entorno

| Variable | De dónde sale |
|---|---|
| `PORT` | Puerto de la API y del chat (por defecto `4000`). |
| `FRONTEND_URL` | Origen del frontend permitido por CORS, por ejemplo `http://localhost:5173`. |
| `DATABASE_URL` | Supabase → **Connect** → **Session pooler**, con la contraseña de la base. No uses la conexión directa: solo funciona por IPv6. |
| `SUPABASE_URL` | Supabase → Project Settings → API. |
| `SUPABASE_PUBLISHABLE_KEY` | Supabase → Project Settings → API Keys (`sb_publishable_…`). |
| `SUPABASE_SECRET_KEY` | Supabase → Project Settings → API Keys → Secret keys (`sb_secret_…`). No se comparte nunca con el frontend. |
| `MEDIAMTX_SECRET` | Un valor aleatorio de 32 caracteres o más: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` |
| `MEDIAMTX_API_URL`, `RTMP_PUBLIC_URL`, `HLS_PUBLIC_URL` | Para correr en local, deja los valores de `.env.example`. |

Si falta una variable o tiene un formato inválido, la API no arranca y dice cuál es.

### Configurar Supabase (una sola vez)

1. **Authentication → Sign In / Providers → Email:**
   - Confirm email: activado.
   - Email OTP Length: `6`.
   - Email OTP Expiration: `600`.
   - Minimum password length: `8`.
2. **Authentication → Emails → SMTP Settings:** configura un SMTP propio. Es obligatorio, porque sin él Supabase no deja editar las plantillas. Con Gmail: host `smtp.gmail.com`, puerto `465`, usuario tu Gmail y una [contraseña de aplicación](https://myaccount.google.com/apppasswords), no la contraseña normal.
3. **Authentication → Emails → Templates:** en **Confirm sign up** y **Reset password**, pega en la vista *Source* el contenido de [`supabase/email-templates/`](supabase/email-templates/). Así el correo trae el código de 6 dígitos (`{{ .Token }}`) en vez de un enlace.
4. **Storage:** no hace falta crear nada a mano: la API crea el bucket público `avatars` al arrancar.

## Transmitir con OBS

1. Con sesión iniciada, pulsa **Iniciar stream** (`POST /api/stream/start`). Mientras el canal esté `offline`, OBS es rechazado.
2. `GET /api/stream` devuelve los datos para OBS, en `obs.server` y `obs.streamKey`.
3. En OBS → **Ajustes → Emisión**, configura:
   - **Servicio:** Personalizado.
   - **Servidor:** el valor de `obs.server`, que en local es `rtmp://localhost:1935/live`.
   - **Clave de retransmisión:** el valor de `obs.streamKey`, con la forma `tu_usuario?key=…`.
4. Recomendado: en **Salida**, intervalo de fotogramas clave de `2` s, para que el HLS tenga menos retraso.
5. El canal pasa a `live` en unos segundos. El video se ve en el `playbackUrl` del canal (HLS) o en el reproductor de MediaMTX: `http://localhost:8888/live/<tu_usuario>`.
6. **Finalizar stream** (`POST /api/stream/stop`) corta la señal de OBS.

Si OBS se corta por accidente, el canal vuelve a `waiting` y OBS puede reconectarse sin pulsar "Iniciar" otra vez.

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run dev` | API con recarga en caliente. |
| `npm run build` / `npm start` | Compila a `dist/` y lo ejecuta. |
| `npm run typecheck` | Revisa los tipos sin compilar. |
| `npm run db:migrate` / `npm run db:rollback` | Aplica todas las migraciones pendientes / revierte la última. |
| `npm run media:up` / `npm run media:down` | Levanta o apaga MediaMTX en Docker. |

## API

Todas las rutas van bajo `/api` y responden JSON. Las que tienen 🔒 exigen `Authorization: Bearer <accessToken>`. Los errores tienen la forma `{ "error": { "code", "message", "details"? } }`.

| Grupo | Rutas |
|---|---|
| Cuenta | `POST /auth/register`, `/auth/verify-email`, `/auth/resend-otp`, `/auth/login`, `/auth/refresh`, `/auth/logout` 🔒, `/auth/password/forgot`, `/auth/password/reset` |
| Perfil 🔒 | `GET /me`, `PATCH /me`, `PUT /me/avatar`, `PUT /me/password`, `DELETE /me` |
| Dashboard 🔒 | `GET /stream`, `PATCH /stream`, `POST /stream/start`, `/stream/stop`, `/stream/key` |
| Público | `GET /channels/live`, `GET /channels/:username` |

El detalle de cada ruta (body, respuesta y errores) está en la sección 6 de [`specs/design.md`](specs/design.md). Para probarlas a mano usa [`requests.http`](requests.http), con la extensión REST Client de VS Code.

## Chat (Socket.IO)

- **Conexión:** en el mismo puerto que la API.
  - Sin token, el socket es anónimo y solo puede leer.
  - Con token: `io('http://localhost:4000', { auth: { token: accessToken } })`.
  - Si el token es inválido, la conexión se rechaza con `connect_error` `UNAUTHORIZED`. Cuando el token se renueve, hay que reconectar con el nuevo y volver a unirse al canal.
- **Eventos del cliente:** responden con un ack `{ ok: true, … }` o `{ ok: false, error }`.
  - `chat:join { username }` → canal y últimos 50 mensajes.
  - `chat:leave`.
  - `chat:send { content }`: requiere sesión, máximo 1 mensaje por segundo y de 1 a 300 caracteres.
- **Eventos del servidor:**
  - `chat:message`, `stream:status`, `stream:title`, `viewers:count` (cada 5 s) y `channel:deleted`: a toda la sala del canal.
  - `stream:state`: solo al dueño del canal.

El texto del chat es texto plano: el frontend debe mostrarlo como texto, nunca como HTML.

## Estructura

```
src/
├── models/        M · Profile, Channel, ChatMessage, AuthUser (solo lectura)
├── controllers/   C · auth, me, stream, channels, mediamtx, chat
├── routes/        V · rutas de Express (responden JSON)
├── sockets/       Socket.IO: conexión, eventos y avisos a las salas
├── jobs/          monitor que sincroniza el estado de los canales con MediaMTX
├── middlewares/   auth, validación, límites de intentos, subida de archivos, errores
├── validators/    esquemas zod
├── config/        .env, Supabase y API de MediaMTX
└── database/      Sequelize y migraciones (Umzug)
```

## Problemas comunes

| Síntoma | Causa y solución |
|---|---|
| `getaddrinfo ENOTFOUND db.<ref>.supabase.co` | Estás usando la conexión directa, que solo funciona por IPv6. Usa la URI del **Session pooler**. |
| El registro responde `EMAIL_NOT_SENT` | El SMTP de Supabase falla. Con Gmail, el error `535` significa que hay que usar una contraseña de aplicación. |
| El correo trae un enlace en vez de un código | Faltan las plantillas del paso 3 de "Configurar Supabase". |
| El código que llega tiene 8 dígitos | Pon **Email OTP Length** en `6`. La API acepta de 6 a 10, pero la especificación usa 6. |
| `El puerto 4000 ya está en uso` | Ya hay otra API corriendo: ciérrala o cambia `PORT`. |
| OBS no conecta | El canal no está iniciado (pulsa **Iniciar stream**), la clave cambió, MediaMTX está apagado (`npm run media:up`) o la API está apagada: MediaMTX le pregunta a la API antes de aceptar la señal. |
