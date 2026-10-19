# Strim · Backend — Tareas

> **SDD fase 3 de 3** (Requerimientos → Diseño → Tareas)
> Estado: **aprobado**, en implementación · Fecha: 2026-10-18
> Parte de [requirements.md](requirements.md) v2 y [design.md](design.md), ambos aprobados.

**Cómo se usa este documento**
- Las tareas van en orden y cada una se apoya en las anteriores.
- Una tarea se marca `[x]` cuando su **Verificación** pasa.
- Las pruebas manuales se agregan a `requests.http` a medida que se avanza (D6).
- Las tareas marcadas **[tú]** las haces tú, porque usan tus cuentas o credenciales.

---

## Fase 0 · Preparación

- [x] **0.1 [tú] Proyecto de Supabase** · proyecto `strim` (efqygfvcnkfxilubxrwy) creado con el MCP
  - Crear el proyecto y configurarlo según la sección 12 del diseño: correo con confirmación, OTP de 6 dígitos que vence en 600 s, plantillas con `{{ .Token }}` y contraseña mínima de 8.
  - Pasarme (o pegar en `backend/.env` cuando exista) `SUPABASE_URL`, las dos claves y la cadena del Session pooler.
  - _Diseño §12_

- [x] **0.2 [tú] SMTP propio** · Gmail con contraseña de aplicación
  - Crear una cuenta en Resend (u otro SMTP) y configurarla en Supabase.
  - **Obligatorio antes de probar la Fase 2:** sin SMTP propio Supabase no deja editar las plantillas, y el correo llega con un enlace en vez del código. Sin dominio propio, la opción más simple es Gmail con una contraseña de aplicación.
  - _Requerimientos §8_

- [ ] **0.3 [tú] Herramientas locales**
  - Docker Desktop abierto y OBS instalado.

## Fase 1 · Base del proyecto

- [x] **1. Inicializar el proyecto**
  - Crear `package.json` con los scripts y las dependencias de la sección 13 del diseño.
  - Crear `tsconfig.json`: modo estricto, CommonJS, `experimentalDecorators`, `emitDecoratorMetadata` y salida en `dist/`.
  - Crear `.gitignore` (con `node_modules`, `dist` y `.env`) y `.env.example` con todas las variables de la sección 11 del diseño.
  - **Verificación:** `npm install` y `npm run typecheck` terminan sin errores.
  - _RNF-08, RNF-10_

- [x] **2. Variables de entorno**
  - `src/config/env.ts`: carga `.env` con dotenv, lo valida con zod y exporta un objeto `env` con tipos.
  - **Verificación:** si se borra una variable del `.env`, el arranque se detiene con un mensaje que nombra la variable que falta.
  - _RNF-08_

- [x] **3. Express base y manejo de errores**
  - `src/app.ts`: helmet, CORS hacia `FRONTEND_URL`, `express.json({ limit: '10kb' })`, morgan y `GET /api/health`.
  - `src/utils/AppError.ts`, `src/middlewares/errorHandler.ts` (todas las conversiones de la sección 9 del diseño) y `src/middlewares/validate.ts` (zod para body, params y query).
  - Las rutas que no existen responden 404 `NOT_FOUND`.
  - `src/server.ts`: crea el servidor HTTP y escucha en `PORT`.
  - **Verificación:**
    - `GET /api/health` responde 200 `{ ok: true }`.
    - Una ruta inventada responde 404 con el formato `{ error: { code, message } }`.
  - _RNF-05, RNF-06, RNF-07, RNF-09, RNF-12_

- [x] **4. Base de datos y migraciones**
  - `src/database/index.ts`: Sequelize con `DATABASE_URL` y SSL.
  - `src/database/migrate.ts`: CLI de Umzug con `up` y `down`.
  - Migraciones `001-profiles`, `002-channels` y `003-chat-messages`, con FK a `auth.users`, CHECK del username, enum `channel_status`, índice del chat y RLS en las tres tablas.
  - **Verificación:**
    - `npm run db:migrate` crea las tres tablas, y en el panel de Supabase aparecen con RLS activado.
    - `npm run db:rollback` (tres veces) las borra, y `npm run db:migrate` las vuelve a crear.
  - _RNF-02 · Diseño §4_

