import type http from 'node:http';
import { Server } from 'socket.io';
import { env } from '../config/env';
import { joinChannel, leaveChannel, sendMessage } from '../controllers/chat.controller';
import { toAppError } from '../middlewares/errorHandler';
import { authenticateToken } from '../middlewares/requireAuth';
import { AppError, type ErrorCode } from '../utils/AppError';
import { flushViewerCounts, markViewersChanged, setSocketServer, userRoom } from './emit';
import type { Ack, StrimServer } from './types';

const VIEWERS_INTERVAL_MS = 5_000;

// El cliente recibe `connect_error` con err.message = código y err.data = { code, message }.
function connectionError(code: ErrorCode) {
  const appError = new AppError(code);
  const err = new Error(code) as Error & { data: unknown };
  err.data = appError.toJSON();
  return err;
}

// Ejecuta el controlador y responde por el ack: { ok: true, … } o { ok: false, error }.
// Hace con los eventos lo mismo que errorHandler con las rutas.
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

export function initSockets(httpServer: http.Server): StrimServer {
  const io: StrimServer = new Server(httpServer, { cors: { origin: env.FRONTEND_URL } });

  // Token opcional: sin token el socket es anónimo (solo lectura, RF-14.4);
  // con un token inválido o vencido se rechaza la conexión (RF-14.5).
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

  io.on('connection', (socket) => {
    if (socket.data.userId) socket.join(userRoom(socket.data.userId));

    socket.on('chat:join', (payload, ack) => respond(ack, () => joinChannel(socket, payload)));
    socket.on('chat:leave', (ack) => respond(ack, () => leaveChannel(socket)));
    socket.on('chat:send', (payload, ack) => respond(ack, () => sendMessage(socket, payload)));

    socket.on('disconnect', () => {
      if (socket.data.channelId) markViewersChanged(socket.data.channelId);
    });
  });

  // unref: el temporizador no impide que el proceso termine.
  setInterval(flushViewerCounts, VIEWERS_INTERVAL_MS).unref();

  setSocketServer(io);
  return io;
}
