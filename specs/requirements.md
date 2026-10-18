# Strim · Backend — Requerimientos

> **SDD fase 1 de 3** (Requerimientos → Diseño → Tareas)
> Estado: **aprobado (v2)**, con las propuestas D1 a D7 · Fecha: 2026-10-18

Los criterios de aceptación usan el formato EARS: **CUANDO** (evento), **SI … ENTONCES** (caso no deseado), **MIENTRAS** (estado), y "el sistema **DEBERÁ**". Cada criterio tiene un ID (`RF-03.2`) para enlazarlo luego con el diseño y las tareas.

---

## 1. Objetivo

Backend de **Strim**, una app de streaming minimalista tipo Kick: un usuario transmite desde OBS y los espectadores ven el stream y comentan en un chat en vivo. Solo los usuarios con sesión iniciada pueden comentar.

## 2. Alcance

**Incluye**

- Cuentas: registro con verificación del correo por OTP, login, cierre de sesión y recuperación de contraseña con OTP.
- Perfil: ver y editar, cambiar la contraseña confirmando la actual y borrar la cuenta.
- Canal: uno por usuario, con credenciales para OBS y los botones de iniciar y finalizar stream.
- Video: recepción de la señal de OBS (RTMP) y reproducción pública (HLS) mediante MediaMTX.
- Chat en tiempo real por WebSocket.

**Fuera de alcance**

- Grabaciones (VOD), clips y repeticiones.
- Varias calidades de video (transcodificación).
- Seguir canales, suscripciones, notificaciones y pagos.
- Moderación del chat (borrar mensajes, banear, modo lento) y emotes.
- Login con redes sociales y 2FA.
- Cambiar el correo.
- Panel de administración.
- Despliegue a producción: se construye para correr en local y desplegar es una fase aparte.

## 3. Stack y restricciones

| Tema | Decisión |
|---|---|
| Runtime | Node.js 22 + TypeScript |
| HTTP | Express |
| ORM | sequelize-typescript |
| Base de datos | PostgreSQL de Supabase |
| Autenticación | Supabase Auth (registro, OTP, login, recuperación) |
| Tiempo real | WebSocket (ver D5) |
| Servidor de video | MediaMTX (entrada RTMP, salida HLS), en Docker o como ejecutable (ver D7) |
| Arquitectura | MVC: Modelos (Sequelize), Controladores y Vistas = Rutas (responden JSON) |
| Estructura | `backend/` (esta spec) y `frontend/` (otra sesión) en el mismo directorio |

## 4. Glosario

| Término | Significado |
|---|---|
| Usuario | Cuenta en Supabase Auth (correo + contraseña). |
| Perfil | Datos públicos del usuario: username, nombre visible, bio y avatar. |
| Canal | Espacio de transmisión de un usuario. Hay uno por usuario y se identifica por su username. |
| Stream key | Clave secreta del canal que el streamer pega en OBS. |
| OTP | Código numérico de 6 dígitos que llega por correo. |
| Sala | Conjunto de conexiones WebSocket que están viendo el mismo canal. |
| MediaMTX | Servidor de video que recibe la señal de OBS y la sirve a los navegadores. |

## 5. Actores

- **Visitante** (sin sesión): ve canales y lee el chat.
- **Usuario autenticado**: además comenta, edita su perfil y transmite desde su canal.
- **MediaMTX** (sistema): pregunta al backend si autoriza una señal y le avisa cuando una señal empieza o termina.

---

## 6. Requerimientos funcionales

### RF-01 · Registro

**Historia:** Como visitante, quiero crear una cuenta con correo, username y contraseña, para poder comentar y transmitir.

1. CUANDO un visitante envía correo, username y contraseña válidos, el sistema DEBERÁ crear la cuenta en Supabase Auth sin verificar y enviar un OTP a ese correo.
2. CUANDO se crea la cuenta, el sistema DEBERÁ crear su perfil y su canal (en estado `offline` y con una stream key nueva).
3. SI el correo ya pertenece a una cuenta verificada, ENTONCES el sistema DEBERÁ responder `EMAIL_TAKEN`.
4. SI el correo pertenece a una cuenta sin verificar, ENTONCES el sistema DEBERÁ reenviar el OTP en lugar de crear otra cuenta.
5. SI el username ya está en uso, ENTONCES el sistema DEBERÁ responder `USERNAME_TAKEN`.
6. El sistema DEBERÁ validar:
   - **Correo:** formato válido.
   - **Username:** de 3 a 20 caracteres entre `a-z`, `0-9` y `_`. Es único sin distinguir mayúsculas, se guarda en minúsculas y no puede ser una palabra reservada (`login`, `register`, `dashboard`, `settings`, `api`, `admin`, …).
   - **Contraseña:** cumple la política de RNF-04.