- [x] **5. Modelos**
  - `src/models/`: `Profile`, `Channel`, `ChatMessage` y `AuthUser` (solo lectura, en `auth.users`), con sus relaciones y un `DataType` explícito en cada `@Column`.
  - Métodos para las respuestas: `toProfile()`, `toPublic(viewers)`, `toDashboard()` y `toMessage()`, con las formas de la sección 6 del diseño.
  - `src/utils/streamKey.ts` (genera una clave y la compara en tiempo constante) y `src/utils/usernames.ts` (lista de reservados).
  - **Verificación:** `npm run typecheck` pasa, y el servidor arranca y registra los modelos sin errores.
  - _RF-09.1, RNF-01_

- [x] **6. Clientes de Supabase y bucket de avatares**
  - `src/config/supabase.ts`: `supabaseAdmin` y `createPublicClient()`.
  - Al arrancar, el servidor crea el bucket público `avatars` si no existe (2 MB, JPG/PNG/WebP).
  - **Verificación:** después del primer arranque, el bucket `avatars` aparece en Storage. Un segundo arranque no da error.
  - _RF-06.4 · Diseño §5.1_

## Fase 2 · Cuentas

- [x] **7. Registro y verificación con OTP**
  - `src/validators/auth.ts`: `emailSchema`, `usernameSchema` (formato y reservados) y `passwordSchema` (RNF-04).
  - `src/middlewares/rateLimits.ts`: `authLimiter`, de 10 peticiones por minuto por IP.
  - `src/controllers/auth.controller.ts`: `register`, `verifyEmail` y `resendOtp`, siguiendo los flujos de la sección 5.3 del diseño.
  - Una función que arma `AuthSession` a partir de la sesión de Supabase y el perfil.
  - `src/routes/auth.routes.ts` y `src/routes/index.ts`.
  - **Verificación:**
    - Un registro nuevo responde 201 y el código llega al correo.
    - `verify-email` con ese código responde 200 con tokens.
    - Un código incorrecto responde `INVALID_OTP`.
    - Registrarse otra vez con un correo verificado responde `EMAIL_TAKEN`.
    - Registrarse otra vez con un correo sin verificar reenvía el código.
    - Un username repetido responde `USERNAME_TAKEN`, y uno reservado (`live`) responde `VALIDATION_ERROR`.
    - Dos reenvíos seguidos: el segundo responde `TOO_MANY_REQUESTS`.
  - _RF-01, RF-02, RNF-04_

- [x] **8. Login, sesión y `GET /api/me`**
  - `login`, `refresh` y `logout` en el controlador de auth.
  - `src/middlewares/requireAuth.ts` (diseño §5.2).
  - `src/controllers/me.controller.ts`: `getMe`. `src/routes/me.routes.ts`.
  - **Verificación:**
    - Login correcto responde tokens. Contraseña mala responde `INVALID_CREDENTIALS`. Una cuenta sin verificar responde `EMAIL_NOT_VERIFIED`.
    - `GET /api/me` sin token, o con un token alterado, responde 401. Con un token válido devuelve el `Me`, sin la stream key.
    - `refresh` devuelve un par de tokens nuevo.
    - Después de `logout`, el refresh token anterior ya no sirve.
  - _RF-03, RF-04_

- [x] **9. Recuperar la contraseña**
  - `forgotPassword` y `resetPassword` en el controlador de auth.
  - **Verificación:**
    - `forgot` responde lo mismo para un correo que existe y para uno que no.
    - Llega el código. `reset` con ese código y una contraseña nueva responde 200.
    - El refresh token anterior deja de servir. Login con la contraseña nueva funciona y con la vieja no.
    - Un código incorrecto responde `INVALID_OTP`.
  - _RF-05_

- [x] **10. Editar el perfil y el avatar**
  - `updateMe` (PATCH): display name, bio y username, con la regla `CHANNEL_LIVE` cuando el canal no está `offline`.
  - `src/middlewares/upload.ts` (multer: memoria, 2 MB, tres tipos) y `uploadAvatar` (diseño §6, sección "Avatar").
  - **Verificación:**
    - Cambiar el display name y la bio se refleja en `GET /api/me`.
    - Un username tomado responde `USERNAME_TAKEN`.
    - Subir un PNG actualiza `avatarUrl` y deja un solo archivo en `avatars/<id>/`.
    - Un PDF, o una imagen de 3 MB, responde `INVALID_FILE`.
  - _RF-06_