### RF-02 · Verificación del correo con OTP

**Historia:** Como usuario recién registrado, quiero confirmar mi correo con el código que me llega, para activar mi cuenta.

1. CUANDO el usuario envía su correo y un OTP correcto y vigente, el sistema DEBERÁ marcar la cuenta como verificada e iniciar sesión, devolviendo los mismos datos que RF-03.1.
2. SI el OTP es incorrecto o venció, ENTONCES el sistema DEBERÁ responder `INVALID_OTP`.
3. CUANDO el usuario pide reenviar el código, el sistema DEBERÁ enviar un OTP nuevo.
4. SI se pide un reenvío antes de 60 s desde el anterior, ENTONCES el sistema DEBERÁ responder `TOO_MANY_REQUESTS`.
5. El OTP DEBERÁ tener 6 dígitos y vencer a los 10 minutos.

### RF-03 · Inicio de sesión

**Historia:** Como usuario registrado, quiero iniciar sesión con mi correo y contraseña.

1. CUANDO el usuario envía correo y contraseña correctos de una cuenta verificada, el sistema DEBERÁ devolver access token, refresh token, su vencimiento y el perfil del usuario.
2. SI las credenciales son incorrectas, ENTONCES el sistema DEBERÁ responder `INVALID_CREDENTIALS` sin indicar cuál de los dos datos falló.
3. SI la cuenta no está verificada, ENTONCES el sistema DEBERÁ responder `EMAIL_NOT_VERIFIED`, para que el frontend lleve al usuario a la vista del OTP.

### RF-04 · Sesión

1. El sistema DEBERÁ exigir un access token válido (`Authorization: Bearer …`) en todas las rutas privadas.
2. SI falta el token, es inválido o venció, ENTONCES el sistema DEBERÁ responder `UNAUTHORIZED` (401).
3. CUANDO el cliente envía un refresh token válido, el sistema DEBERÁ devolver un par de tokens nuevo.
4. CUANDO el usuario cierra sesión, el sistema DEBERÁ invalidar su refresh token en Supabase.
5. CUANDO un usuario autenticado consulta sus datos, el sistema DEBERÁ devolver su correo, su perfil y el estado de su canal (sin la stream key).

### RF-05 · Recuperación de contraseña

**Historia:** Como usuario que olvidó su contraseña, quiero restablecerla con un código que llega a mi correo.

1. CUANDO alguien pide recuperar la contraseña de un correo, el sistema DEBERÁ enviar un OTP de recuperación si la cuenta existe, y responder lo mismo exista o no.
2. CUANDO el usuario envía su correo, un OTP válido y la contraseña nueva, el sistema DEBERÁ cambiar la contraseña y cerrar todas sus sesiones abiertas.
3. SI el OTP es incorrecto o venció, ENTONCES el sistema DEBERÁ responder `INVALID_OTP`.
4. La contraseña nueva DEBERÁ cumplir RNF-04. Después del cambio el usuario inicia sesión normalmente: esta acción no devuelve tokens.

### RF-06 · Perfil

**Historia:** Como usuario autenticado, quiero editar mi perfil, para personalizar cómo me ven en mi canal y en el chat.

1. El usuario autenticado PODRÁ editar su nombre visible (1 a 30 caracteres), su bio (0 a 200), su username (reglas de RF-01.6) y su avatar.
2. SI el nuevo username está en uso, ENTONCES el sistema DEBERÁ responder `USERNAME_TAKEN`.
3. MIENTRAS su canal no esté `offline`, el sistema DEBERÁ rechazar el cambio de username con `CHANNEL_LIVE`, porque la dirección del stream depende de él.
4. CUANDO el usuario sube un avatar JPG, PNG o WebP de hasta 2 MB, el sistema DEBERÁ guardarlo en Supabase Storage y actualizar la URL en su perfil.
5. SI el archivo tiene otro formato o pesa más, ENTONCES el sistema DEBERÁ responder `INVALID_FILE`.
6. El correo no se puede editar.

### RF-07 · Cambio de contraseña

**Historia:** Como usuario autenticado, quiero cambiar mi contraseña confirmando la actual en un modal, para que nadie que use mi sesión abierta pueda cambiarla.