- [x] **11. Cambiar la contraseña**
  - `sensitiveLimiter`: 5 fallos cada 15 min por usuario.
  - Una función que comprueba la contraseña actual y cierra la sesión de prueba (diseño §5.3).
  - `changePassword` (PUT `/api/me/password`).
  - **Verificación:**
    - Con la contraseña actual correcta responde 204, y la nueva sirve para iniciar sesión.
    - Con una incorrecta responde `INVALID_CURRENT_PASSWORD` y la sesión sigue activa.
    - Si la nueva es igual a la actual responde `SAME_PASSWORD`.
    - El sexto fallo seguido responde `TOO_MANY_REQUESTS`.
  - _RF-07_

## Fase 3 · Tiempo real (base)

- [x] **12. Socket.IO base**
  - `src/sockets/index.ts`: Socket.IO en el mismo servidor HTTP, con CORS.
  - Middleware de conexión: sin token entra como anónimo; con token se valida con `getClaims`, se carga el perfil y el socket entra a la sala `user:<id>`; con token inválido se rechaza con `UNAUTHORIZED`.
  - `src/sockets/emit.ts`: `emitToChannel`, `emitToUser`, `getViewers(channelId)` y `disconnectUser(userId)`, para usarlas desde los controladores.
  - **Verificación** (con un script corto de `socket.io-client` o desde la consola del navegador):
    - Conectar sin token funciona.
    - Conectar con un token válido funciona.
    - Conectar con un token alterado devuelve `connect_error` con el mensaje `UNAUTHORIZED`.
  - _RF-14.4, RF-14.5_

## Fase 4 · Streaming

- [x] **13. MediaMTX en Docker**
  - `docker-compose.yml` y `mediamtx/mediamtx.yml` (diseño §8.1 y §8.2), con la última versión 1.x estable fijada. Confirmar los nombres de las claves para esa versión.
  - `src/config/mediamtx.ts`: `listReadyPaths()` y `kickPublisher(username)`.
  - **Verificación:**
    - `npm run media:up` levanta el contenedor.
    - `http://127.0.0.1:9997/v3/paths/list` responde.
    - El puerto 9997 no se ve desde otra máquina de la red.
  - _D7, RNF-10 · Diseño §8_

- [x] **14. Dashboard del stream**
  - `src/controllers/stream.controller.ts` y `src/routes/stream.routes.ts`:
    - `GET /api/stream`.
    - `POST /api/stream/key`, con `CHANNEL_LIVE` si el canal no está `offline`.
    - `POST /api/stream/start`, idempotente.
    - `POST /api/stream/stop`: corta OBS y avisa `stream:status` y `stream:state`.
    - `PATCH /api/stream`: avisa `stream:title`.
  - **Verificación:**
    - `GET /api/stream` devuelve `obs.server` y `obs.streamKey` con la forma `<username>?key=…`.
    - Regenerar la clave la cambia.
    - `start` pasa el canal a `waiting`, y `stop` lo vuelve a `offline`.
    - Regenerar la clave en `waiting` responde `CHANNEL_LIVE`.
  - _RF-09, RF-10_

- [x] **15. Autorizar la señal de OBS**
  - `src/middlewares/internalSecret.ts`, `src/controllers/mediamtx.controller.ts` y `src/routes/internal.routes.ts`, montadas en `/internal` (diseño §8.3).
  - **Verificación con OBS:**
    - Con el canal en `offline`, OBS es rechazado.
    - Después de `start`, OBS conecta.
    - Con una clave incorrecta, OBS es rechazado.
    - El stream se ve en `http://localhost:8888/live/<username>`, el reproductor que trae MediaMTX.
    - Llamar a la ruta interna sin el secreto responde 401.
  - _RF-11_

- [x] **16. Monitor de señales**
  - `src/jobs/streamMonitor.ts` (diseño §8.4). Arranca desde `server.ts` con una primera pasada inmediata.
  - **Verificación:**
    - Con OBS transmitiendo, el canal pasa a `live` en 3 s o menos.
    - Al detener OBS, el canal vuelve a `waiting`.
    - Si se reinicia el backend con OBS transmitiendo, el canal sigue en `live`.
    - `stop` en vivo corta OBS y el canal queda en `offline`.
    - Si se apaga MediaMTX, el backend no cambia ningún estado y solo lo registra en el log.
  - _RF-12, RF-10.3_