1. CUANDO el usuario envía su contraseña actual y la nueva, el sistema DEBERÁ comprobar la actual contra Supabase Auth y, si es correcta, guardar la nueva.
2. SI la contraseña actual es incorrecta, ENTONCES el sistema DEBERÁ responder `INVALID_CURRENT_PASSWORD` (400) y mantener la sesión activa.
3. SI la nueva es igual a la actual, ENTONCES el sistema DEBERÁ responder `SAME_PASSWORD`.
4. SI hay más de 5 intentos fallidos en 15 minutos para el mismo usuario, ENTONCES el sistema DEBERÁ responder `TOO_MANY_REQUESTS`.
5. La contraseña nueva DEBERÁ cumplir RNF-04.

### RF-08 · Borrar la cuenta

**Historia:** Como usuario autenticado, quiero borrar mi cuenta, para eliminar mis datos de Strim.

1. CUANDO el usuario confirma el borrado enviando su contraseña actual, el sistema DEBERÁ borrar su cuenta de Supabase Auth y, en cascada, su perfil, su canal y sus mensajes del chat.
2. SI la contraseña es incorrecta, ENTONCES el sistema DEBERÁ responder `INVALID_CURRENT_PASSWORD` y no borrar nada. Los intentos fallidos cuentan para el mismo límite de RF-07.4.
3. CUANDO se borra la cuenta, el sistema DEBERÁ borrar también su avatar de Storage.
4. SI el canal no está `offline` al borrar, ENTONCES el sistema DEBERÁ cortar la señal de OBS y avisar a la sala que el canal ya no existe.
5. CUANDO se borra la cuenta, el sistema DEBERÁ cerrar sus sesiones y sus conexiones WebSocket. Sus tokens dejan de servir en la API y en el chat.
6. El borrado es definitivo. El correo y el username quedan libres para un registro nuevo.

### RF-09 · Credenciales para OBS

**Historia:** Como streamer, quiero ver en mi dashboard los datos que debo poner en OBS, para empezar a transmitir.

1. Cada usuario DEBERÁ tener exactamente un canal, con una stream key aleatoria, secreta y única de al menos 128 bits de entropía.
2. CUANDO el dueño abre su dashboard, el sistema DEBERÁ devolver la URL del servidor y la clave de transmisión listas para pegar en OBS (Ajustes → Emisión → Servicio "Personalizado"), junto con el estado y el título del canal.
3. CUANDO el dueño regenera la clave, el sistema DEBERÁ invalidar la anterior de inmediato.
4. SI el canal no está `offline`, ENTONCES el sistema DEBERÁ rechazar la regeneración con `CHANNEL_LIVE`.
5. El sistema DEBERÁ entregar la stream key solo a su dueño autenticado: nunca en respuestas públicas, en el chat ni en las URL de reproducción.

### RF-10 · Iniciar y finalizar stream

**Historia:** Como streamer, quiero iniciar y finalizar mi stream desde el dashboard.

Estados del canal:

| Estado | Significado | El público lo ve como |
|---|---|---|
| `offline` | Sin transmisión. OBS es rechazado. | Desconectado |
| `waiting` | El streamer pulsó "Iniciar stream" y se espera la señal de OBS. | Desconectado |
| `live` | MediaMTX está recibiendo la señal. | En vivo |

1. CUANDO el dueño pulsa "Iniciar stream" con un título opcional (máx. 100 caracteres), el sistema DEBERÁ pasar el canal de `offline` a `waiting` y guardar el título.
2. MIENTRAS el canal esté `offline`, el sistema DEBERÁ rechazar cualquier señal de OBS, aunque la stream key sea correcta.
3. CUANDO el dueño pulsa "Finalizar stream", el sistema DEBERÁ pasar el canal a `offline`, cortar la conexión de OBS si sigue activa y avisar a la sala del chat.
4. El dueño PODRÁ cambiar el título en cualquier estado, y el sistema DEBERÁ avisar del cambio a la sala.

### RF-11 · Autorización de la señal de OBS

1. CUANDO MediaMTX pide autorizar una señal entrante, el sistema DEBERÁ aceptarla solo si el canal existe, la stream key coincide y el canal está en `waiting` o `live`.
2. CUANDO MediaMTX pide autorizar una reproducción, el sistema DEBERÁ aceptarla siempre, porque los streams son públicos.
3. Las rutas internas para MediaMTX DEBERÁN exigir un secreto compartido y no formar parte de la API pública.

### RF-12 · Estado en vivo

1. CUANDO MediaMTX avisa que llegó la señal de un canal, el sistema DEBERÁ pasarlo a `live`, guardar la hora de inicio y avisar a la sala.
2. CUANDO MediaMTX avisa que la señal terminó (OBS se detuvo o perdió la conexión), el sistema DEBERÁ devolver el canal a `waiting` y avisar a la sala. Así OBS puede reconectarse sin pulsar "Iniciar stream" otra vez.
3. CUANDO el backend arranca, el sistema DEBERÁ sincronizar qué canales están `live` con las señales activas en MediaMTX.

### RF-13 · Canal público

**Historia:** Como espectador, quiero abrir el canal de un streamer para ver su transmisión.

1. CUANDO alguien consulta un canal por su username, el sistema DEBERÁ devolver: username, nombre visible, avatar, bio, título, si está en vivo, hora de inicio, cantidad de espectadores y URL de reproducción HLS.
2. SI el username no existe, ENTONCES el sistema DEBERÁ responder `NOT_FOUND` (404).
3. La respuesta pública NO DEBERÁ incluir el correo ni la stream key.

### RF-14 · Chat: conexión y lectura

**Historia:** Como espectador, con o sin sesión, quiero leer el chat en tiempo real.

1. Cualquier cliente PODRÁ conectarse por WebSocket y unirse a la sala de un canal (por su username) para recibir los mensajes en tiempo real.
2. CUANDO un cliente se une a una sala, el sistema DEBERÁ enviarle los últimos 50 mensajes, del más antiguo al más reciente.
3. CUANDO un cliente se une a otra sala, el sistema DEBERÁ sacarlo de la anterior (una sala a la vez).
4. CUANDO un cliente se conecta sin token, el sistema DEBERÁ tratarlo como anónimo, de solo lectura.
5. SI un cliente se conecta con un token inválido o vencido, ENTONCES el sistema DEBERÁ rechazar la conexión con `UNAUTHORIZED`, para que el cliente renueve el token y reintente.
6. El chat DEBERÁ funcionar aunque el canal no esté en vivo.

### RF-15 · Chat: enviar mensajes

**Historia:** Como usuario autenticado, sea espectador o streamer, quiero comentar en el chat.

1. CUANDO un usuario autenticado envía un mensaje a su sala, el sistema DEBERÁ guardarlo y enviarlo a todos los de la sala con: id, autor (username, nombre visible, avatar), texto y fecha.
2. SI el cliente es anónimo, ENTONCES el sistema DEBERÁ rechazar el mensaje con `AUTH_REQUIRED` y no difundirlo.
3. El texto DEBERÁ tener de 1 a 300 caracteres después de quitar los espacios al inicio y al final. Se guarda y se envía como texto plano.
4. SI un usuario envía más de 1 mensaje por segundo, ENTONCES el sistema DEBERÁ rechazar el exceso con `RATE_LIMITED`.
5. SI el access token de la conexión venció, ENTONCES el sistema DEBERÁ rechazar sus mensajes con `UNAUTHORIZED` hasta que el cliente se reconecte con un token nuevo.

### RF-16 · Espectadores (propuesta, ver D4)

1. El sistema DEBERÁ contar las conexiones activas en la sala de cada canal, con o sin sesión.
2. CUANDO ese número cambie, el sistema DEBERÁ avisar a la sala, como máximo una vez cada 5 segundos.

### RF-17 · Canales en vivo (propuesta, ver D4)

1. CUANDO alguien consulta los canales en vivo, el sistema DEBERÁ devolver los canales en estado `live`, ordenados por espectadores, con los mismos datos públicos que RF-13.

---

## 7. Requerimientos no funcionales

**RNF-01 · Arquitectura MVC**
- **Modelos:** clases de sequelize-typescript.
- **Controladores:** la lógica de cada caso de uso.
- **Vistas:** las rutas de Express, que responden JSON. No se renderiza HTML en el servidor.
- **Soporte:** configuración, middlewares y los manejadores del WebSocket, que cumplen el papel de rutas del chat.

**RNF-02 · Datos**
- PostgreSQL de Supabase con Sequelize. El esquema se versiona con migraciones (no se usa `sync()`).
- Las tablas de la app tienen RLS activado y ninguna política. El backend entra con conexión directa a Postgres, y la API pública de Supabase (PostgREST) no puede leerlas.
- El perfil se enlaza al usuario de Supabase Auth por su id (UUID). Si se borra el usuario, se borran en cascada su perfil, su canal y sus mensajes.