- [x] **17. Canales públicos**
  - `src/controllers/channels.controller.ts` y `src/routes/channels.routes.ts`: `GET /api/channels/live` (antes que `/:username`) y `GET /api/channels/:username`.
  - **Verificación:**
    - Un canal en vivo devuelve `isLive: true` y su `playbackUrl` (que reproduce en VLC).
    - Un canal desconectado devuelve `playbackUrl: null`.
    - Un username que no existe responde 404.
    - `/live` solo lista los canales en vivo.
    - Ninguna respuesta incluye el correo ni la stream key.
  - _RF-13, RF-17_

## Fase 5 · Chat

- [x] **18. Unirse a un chat y ver el historial**
  - `src/controllers/chat.controller.ts`: `join` y `leave`, conectados en `sockets/index.ts`, con validación zod del payload.
  - **Verificación:**
    - `chat:join` devuelve el canal y hasta 50 mensajes, del más antiguo al más reciente.
    - Un username inexistente responde `NOT_FOUND`.
    - Unirse a otro canal saca al socket de la sala anterior.
    - Funciona aunque el canal no esté en vivo.
  - _RF-14_

- [x] **19. Enviar mensajes**
  - `send` en el controlador del chat, con las reglas de la sección 7 del diseño, en orden.
  - **Verificación:**
    - Un anónimo recibe `AUTH_REQUIRED` y nadie ve su mensaje.
    - Un usuario con sesión: todos en la sala reciben `chat:message`, con el autor incluido.
    - Dos mensajes en menos de 1 s: el segundo recibe `RATE_LIMITED`.
    - Un texto vacío o de 301 caracteres recibe `VALIDATION_ERROR`.
    - `<b>hola</b>` se guarda y llega tal cual, como texto.
  - _RF-15_

- [x] **20. Contador de espectadores**
  - Marcar las salas cambiadas en `join`, `leave` y `disconnect`, y emitir `viewers:count` cada 5 s solo a esas salas.
  - Usar `getViewers` en las respuestas REST.
  - **Verificación:** al abrir y cerrar pestañas, el número cambia en el siguiente aviso (como mucho 5 s) y coincide con `GET /api/channels/:username`.
  - _RF-16_

## Fase 6 · Cierre

- [ ] **21. Borrar la cuenta**
  - `deleteMe` (DELETE `/api/me`), con `sensitiveLimiter` y los pasos de la sección 5.3 del diseño.
  - **Verificación:**
    - Con la contraseña incorrecta responde `INVALID_CURRENT_PASSWORD` y no borra nada.
    - Con la correcta y transmitiendo en vivo:
      - OBS se corta.
      - La sala recibe `channel:deleted`.
      - Los sockets del usuario se desconectan.
      - El avatar desaparece de Storage.
      - Las filas de `profiles`, `channels` y `chat_messages` del usuario ya no existen.
      - Su token responde 401.
    - Se puede registrar otra cuenta con el mismo correo y el mismo username.
  - _RF-08_

- [ ] **22. Pruebas completas y README**
  - Completar `requests.http` con todos los endpoints, en el orden de un uso real.
  - `backend/README.md` corto: requisitos, cómo llenar el `.env`, `npm run media:up`, `npm run db:migrate`, `npm run dev` y cómo configurar OBS.
  - **Verificación** (de punta a punta):
    1. Registro y OTP.
    2. Login.
    3. Editar el perfil y subir un avatar.
    4. Dashboard: iniciar el stream y transmitir con OBS.
    5. Ver el stream por HLS.
    6. Un anónimo lee el chat pero no puede escribir.
    7. Un usuario con sesión comenta.
    8. Finalizar el stream.
    9. Cambiar la contraseña.
    10. Borrar la cuenta.

---

## Cobertura

| Requerimiento | Tarea |
|---|---|
| RF-01, RF-02 | 7 |
| RF-03, RF-04 | 8 |
| RF-05 | 9 |
| RF-06 | 6, 10 |
| RF-07 | 11 |
| RF-08 | 21 |
| RF-09, RF-10 | 5, 14, 16 |
| RF-11 | 15 |
| RF-12 | 16 |
| RF-13, RF-17 | 17 |
| RF-14 | 12, 18 |
| RF-15 | 19 |
| RF-16 | 20 |
| RNF-01 a RNF-12 | 1 a 5 (base), y se aplican en todas las demás |