**RNF-03 · Autenticación y secretos**
- Supabase Auth es la única fuente de verdad de las credenciales. El backend nunca guarda contraseñas.
- El sistema verifica el JWT en cada petición privada y en cada conexión WebSocket que trae token.
- La service role key de Supabase y los demás secretos viven solo en el backend (`.env`) y nunca se envían al frontend.

**RNF-04 · Política de contraseñas**
Entre 8 y 72 caracteres, con al menos una letra y un número.

**RNF-05 · Validación**
Todo dato de entrada (body, params, query y eventos del WebSocket) se valida con un esquema antes de llegar al controlador. Si falla, el sistema responde `VALIDATION_ERROR` (400) con el detalle por campo.

**RNF-06 · Errores**
- Formato único: `{ "error": { "code": "…", "message": "…", "details": … } }`.
- Códigos HTTP coherentes con el error.
- Mensajes en español.
- Sin trazas internas en las respuestas de producción.

**RNF-07 · Seguridad HTTP**
- CORS limitado al origen del frontend.
- Cabeceras seguras (helmet).
- Máximo 10 peticiones por minuto por IP en las rutas de autenticación.
- Tamaño máximo del body.

**RNF-08 · Configuración**
- Todo se configura por variables de entorno, que se validan al arrancar: si falta alguna, el servidor no inicia.
- `.env.example` se versiona y `.env` se ignora.

**RNF-09 · Formato de la API**
JSON en camelCase, fechas en ISO 8601 (UTC) y todas las rutas bajo `/api`.

**RNF-10 · Desarrollo local**
Funciona en Windows: la API arranca con `npm run dev` (con recarga en caliente) y MediaMTX con `docker compose up` (o con su ejecutable, según D7).

**RNF-11 · Escala**
Una sola instancia, pensada para decenas de espectadores simultáneos por canal. No se usa Redis ni varias instancias.

**RNF-12 · Logs**
Una línea por petición (método, ruta, estado y duración) y los errores con detalle en la consola.

---

## 8. Dependencias y supuestos

- **Proyecto de Supabase** configurado así:
  - Confirmación de correo activada.
  - Plantillas "Confirm signup" y "Reset password" editadas para mostrar el código (`{{ .Token }}`) en lugar del enlace.
  - OTP de 6 dígitos que vence a los 10 minutos.
  - Bucket público `avatars` en Storage.
- **SMTP propio** (por ejemplo Resend) configurado en Supabase. El correo por defecto de Supabase solo sirve para pruebas: envía únicamente a los miembros del equipo del proyecto y muy pocos correos por hora.
- **MediaMTX** corre en Docker o como ejecutable (D7), con los puertos 1935 (RTMP, para OBS) y 8888 (HLS, para los navegadores) accesibles. En producción necesita un servidor con esos puertos abiertos.
- **Frontend:** `frontend/` consume esta API REST y el WebSocket, y se especifica en otra sesión.

## 9. Decisiones para confirmar

| # | Pregunta | Propuesta | Alternativa |
|---|---|---|---|
| D1 | ¿Hay que pulsar "Iniciar stream" antes de abrir OBS? | Sí (RF-10). | OBS inicia el stream por sí solo y el botón solo pone el título. |
| D2 | ¿El avatar se sube como imagen? | Sí, a Supabase Storage (RF-06.4). | Sin avatar: el frontend muestra las iniciales. |
| D3 | ¿Se guarda el chat? | Sí, y al entrar se muestran los últimos 50 (RF-14.2). | Chat efímero, sin tabla de mensajes. |
| D4 | ¿Contador de espectadores y lista de canales en vivo? | Sí (RF-16 y RF-17), cuestan poco. | Quitarlos. |
| D5 | ¿Socket.IO o `ws`? | Socket.IO: ya resuelve salas, reconexión y token en la conexión. | `ws` nativo, más liviano pero todo a mano. |
| D6 | ¿Pruebas automatizadas? | No por ahora: un archivo `.http` para probar cada endpoint a mano. | Tests de integración con Jest + Supertest. |
| D7 | ¿MediaMTX corre en Docker? | Sí: ya tienes Docker instalado, arranca con `docker compose up` y la misma configuración sirve para desplegar. | El ejecutable de MediaMTX para Windows (`mediamtx.exe`), sin Docker: un solo archivo que se descarga y se ejecuta. |
